"""Data access for the API: the ``Repository`` interface and its PostgreSQL implementation.

``DatabaseRepository`` is the only API class that talks to PostgreSQL; ``keli.api.live``
implements the same interface from Digitraffic for when the database is unreachable.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from keli.storage.db import Pool

BBox = tuple[float, float, float, float]  # min_lon, min_lat, max_lon, max_lat


@dataclass(frozen=True, slots=True)
class CameraRow:
    """A camera with its nearest weather station."""

    id: str
    name: str
    lat: float
    lon: float
    station_id: int | None
    station_dist_m: int | None
    presets: list[str]


@dataclass(frozen=True, slots=True)
class StationRow:
    """A road weather station."""

    id: int
    name: str
    lat: float
    lon: float


@dataclass(frozen=True, slots=True)
class Reading:
    """One sensor value."""

    sensor: str
    value: float
    measured_at: datetime


Latest = dict[int, dict[str, Reading]]  # station -> sensor -> newest reading


@dataclass(frozen=True, slots=True)
class Treatment:
    """Winter maintenance near a camera: when it ended, what was done, how far away."""

    end_time: datetime
    tasks: list[str]
    dist_m: int


@dataclass(frozen=True, slots=True)
class ForecastItem:
    """One lead time of a road weather forecast (0h is the observation)."""

    name: str
    valid_at: datetime
    kind: str
    road_temp_c: float | None
    air_temp_c: float | None
    road_condition: str | None
    overall_condition: str | None


@dataclass(frozen=True, slots=True)
class SectionForecast:
    """The latest forecast issue for the forecast section nearest a camera."""

    section_id: str
    description: str
    dist_m: int
    issued_at: datetime
    items: list[ForecastItem]


@dataclass(frozen=True, slots=True)
class RouteShape:
    """A maintenance track for the map layer."""

    id: int
    end_time: datetime
    tasks: list[str]
    geojson: str


@dataclass(frozen=True, slots=True)
class TreatmentQuery:
    """Which maintenance counts: completed in ``(since, until]``, within ``radius_m``."""

    since: datetime
    until: datetime
    radius_m: float
    tasks: list[str]


# $1-$4: optional bbox (min_lon, min_lat, max_lon, max_lat); all NULL means no filter.
CAMERAS = """
SELECT c.id, c.name, ST_Y(c.geom::geometry) AS lat, ST_X(c.geom::geometry) AS lon,
       c.weather_station, c.station_dist_m,
       array_agg(p.id ORDER BY p.id) FILTER (WHERE p.in_collection) AS presets
FROM camera c JOIN preset p ON p.camera_id = c.id
WHERE ($1::float8 IS NULL OR c.geom::geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326))
  AND ($5::text IS NULL OR c.id = $5)
GROUP BY c.id
HAVING bool_or(p.in_collection)
ORDER BY c.id
"""

STATIONS = """
SELECT id, name, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon
FROM weather_station
WHERE ($1::float8 IS NULL OR geom::geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326))
ORDER BY id
"""

LATEST = """
SELECT DISTINCT ON (station_id, sensor) station_id, sensor, value, measured_at
FROM sensor_reading
WHERE measured_at > $1 AND measured_at <= $2 AND sensor = ANY($3::text[])
ORDER BY station_id, sensor, measured_at DESC
"""

STATION_SERIES = """
SELECT sensor, value, measured_at FROM sensor_reading
WHERE station_id = $1 AND measured_at > $2 AND measured_at <= $3 AND sensor = ANY($4::text[])
ORDER BY measured_at
"""


LATEST_TREATMENT = """
SELECT c.id AS camera_id, t.end_time, t.tasks, t.dist_m
FROM camera c
CROSS JOIN LATERAL (
  SELECT m.end_time, m.tasks, round(ST_Distance(m.geom, c.geom))::int AS dist_m
  FROM maintenance_route m
  WHERE m.end_time > $1 AND m.end_time <= $2 AND m.tasks && $4::text[]
    AND ST_DWithin(m.geom, c.geom, $3)
  ORDER BY m.end_time DESC
  LIMIT 1
) t
"""

CAMERA_TREATMENTS = """
SELECT m.end_time, m.tasks, round(ST_Distance(m.geom, c.geom))::int AS dist_m
FROM camera c JOIN maintenance_route m
  ON m.end_time > $2 AND m.end_time <= $3 AND m.tasks && $5::text[]
 AND ST_DWithin(m.geom, c.geom, $4)
