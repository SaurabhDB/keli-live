"""``/v1`` routes (LLD section 11). Road conditions come only from sensor rules, never an LLM."""

import json
from collections import Counter
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from keli.api.conditions import (
    StationCondition,
    condition_series,
    current_streak,
    station_condition,
)
from keli.api.provider import DataProvider
from keli.api.repository import (
    BBox,
    ForecastItem,
    Latest,
    Repository,
    Treatment,
    TreatmentQuery,
)
from keli.api.schemas import (
    CameraCondition,
    ConditionsResponse,
    ForecastItemOut,
    ForecastOut,
    HealthResponse,
    HistoryPoint,
    HistoryResponse,
    MaintenanceFeature,
    MaintenanceResponse,
    Measurements,
    OutlookResponse,
    ReasonCode,
    StationConditionOut,
    StatsResponse,
    StreakOut,
    TreatmentOut,
)
from keli.config import Settings
from keli.labels.hazard import HazardRules

router = APIRouter(prefix="/v1")
EMPTY = StationCondition(None, None, None, None, None, None)
HISTORY_STEP = timedelta(minutes=10)


def get_provider(request: Request) -> DataProvider:
    """The app's data provider (database with live fallback; set at startup)."""
    provider: DataProvider = request.app.state.provider
    return provider


def get_settings(request: Request) -> Settings:
    """The app's settings."""
    settings: Settings = request.app.state.settings
    return settings


Provider = Annotated[DataProvider, Depends(get_provider)]
Config = Annotated[Settings, Depends(get_settings)]


def parse_bbox(bbox: str | None = None) -> BBox | None:
    """``min_lon,min_lat,max_lon,max_lat`` (GeoJSON order) or None for all of Finland."""
    if bbox is None:
        return None
    try:
        min_lon, min_lat, max_lon, max_lat = (float(v) for v in bbox.split(","))
    except ValueError as exc:
        raise HTTPException(422, "bbox must be min_lon,min_lat,max_lon,max_lat") from exc
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(422, "bbox minimum must be below maximum")
    return (min_lon, min_lat, max_lon, max_lat)


def _at(at: datetime | None) -> datetime:
    if at is None:
        return datetime.now(UTC)
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _measurements(c: StationCondition) -> dict[str, object]:
    return Measurements(
        road_class=c.cls.value if c.cls else None,
        source=c.source,
        road_temp_c=c.road_temp_c,
        air_temp_c=c.air_temp_c,
        friction=c.friction,
        measured_at=c.measured_at,
        hazard=c.hazard.value if c.hazard else None,
        hazard_reasons=[f.text for f in c.hazard_findings],
        hazard_codes=[ReasonCode(code=f.code, params=f.params) for f in c.hazard_findings],
    ).model_dump()


def _rules(settings: Settings) -> HazardRules:
    return HazardRules(**settings.hazard.model_dump())


def _station_conditions(latest: Latest, settings: Settings) -> dict[int, StationCondition]:
    rules = _rules(settings)
    return {sid: station_condition(readings, rules) for sid, readings in latest.items()}


def _labels_camera(dist_m: int | None, settings: Settings) -> bool:
    return dist_m is not None and dist_m <= settings.training_radius_km * 1000


@router.get("/conditions")
async def conditions(
    provider: Provider,
    settings: Config,
    bbox: Annotated[BBox | None, Depends(parse_bbox)],
    at: datetime | None = None,
) -> ConditionsResponse:
    """Latest (or at ``at``) class per camera and station from fresh sensor readings."""
    body, source = await provider.run(lambda repo: _conditions(repo, settings, bbox, _at(at)))
    body.data_source = source
    return body


async def _conditions(
    repo: Repository, settings: Settings, bbox: BBox | None, when: datetime
) -> ConditionsResponse:
    latest = await repo.latest(when, settings.label_max_age_s, settings.imported_sensors)
    by_station = _station_conditions(latest, settings)
    treated = await repo.latest_treatments(_treatment_query(settings, when))
    cameras = [
        CameraCondition(
            camera_id=c.id,
            name=c.name,
            lat=c.lat,
            lon=c.lon,
            station_id=c.station_id,
            station_dist_m=c.station_dist_m,
            presets=c.presets,
            **_treatment_fields(treated.get(c.id)),
            thumb_url=f"{settings.image_base_url}/{c.presets[0]}.jpg?thumbnail=true"
            if c.presets
            else None,
            **_measurements(
                by_station.get(c.station_id, EMPTY)
                if c.station_id is not None and _labels_camera(c.station_dist_m, settings)
                else EMPTY
            ),
        )
        for c in await repo.cameras(bbox)
    ]
    stations = [
        StationConditionOut(
            station_id=s.id, name=s.name, lat=s.lat, lon=s.lon, **_measurements(by_station[s.id])
        )
        for s in await repo.stations(bbox)
        if s.id in by_station
    ]
    return ConditionsResponse(
        generated_at=datetime.now(UTC), at=when, cameras=cameras, stations=stations
    )


@router.get("/cameras/{camera_id}/history")
async def history(
    camera_id: str,
    provider: Provider,
    settings: Config,
    hours: Annotated[int, Query(gt=0)] = 24,
    at: datetime | None = None,
) -> HistoryResponse:
    """Condition every 10 minutes at the camera's paired station."""
    if hours > settings.api_max_history_hours:
        raise HTTPException(422, f"hours must be at most {settings.api_max_history_hours}")
    body, source = await provider.run(
        lambda repo: _history(repo, settings, camera_id, hours, _at(at))
    )
    body.data_source = source
    return body


