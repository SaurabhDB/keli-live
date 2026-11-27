"""Async Digitraffic client with rate limiting and retries."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from types import TracebackType
from typing import Self

import httpx
from pydantic import BaseModel, ValidationError

from keli import USER_AGENT
from keli.config import Settings
from keli.digitraffic.models import (
    Camera,
    CameraStationDataResponse,
    CameraStationsResponse,
    ForecastSection,
    ForecastSectionsResponse,
    MaintenanceRoute,
    MaintenanceRoutesResponse,
    RoadForecast,
    RoadForecastsResponse,
    SensorReading,
    WeatherStation,
    WeatherStationDataResponse,
    WeatherStationsResponse,
    to_cameras,
    to_capture_times,
    to_forecast_sections,
    to_maintenance_routes,
    to_road_forecasts,
    to_sensor_readings,
    to_weather_stations,
)
from keli.digitraffic.ratelimit import RateLimiter, Sleep
from keli.errors import DataValidationError, DigitrafficError

logger = logging.getLogger(__name__)

# LLD 5.1: three retries with exponential backoff (1, 4, 16 s).
RETRY_DELAYS_S = (1.0, 4.0, 16.0)
HTTP_SERVER_ERROR = 500
HTTP_TOO_MANY_REQUESTS = 429

Params = dict[str, str] | tuple[tuple[str, str], ...] | None  # pairs allow repeated keys


def _iso(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True, slots=True)
class Fetched[T]:
    """A parsed value plus the raw response body, kept for reprocessing."""

    value: T
    raw: bytes


def _is_retryable(status: int) -> bool:
    return status >= HTTP_SERVER_ERROR or status == HTTP_TOO_MANY_REQUESTS


class DigitrafficClient:
    """Typed access to the Digitraffic endpoints Keli Live uses.

    Every request, JSON or image, waits for the shared rate limiter, so the whole
    process stays within the configured budget.
    """

    def __init__(
        self,
        settings: Settings,
        limiter: RateLimiter,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        """Create the client; ``transport`` and ``sleep`` are injectable for tests."""
        self._settings = settings
        self._limiter = limiter
        self._sleep = sleep
        self._http = httpx.AsyncClient(
            headers={"Digitraffic-User": USER_AGENT, "Accept-Encoding": "gzip"},
            transport=transport,
            follow_redirects=True,
        )

    async def __aenter__(self) -> Self:
        """Open the client."""
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        """Close the underlying HTTP connections."""
        await self._http.aclose()

    async def cameras(self) -> Fetched[list[Camera]]:
        """All camera stations with their presets."""
        resp, raw = await self._json("/api/weathercam/v1/stations", CameraStationsResponse)
        return Fetched(to_cameras(resp), raw)

    async def weather_stations(self) -> Fetched[list[WeatherStation]]:
        """All road weather station locations."""
        resp, raw = await self._json("/api/weather/v1/stations", WeatherStationsResponse)
        return Fetched(to_weather_stations(resp), raw)

    async def capture_times(self) -> dict[str, datetime]:
        """Capture time of the latest image of every preset (one request for all)."""
        resp, _ = await self._json("/api/weathercam/v1/stations/data", CameraStationDataResponse)
        return to_capture_times(resp)

    async def weather_station_data(self) -> Fetched[int]:
        """Latest sensor readings of all stations; the value is the station count."""
        resp, raw = await self._json("/api/weather/v1/stations/data", WeatherStationDataResponse)
        return Fetched(len(resp.stations), raw)

    async def sensor_readings(self, sensors: frozenset[str]) -> list[SensorReading]:
        """Latest readings of the named sensors at every station (one request)."""
        resp, _ = await self._json("/api/weather/v1/stations/data", WeatherStationDataResponse)
        return to_sensor_readings(resp, sensors)

    async def maintenance_routes(
        self, ended_from: datetime, tasks: list[str]
    ) -> Fetched[list[MaintenanceRoute]]:
        """Maintenance tracks completed since ``ended_from`` that include any of ``tasks``."""
        params = (("endFrom", _iso(ended_from)), *(("taskId", t) for t in tasks))
        resp, raw = await self._json(
            "/api/maintenance/v1/tracking/routes", MaintenanceRoutesResponse, params
        )
        return Fetched(to_maintenance_routes(resp), raw)

    async def forecast_sections(self) -> Fetched[list[ForecastSection]]:
        """Road sections that have their own road weather forecast (static, daily)."""
        resp, raw = await self._json(
            "/api/weather/v2/forecast-sections-simple", ForecastSectionsResponse
        )
        return Fetched(to_forecast_sections(resp), raw)

    async def road_forecasts(self) -> Fetched[list[RoadForecast]]:
        """Current road weather forecasts of every section (issued about hourly)."""
        resp, raw = await self._json(
            "/api/weather/v2/forecast-sections-simple/forecasts", RoadForecastsResponse
        )
        return Fetched(to_road_forecasts(resp), raw)

    async def image(self, preset_id: str, *, thumbnail: bool) -> bytes:
        """Latest JPEG of a preset, full size or the ~20 KB thumbnail."""
        url = f"{self._settings.image_base_url}/{preset_id}.jpg"
        params = {"thumbnail": "true"} if thumbnail else None
        resp = await self._get(url, params=params, timeout_s=self._settings.image_timeout_s)
        return resp.content

    async def _json[M: BaseModel](
        self, path: str, model: type[M], params: Params = None
    ) -> tuple[M, bytes]:
        url = self._settings.digitraffic_base_url + path
        resp = await self._get(url, params=params, timeout_s=self._settings.json_timeout_s)
        try:
            return model.model_validate_json(resp.content), resp.content
        except ValidationError as exc:
            raise DataValidationError(f"{path}: unexpected response shape: {exc}") from exc

    async def _get(self, url: str, *, params: Params, timeout_s: float) -> httpx.Response:
        """GET with the rate limiter; retry only transient failures (5xx, 429, network)."""
        query = httpx.QueryParams(params) if params else None
        for attempt in range(len(RETRY_DELAYS_S) + 1):
            await self._limiter.acquire()
            try:
                resp = await self._http.get(url, params=query, timeout=timeout_s)
            except httpx.TransportError as exc:  # timeouts and connection errors
                reason = f"{type(exc).__name__}: {exc}"
            else:
                if resp.is_success:
                    return resp
                if not _is_retryable(resp.status_code):
                    raise DigitrafficError(f"{url}: HTTP {resp.status_code}")
                reason = f"HTTP {resp.status_code}"
            if attempt == len(RETRY_DELAYS_S):
                break
            delay = RETRY_DELAYS_S[attempt]
            logger.warning(
                "digitraffic_retry",
                extra={"fields": {"url": url, "attempt": attempt + 1, "reason": reason}},
            )
            await self._sleep(delay)
        raise DigitrafficError(f"{url}: gave up after {len(RETRY_DELAYS_S)} retries ({reason})")