WHERE c.id = $1
ORDER BY m.end_time DESC
LIMIT $6
"""

NEAREST_SECTION = """
SELECT s.id, s.description, round(ST_Distance(s.geom, c.geom))::int AS dist_m
FROM camera c JOIN forecast_section s ON ST_DWithin(s.geom, c.geom, $2)
WHERE c.id = $1
ORDER BY s.geom <-> c.geom
LIMIT 1
"""

SECTION_FORECAST = """
SELECT name, valid_at, kind, road_temp_c, air_temp_c, road_condition, overall_condition, issued_at
FROM road_forecast
WHERE section_id = $1
  AND issued_at = (SELECT max(issued_at) FROM road_forecast WHERE section_id = $1
                   AND issued_at <= $2)
ORDER BY valid_at
"""

ROUTE_SHAPES = """
SELECT id, end_time, tasks,
       ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom::geometry, 0.0005), 4) AS geojson
FROM maintenance_route
WHERE end_time > $1 AND end_time <= $2 AND tasks && $3::text[]
ORDER BY end_time
"""


class Repository(Protocol):
    """What the routes need, whichever source serves it."""

    async def cameras(self, bbox: BBox | None, camera_id: str | None = None) -> list[CameraRow]:
        """Collecting cameras, optionally inside ``bbox`` or just ``camera_id``."""
        ...

    async def camera(self, camera_id: str) -> CameraRow | None:
        """One camera by id."""
        ...

    async def stations(self, bbox: BBox | None) -> list[StationRow]:
        """Weather stations, optionally inside ``bbox``."""
        ...

    async def latest(self, at: datetime, max_age_s: float, sensors: list[str]) -> Latest:
        """Newest reading per station and sensor in ``(at - max_age, at]``."""
        ...

    async def series(
        self, station_id: int, since: datetime, until: datetime, sensors: list[str]
    ) -> list[Reading]:
        """All readings of one station in a time window, oldest first."""
        ...

    async def newest_reading_at(self) -> datetime | None:
        """Time of the newest reading available (data freshness)."""
        ...

    async def latest_treatments(self, q: TreatmentQuery) -> dict[str, Treatment]:
        """Camera id -> its most recent matching treatment."""
        ...

    async def camera_treatments(
        self, camera_id: str, q: TreatmentQuery, limit: int
    ) -> list[Treatment]:
        """Matching treatments near one camera, newest first."""
        ...

    async def camera_forecast(
        self, camera_id: str, at: datetime, radius_m: float
    ) -> SectionForecast | None:
        """Latest forecast issued by ``at`` for the nearest section within ``radius_m``."""
        ...

    async def route_shapes(
        self, since: datetime, until: datetime, tasks: list[str]
    ) -> list[RouteShape]:
        """Maintenance tracks completed in the window, simplified for drawing."""
        ...


class DatabaseRepository:
    """``Repository`` backed by PostgreSQL (the normal path)."""

    def __init__(self, pool: Pool) -> None:
        """Use connections from ``pool``."""
        self._pool = pool

    async def cameras(self, bbox: BBox | None, camera_id: str | None = None) -> list[CameraRow]:
        """Collecting cameras, optionally inside ``bbox`` or just ``camera_id``."""
        rows = await self._pool.fetch(CAMERAS, *_bbox_args(bbox), camera_id)
        return [
            CameraRow(
                r["id"],
                r["name"],
                r["lat"],
                r["lon"],
                r["weather_station"],
                r["station_dist_m"],
                list(r["presets"] or []),
            )
            for r in rows
        ]

    async def camera(self, camera_id: str) -> CameraRow | None:
        """One camera by id."""
        found = await self.cameras(None, camera_id)
        return found[0] if found else None

    async def stations(self, bbox: BBox | None) -> list[StationRow]:
        """Weather stations, optionally inside ``bbox``."""
        rows = await self._pool.fetch(STATIONS, *_bbox_args(bbox))
        return [StationRow(r["id"], r["name"], r["lat"], r["lon"]) for r in rows]

    async def latest(self, at: datetime, max_age_s: float, sensors: list[str]) -> Latest:
        """Newest reading per station and sensor in ``(at - max_age, at]``."""
        rows = await self._pool.fetch(LATEST, at - timedelta(seconds=max_age_s), at, sensors)
        out: Latest = defaultdict(dict)
        for r in rows:
            out[r["station_id"]][r["sensor"]] = Reading(r["sensor"], r["value"], r["measured_at"])
        return out

    async def series(
        self, station_id: int, since: datetime, until: datetime, sensors: list[str]
    ) -> list[Reading]:
        """All readings of one station in a time window, oldest first."""
        rows = await self._pool.fetch(STATION_SERIES, station_id, since, until, sensors)
        return [Reading(r["sensor"], r["value"], r["measured_at"]) for r in rows]

    async def newest_reading_at(self) -> datetime | None:
        """Time of the newest reading in the database (data freshness)."""
        return await self._pool.fetchval("SELECT max(measured_at) FROM sensor_reading")  # type: ignore[no-any-return]

    async def latest_treatments(self, q: TreatmentQuery) -> dict[str, Treatment]:
        """One lateral index lookup per camera."""
        rows = await self._pool.fetch(LATEST_TREATMENT, q.since, q.until, q.radius_m, q.tasks)
        return {
            r["camera_id"]: Treatment(r["end_time"], list(r["tasks"]), r["dist_m"]) for r in rows
        }

    async def camera_treatments(
        self, camera_id: str, q: TreatmentQuery, limit: int
    ) -> list[Treatment]:
        """Matching treatments near one camera, newest first."""
        rows = await self._pool.fetch(
            CAMERA_TREATMENTS, camera_id, q.since, q.until, q.radius_m, q.tasks, limit
        )
        return [Treatment(r["end_time"], list(r["tasks"]), r["dist_m"]) for r in rows]

    async def camera_forecast(
        self, camera_id: str, at: datetime, radius_m: float
    ) -> SectionForecast | None:
        """Nearest section, then its latest forecast issue at or before ``at``."""
        section = await self._pool.fetchrow(NEAREST_SECTION, camera_id, radius_m)
        if section is None:
            return None
        rows = await self._pool.fetch(SECTION_FORECAST, section["id"], at)
        if not rows:
            return None
        items = [
            ForecastItem(
                r["name"],
                r["valid_at"],
                r["kind"],
                r["road_temp_c"],
                r["air_temp_c"],
                r["road_condition"],
                r["overall_condition"],
            )
            for r in rows
        ]
        return SectionForecast(
            section["id"], section["description"], section["dist_m"], rows[0]["issued_at"], items
        )

    async def route_shapes(
        self, since: datetime, until: datetime, tasks: list[str]
    ) -> list[RouteShape]:
        """Simplified to ~50 m (4 decimals) so a few hours of tracks stay a light map layer."""
        rows = await self._pool.fetch(ROUTE_SHAPES, since, until, tasks)
        return [RouteShape(r["id"], r["end_time"], list(r["tasks"]), r["geojson"]) for r in rows]


def _bbox_args(bbox: BBox | None) -> tuple[float | None, ...]:
    return bbox if bbox is not None else (None, None, None, None)