async def _history(
    repo: Repository, settings: Settings, camera_id: str, hours: int, until: datetime
) -> HistoryResponse:
    camera = await repo.camera(camera_id)
    if camera is None:
        raise HTTPException(404, f"unknown camera {camera_id}")
    labelled = camera.station_id is not None and _labels_camera(camera.station_dist_m, settings)
    points: list[HistoryPoint] = []
    if labelled and camera.station_id is not None:
        since = until - timedelta(hours=hours)
        max_age = timedelta(seconds=settings.label_max_age_s)
        readings = await repo.series(
            camera.station_id, since - max_age, until, settings.imported_sensors
        )
        points = [
            HistoryPoint(t=t, **_measurements(c))
            for t, c in condition_series(
                readings, (since, until), HISTORY_STEP, max_age, _rules(settings)
            )
        ]
    return HistoryResponse(
        camera_id=camera.id,
        station_id=camera.station_id,
        station_dist_m=camera.station_dist_m,
        labelled=labelled,
        points=points,
        surface_streak=_streak([(p.t, p.road_class) for p in points]),
        hazard_streak=_streak([(p.t, p.hazard) for p in points]),
    )


def _streak(series: list[tuple[datetime, str | None]]) -> StreakOut | None:
    s = current_streak(series)
    return (
        StreakOut(value=s.value, since=s.since, previous=s.previous, complete=s.complete)
        if s
        else None
    )


@router.get("/stats")
async def stats(provider: Provider, settings: Config) -> StatsResponse:
    """How many cameras are labelled now, and the class mix."""
    body = await conditions(provider, settings, None)
    classes = Counter(c.road_class for c in body.cameras if c.road_class)
    hazards = Counter(c.hazard for c in body.cameras if c.hazard)
    return StatsResponse(
        at=body.at,
        cameras=len(body.cameras),
        labelled_cameras=sum(classes.values()),
        stations_reporting=len(body.stations),
        classes=dict(classes),
        hazards=dict(hazards),
        data_source=body.data_source,
    )


@router.get("/health")
async def health(provider: Provider, settings: Config) -> HealthResponse:
    """Data freshness: ``ok``, ``stale`` or ``degraded``.

    ``ok`` while the newest reading is at most three cycles old, else ``stale``; ``degraded``
    while the database is down and the live fallback serves the data. Three cycles allow
    for one recorder cycle plus one importer pass of delay.
    """
    newest, source = await provider.run(lambda repo: repo.newest_reading_at())
    age = (datetime.now(UTC) - newest).total_seconds() if newest else None
    fresh = age is not None and age <= 3 * settings.cycle_s
    status = "degraded" if source != "database" else "ok" if fresh else "stale"
    return HealthResponse(
        status=status, newest_reading_at=newest, data_age_s=age, data_source=source
    )


def _treatment_query(settings: Settings, until: datetime) -> TreatmentQuery:
    return TreatmentQuery(
        since=until - timedelta(hours=settings.maintenance_window_h),
        until=until,
        radius_m=settings.maintenance_radius_m,
        tasks=settings.maintenance_tasks,
    )


def _treatment_fields(t: Treatment | None) -> dict[str, object]:
    if t is None:
        return {}
    return {"treated_at": t.end_time, "treatment": t.tasks, "treatment_dist_m": t.dist_m}


@router.get("/cameras/{camera_id}/outlook")
async def outlook(
    camera_id: str,
    provider: Provider,
    settings: Config,
    at: datetime | None = None,
) -> OutlookResponse:
    """Winter maintenance near the camera (last ``maintenance_window_h``) and the forecast."""
    body, source = await provider.run(lambda repo: _outlook(repo, settings, camera_id, _at(at)))
    body.data_source = source
    return body


async def _outlook(
    repo: Repository, settings: Settings, camera_id: str, when: datetime
) -> OutlookResponse:
    if await repo.camera(camera_id) is None:
        raise HTTPException(404, f"unknown camera {camera_id}")
    treatments = await repo.camera_treatments(camera_id, _treatment_query(settings, when), limit=20)
    fc = await repo.camera_forecast(camera_id, when, settings.forecast_radius_m)
    forecast = None
    if fc is not None:
        forecast = ForecastOut(
            section_id=fc.section_id,
            description=fc.description,
            dist_m=fc.dist_m,
            issued_at=fc.issued_at,
            items=[_forecast_item(i) for i in fc.items],
        )
    return OutlookResponse(
        camera_id=camera_id,
        treatments=[TreatmentOut(**asdict(t)) for t in treatments],
        forecast=forecast,
    )


def _forecast_item(i: ForecastItem) -> ForecastItemOut:
    """Temperatures are stored as float4: round away the binary noise (-3.700000047)."""
    item = asdict(i)
    for key in ("road_temp_c", "air_temp_c"):
        if item[key] is not None:
            item[key] = round(item[key], 1)
    return ForecastItemOut(**item)


@router.get("/maintenance")
async def maintenance(
    provider: Provider,
    settings: Config,
    hours: Annotated[float, Query(gt=0)] = 2,
    at: datetime | None = None,
) -> MaintenanceResponse:
    """Winter maintenance tracks completed in the last ``hours`` (GeoJSON, for a map layer)."""
    if hours > settings.maintenance_layer_max_h:
        raise HTTPException(422, f"hours must be at most {settings.maintenance_layer_max_h}")
    until = _at(at)
    shapes, source = await provider.run(
        lambda repo: repo.route_shapes(
            until - timedelta(hours=hours), until, settings.maintenance_tasks
        )
    )
    features = [
        MaintenanceFeature(
            geometry=json.loads(s.geojson),
            properties={"id": s.id, "end_time": s.end_time.isoformat(), "tasks": s.tasks},
        )
        for s in shapes
    ]
    return MaintenanceResponse(features=features, data_source=source)
