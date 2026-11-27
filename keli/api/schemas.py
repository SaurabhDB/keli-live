"""Response models. Every response carries the Digitraffic attribution (CLAUDE.md)."""

from datetime import datetime

from pydantic import BaseModel

from keli import ATTRIBUTION


class Attributed(BaseModel):
    """Base for every response body."""

    attribution: str = ATTRIBUTION
    # "database" normally; "digitraffic_live" when PostgreSQL is down (latest data only).
    data_source: str = "database"


class ReasonCode(BaseModel):
    """A hazard reason as a stable code and its values (e.g. grip_reduced, {grip: 0.4})."""

    code: str
    params: dict[str, float] = {}


class Measurements(BaseModel):
    """Class and readings behind it."""

    road_class: str | None
    source: str | None  # sensor, optical (provisional) or None
    road_temp_c: float | None
    air_temp_c: float | None
    friction: float | None
    measured_at: datetime | None
    hazard: str | None = None  # low, medium, high (driving hazard now or within the hour)
    hazard_reasons: list[str] = []  # English, most serious first
    hazard_codes: list["ReasonCode"] = []  # same reasons as codes + values, for translation


class CameraCondition(Measurements):
    """A camera on the map. Unlabelled when no station is within the training radius."""

    camera_id: str
    name: str
    lat: float
    lon: float
    station_id: int | None
    station_dist_m: int | None
    presets: list[str]
    thumb_url: str | None
    # Latest winter maintenance near the camera (maintenance_radius_m, maintenance_window_h).
    treated_at: datetime | None = None
    treatment: list[str] = []
    treatment_dist_m: int | None = None


class StationConditionOut(Measurements):
    """A road weather station on the map."""

    station_id: int
    name: str
    lat: float
    lon: float


class ConditionsResponse(Attributed):
    """``GET /v1/conditions``."""

    generated_at: datetime
    at: datetime
    cameras: list[CameraCondition]
    stations: list[StationConditionOut]


class HistoryPoint(Measurements):
    """One step of a history series."""

    t: datetime


class StreakOut(BaseModel):
    """How long the current value has held (see ``keli.api.conditions.current_streak``)."""

    value: str
    since: datetime
    previous: str | None  # value before the change; None if unknown
    complete: bool  # False: "since at least" (window start or data gap reached)


class HistoryResponse(Attributed):
    """``GET /v1/cameras/{id}/history``."""

    camera_id: str
    station_id: int | None
    station_dist_m: int | None
    labelled: bool
    points: list[HistoryPoint]
    surface_streak: StreakOut | None = None
    hazard_streak: StreakOut | None = None


class StatsResponse(Attributed):
    """``GET /v1/stats``: coverage and class counts now."""

    at: datetime
    cameras: int
    labelled_cameras: int
    stations_reporting: int
    classes: dict[str, int]
    hazards: dict[str, int] = {}


class HealthResponse(Attributed):
    """``GET /v1/health``."""

    status: str  # ok, stale, or degraded (serving the live fallback)
    newest_reading_at: datetime | None
    data_age_s: float | None


class TreatmentOut(BaseModel):
    """Winter maintenance near a camera."""

    end_time: datetime
    tasks: list[str]
    dist_m: int


class ForecastItemOut(BaseModel):
    """One lead time of the road weather forecast; ``0h`` is the observation."""

    name: str
    valid_at: datetime
    kind: str
    road_temp_c: float | None
    air_temp_c: float | None
    road_condition: str | None
    overall_condition: str | None


class ForecastOut(BaseModel):
    """Forecast of the nearest road weather forecast section."""

    section_id: str
    description: str
    dist_m: int
    issued_at: datetime
    items: list[ForecastItemOut]


class OutlookResponse(Attributed):
    """``GET /v1/cameras/{id}/outlook``: recent maintenance and the road weather forecast."""

    camera_id: str
    treatments: list[TreatmentOut]
    forecast: ForecastOut | None


class MaintenanceFeature(BaseModel):
    """GeoJSON feature of one maintenance track."""

    type: str = "Feature"
    geometry: dict[str, object]
    properties: dict[str, object]


class MaintenanceResponse(Attributed):
    """``GET /v1/maintenance``: GeoJSON FeatureCollection of recent winter maintenance."""

    type: str = "FeatureCollection"
    features: list[MaintenanceFeature]
