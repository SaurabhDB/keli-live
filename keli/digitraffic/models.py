"""Typed Digitraffic responses and the domain objects the rest of Keli Live uses.

Only the fields Keli Live needs are modelled; unknown fields are ignored so additive API
changes do not break ingestion. Raw payloads are stored separately for reprocessing.
"""

from dataclasses import dataclass
from datetime import datetime

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


class _WeatherFeature(_Model):
    id: int
    geometry: _Point


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


class _WeatherData(_Model):
    id: int
    sensor_values: list[dict[str, object]] = Field(default=[], alias="sensorValues")


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


@dataclass(frozen=True, slots=True)
class WeatherStation:
    """A road weather station location."""

    id: int
    lat: float
    lon: float


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
            )
        )
    return cameras


def to_weather_stations(resp: WeatherStationsResponse) -> list[WeatherStation]:
    """Convert the weather-station list to domain objects."""
    return [
        WeatherStation(id=f.id, lat=f.geometry.coordinates[1], lon=f.geometry.coordinates[0])
        for f in resp.features
    ]


def to_capture_times(resp: CameraStationDataResponse) -> dict[str, datetime]:
    """Map preset id to the capture time of its latest image."""
    return {p.id: p.measured_time for s in resp.stations for p in s.presets if p.measured_time}
