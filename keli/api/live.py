# ruff: noqa: ARG002 - stub methods keep the Repository interface's signatures
"""``Repository`` served straight from Digitraffic, used when PostgreSQL is unreachable.

Same interface and the same deterministic labelling as the database path; only the data
source changes. Digitraffic offers the latest readings only, so a past ``at`` and history
windows contain just what the latest snapshot covers (usually nothing). Responses are cached
(``live_cache_s``) so many map users cost one Digitraffic call per minute, not one each.
"""

import asyncio
import logging
import time
from collections import defaultdict
from datetime import datetime

from keli.api.repository import (
    BBox,
    CameraRow,
    Latest,
    Reading,
    RouteShape,
    SectionForecast,
    StationRow,
    Treatment,
    TreatmentQuery,
)
from keli.config import Settings
from keli.digitraffic.client import DigitrafficClient
from keli.digitraffic.models import Camera, SensorReading, WeatherStation
from keli.ingest.cameras import haversine_km

logger = logging.getLogger(__name__)


def _in_bbox(lon: float, lat: float, bbox: BBox | None) -> bool:
    return bbox is None or (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3])


def nearest_stations(
    cameras: list[Camera], stations: list[WeatherStation]
) -> dict[str, tuple[int, int]]:
    """Camera id -> (nearest station id, distance in metres); same rule as the importer."""
    out: dict[str, tuple[int, int]] = {}
    for cam in cameras:
        best = min(
            stations,
            key=lambda s: haversine_km(cam.lat, cam.lon, s.lat, s.lon),
            default=None,
        )
        if best is not None:
            dist_m = round(haversine_km(cam.lat, cam.lon, best.lat, best.lon) * 1000)
            out[cam.id] = (best.id, dist_m)
    return out


class LiveRepository:
    """Latest Digitraffic data behind the ``Repository`` interface."""

    def __init__(self, client: DigitrafficClient, settings: Settings) -> None:
        """Fetch through ``client`` (rate limited); cache per ``settings``."""
        self._client = client
        self._settings = settings
        self._lock = asyncio.Lock()
        self._cameras: list[CameraRow] = []
        self._stations: list[StationRow] = []
        self._meta_at = -float("inf")
        self._readings: list[SensorReading] = []
        self._readings_at = -float("inf")

    async def _metadata(self) -> None:
        async with self._lock:
            if time.monotonic() - self._meta_at < self._settings.metadata_refresh_s:
                return
            cams = (await self._client.cameras()).value
            stas = (await self._client.weather_stations()).value
            nearest = nearest_stations(cams, stas)
            self._cameras = [
                CameraRow(
                    c.id,
                    c.name,
                    c.lat,
                    c.lon,
                    station_id=nearest[c.id][0] if c.id in nearest else None,
                    station_dist_m=nearest[c.id][1] if c.id in nearest else None,
                    presets=list(c.preset_ids),
                )
                for c in cams
                if c.preset_ids
            ]
            self._stations = [StationRow(s.id, s.name, s.lat, s.lon) for s in stas]
            self._meta_at = time.monotonic()
            logger.info("live_metadata_loaded", extra={"fields": {"cameras": len(self._cameras)}})

    async def _snapshot(self) -> list[SensorReading]:
        async with self._lock:
            if time.monotonic() - self._readings_at >= self._settings.live_cache_s:
                wanted = frozenset(self._settings.imported_sensors)
                self._readings = await self._client.sensor_readings(wanted)
                self._readings_at = time.monotonic()
            return self._readings

    async def cameras(self, bbox: BBox | None, camera_id: str | None = None) -> list[CameraRow]:
        """Collecting cameras from the cached Digitraffic camera list."""
        await self._metadata()
        return [
            c
            for c in self._cameras
            if _in_bbox(c.lon, c.lat, bbox) and (camera_id is None or c.id == camera_id)
        ]

    async def camera(self, camera_id: str) -> CameraRow | None:
        """One camera by id."""
        found = await self.cameras(None, camera_id)
        return found[0] if found else None

    async def stations(self, bbox: BBox | None) -> list[StationRow]:
        """Weather stations from the cached station list."""
        await self._metadata()
        return [s for s in self._stations if _in_bbox(s.lon, s.lat, bbox)]

    async def latest(self, at: datetime, max_age_s: float, sensors: list[str]) -> Latest:
        """Readings of the current snapshot that fall in ``(at - max_age, at]``."""
        out: Latest = defaultdict(dict)
        wanted = set(sensors)
        for r in await self._snapshot():
            if r.sensor in wanted and 0 <= (at - r.measured_at).total_seconds() < max_age_s:
                out[r.station_id][r.sensor] = Reading(r.sensor, r.value, r.measured_at)
        return out

    async def series(
        self, station_id: int, since: datetime, until: datetime, sensors: list[str]
    ) -> list[Reading]:
        """Only the latest snapshot exists live, so at most one reading per sensor."""
        wanted = set(sensors)
        return sorted(
            (
                Reading(r.sensor, r.value, r.measured_at)
                for r in await self._snapshot()
                if r.station_id == station_id
                and r.sensor in wanted
                and since < r.measured_at <= until
            ),
            key=lambda r: r.measured_at,
        )

    async def newest_reading_at(self) -> datetime | None:
        """Newest measurement time in the snapshot."""
        return max((r.measured_at for r in await self._snapshot()), default=None)

    # Maintenance and forecasts come from the recorder's history in the database; the live
    # fallback does not fetch them (it keeps the outage path to one Digitraffic call).

    async def latest_treatments(self, q: TreatmentQuery) -> dict[str, Treatment]:
        """Not available in the live fallback."""
        return {}

    async def camera_treatments(
        self, camera_id: str, q: TreatmentQuery, limit: int
    ) -> list[Treatment]:
        """Not available in the live fallback."""
        return []

    async def camera_forecast(
        self, camera_id: str, at: datetime, radius_m: float
    ) -> SectionForecast | None:
        """Not available in the live fallback."""
        return None

    async def route_shapes(
        self, since: datetime, until: datetime, tasks: list[str]
    ) -> list[RouteShape]:
        """Not available in the live fallback."""
        return []
