"""Typed Digitraffic responses and the domain objects the rest of Keli Live uses.

Only the fields Keli Live needs are modelled; unknown fields are ignored so additive API
changes do not break ingestion. Raw payloads are stored separately for reprocessing.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

GATHERING = "GATHERING"


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class _Point(_Model):
    coordinates: list[float] = Field(min_length=2)  # GeoJSON order: [lon, lat, (alt)]


class _Preset(_Model):
    id: str
    in_collection: bool = Field(default=True, alias="inCollection")


class _CameraProps(_Model):
    id: str
    name: str = ""
    collection_status: str | None = Field(default=None, alias="collectionStatus")
    presets: list[_Preset] = []


class _CameraFeature(_Model):
    geometry: _Point
    properties: _CameraProps


class CameraStationsResponse(_Model):
    """``GET /api/weathercam/v1/stations``."""

    features: list[_CameraFeature]


class _WeatherProps(_Model):
    name: str = ""
    collection_status: str | None = Field(default=None, alias="collectionStatus")


class _WeatherFeature(_Model):
    id: int
    geometry: _Point
    properties: _WeatherProps = _WeatherProps()


class WeatherStationsResponse(_Model):
    """``GET /api/weather/v1/stations``."""

    features: list[_WeatherFeature]


class _PresetData(_Model):
    id: str
    measured_time: datetime | None = Field(default=None, alias="measuredTime")


class _CameraData(_Model):
    id: str
    presets: list[_PresetData] = []


class CameraStationDataResponse(_Model):
    """``GET /api/weathercam/v1/stations/data``: latest capture time of every preset."""

    stations: list[_CameraData]


class _SensorValue(_Model):
    name: str
    value: float | None = None
    measured_time: datetime | None = Field(default=None, alias="measuredTime")


class _WeatherData(_Model):
    id: int
    sensor_values: list[_SensorValue] = Field(default=[], alias="sensorValues")


class WeatherStationDataResponse(_Model):
    """``GET /api/weather/v1/stations/data``: latest readings of every station."""

    stations: list[_WeatherData]


@dataclass(frozen=True, slots=True)
class Camera:
    """A camera station and its presets (camera angles)."""

    id: str
    name: str
    lat: float
    lon: float
    collecting: bool
    preset_ids: tuple[str, ...]
    status: str | None = None


@dataclass(frozen=True, slots=True)
class WeatherStation:
    """A road weather station location."""

    id: int
    lat: float
    lon: float
    name: str = ""
    status: str | None = None


@dataclass(frozen=True, slots=True)
class SensorReading:
    """One sensor value of a road weather station."""

    station_id: int
    sensor: str
    value: float
    measured_at: datetime


def to_cameras(resp: CameraStationsResponse) -> list[Camera]:
    """Convert the camera list to domain objects, keeping only presets in collection."""
    cameras = []
    for f in resp.features:
        lon, lat = f.geometry.coordinates[0], f.geometry.coordinates[1]
        props = f.properties
        cameras.append(
            Camera(
                id=props.id,
                name=props.name,
                lat=lat,
                lon=lon,
                collecting=props.collection_status in (None, GATHERING),
                preset_ids=tuple(p.id for p in props.presets if p.in_collection),
                status=props.collection_status,
            )
        )
    return cameras


def to_weather_stations(resp: WeatherStationsResponse) -> list[WeatherStation]:
    """Convert the weather-station list to domain objects."""
    return [
        WeatherStation(
            id=f.id,
            lat=f.geometry.coordinates[1],
            lon=f.geometry.coordinates[0],
            name=f.properties.name,
            status=f.properties.collection_status,
        )
        for f in resp.features
    ]


def to_capture_times(resp: CameraStationDataResponse) -> dict[str, datetime]:
    """Map preset id to the capture time of its latest image."""
    return {p.id: p.measured_time for s in resp.stations for p in s.presets if p.measured_time}


def to_sensor_readings(
    resp: WeatherStationDataResponse, sensors: frozenset[str]
) -> list[SensorReading]:
    """Readings of the named sensors that carry both a value and a measurement time."""
    return [
        SensorReading(s.id, v.name, v.value, v.measured_time)
        for s in resp.stations
        for v in s.sensor_values
        if v.name in sensors and v.value is not None and v.measured_time is not None
    ]


# ---------------------------------------------------------------- winter maintenance


class _Geometry(_Model):
    type: str
    coordinates: Any  # GeoJSON; handed to PostGIS as is


class _MaintenanceProps(_Model):
    id: int
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    tasks: list[str] = []


class _MaintenanceFeature(_Model):
    geometry: _Geometry
    properties: _MaintenanceProps


class MaintenanceRoutesResponse(_Model):
    """``GET /api/maintenance/v1/tracking/routes``: completed maintenance tracks."""

    features: list[_MaintenanceFeature]


@dataclass(frozen=True, slots=True)
class MaintenanceRoute:
    """One tracked stretch of maintenance work (a line or a point) and its tasks."""

    id: int
    start_time: datetime
    end_time: datetime
    tasks: tuple[str, ...]
    geojson: str  # geometry as GeoJSON text


def to_maintenance_routes(resp: MaintenanceRoutesResponse) -> list[MaintenanceRoute]:
    """Convert maintenance tracks to domain objects."""
    return [
        MaintenanceRoute(
            id=f.properties.id,
            start_time=f.properties.start_time,
            end_time=f.properties.end_time,
            tasks=tuple(f.properties.tasks),
            geojson=json.dumps(f.geometry.model_dump()),
        )
        for f in resp.features
    ]


# ---------------------------------------------------------------- road weather forecasts


class _SectionProps(_Model):
    id: str
    description: str = ""
    road_number: int | None = Field(default=None, alias="roadNumber")


class _SectionFeature(_Model):
    geometry: _Geometry
    properties: _SectionProps


class ForecastSectionsResponse(_Model):
    """``GET /api/weather/v2/forecast-sections-simple``: road sections with forecasts."""

    features: list[_SectionFeature]


@dataclass(frozen=True, slots=True)
class ForecastSection:
    """A stretch of road with its own road weather forecast."""

    id: str
    description: str
    road_number: int | None
    geojson: str


def to_forecast_sections(resp: ForecastSectionsResponse) -> list[ForecastSection]:
    """Convert forecast sections to domain objects."""
    return [
        ForecastSection(
            id=f.properties.id,
            description=f.properties.description,
            road_number=f.properties.road_number,
            geojson=json.dumps(f.geometry.model_dump()),
        )
        for f in resp.features
    ]


class _ForecastItem(_Model):
    forecast_name: str = Field(alias="forecastName")  # 0h (observation), 2h, 4h, 6h, 12h
    time: datetime
    type: str  # OBSERVATION or FORECAST
    road_temperature: float | None = Field(default=None, alias="roadTemperature")
    temperature: float | None = None
    road_condition: str | None = Field(default=None, alias="roadCondition")
    overall_road_condition: str | None = Field(default=None, alias="overallRoadCondition")


class _SectionForecasts(_Model):
    id: str
    forecasts: list[_ForecastItem] = []


class RoadForecastsResponse(_Model):
    """``GET /api/weather/v2/forecast-sections-simple/forecasts``."""

    data_updated_time: datetime = Field(alias="dataUpdatedTime")
    forecast_sections: list[_SectionForecasts] = Field(alias="forecastSections")


@dataclass(frozen=True, slots=True)
class RoadForecast:
    """Forecast (or the 0 h observation) for one road section and lead time."""

    section_id: str
    issued_at: datetime
    name: str
    valid_at: datetime
    kind: str
    road_temp_c: float | None
    air_temp_c: float | None
    road_condition: str | None
    overall_condition: str | None


def to_road_forecasts(resp: RoadForecastsResponse) -> list[RoadForecast]:
    """Flatten section forecasts, stamped with the issue time of the whole set."""
    return [
        RoadForecast(
            section_id=s.id,
            issued_at=resp.data_updated_time,
            name=f.forecast_name,
            valid_at=f.time,
            kind=f.type,
            road_temp_c=f.road_temperature,
            air_temp_c=f.temperature,
            road_condition=f.road_condition,
            overall_condition=f.overall_road_condition,
        )
        for s in resp.forecast_sections
        for f in s.forecasts
    ]
