"""Shared fixtures: recorded Digitraffic responses served through httpx.MockTransport."""

from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from keli.config import Settings
from keli.digitraffic.client import DigitrafficClient
from keli.digitraffic.ratelimit import RateLimiter

FIXTURES = Path(__file__).parent / "fixtures" / "digitraffic"
# Not a real camera image: tests must not depend on (or commit) Digitraffic images.
FAKE_JPEG = b"\xff\xd8\xff\xe0fake-jpeg\xff\xd9"

JSON_ROUTES = {
    "/api/weathercam/v1/stations": "camera_stations.json",
    "/api/weathercam/v1/stations/data": "camera_station_data.json",
    "/api/weather/v1/stations": "weather_stations.json",
    "/api/weather/v1/stations/data": "weather_station_data.json",
}

Handler = Callable[[httpx.Request], httpx.Response]


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def recorded_api(request: httpx.Request) -> httpx.Response:
    """Answer like Digitraffic, from the recorded fixtures."""
    if request.url.host == "weathercam.digitraffic.fi":
        return httpx.Response(200, content=FAKE_JPEG, headers={"content-type": "image/jpeg"})
    name = JSON_ROUTES.get(request.url.path)
    if name is None:
        return httpx.Response(404)
    return httpx.Response(200, content=fixture_bytes(name))


class NoSleep:
    """Records requested sleeps instead of waiting."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", _env_file=None)


@pytest.fixture
def make_client(settings: Settings) -> Callable[..., DigitrafficClient]:
    def make(handler: Handler = recorded_api, sleep: NoSleep | None = None) -> DigitrafficClient:
        limiter = RateLimiter(1_000_000, 1.0)  # effectively unlimited in tests
        return DigitrafficClient(
            settings, limiter, transport=httpx.MockTransport(handler), sleep=sleep or NoSleep()
        )

    return make
