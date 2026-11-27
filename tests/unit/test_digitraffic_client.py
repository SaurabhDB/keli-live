from collections.abc import Callable
from datetime import UTC, datetime

import httpx
import pytest

from keli import USER_AGENT
from keli.digitraffic.client import RETRY_DELAYS_S, DigitrafficClient
from keli.errors import DataValidationError, DigitrafficError
from tests.conftest import FAKE_JPEG, NoSleep, recorded_api

MakeClient = Callable[..., DigitrafficClient]


async def test_cameras_are_parsed_into_domain_objects(make_client: MakeClient) -> None:
    async with make_client() as client:
        fetched = await client.cameras()

    by_id = {c.id: c for c in fetched.value}
    assert set(by_id) == {"C01503", "C01504", "C01539"}
    assert by_id["C01504"].collecting
    assert not by_id["C01539"].collecting  # REMOVED_TEMPORARILY
    assert by_id["C01504"].preset_ids == ("C0150401", "C0150402", "C0150409")
    assert by_id["C01503"].lat == pytest.approx(60.05374)  # GeoJSON [lon, lat] swapped
    assert fetched.raw.startswith(b"{")


async def test_capture_times_are_utc_per_preset(make_client: MakeClient) -> None:
    async with make_client() as client:
        times = await client.capture_times()

    assert times["C0150401"] == datetime(2026, 11, 24, 5, 35, 29, tzinfo=UTC)
    assert len(times) == 7


async def test_weather_station_data_counts_stations(make_client: MakeClient) -> None:
    async with make_client() as client:
        fetched = await client.weather_station_data()

    assert fetched.value == 2


async def test_every_request_identifies_keli_live(make_client: MakeClient) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return recorded_api(request)

    async with make_client(handler) as client:
        await client.weather_stations()
        image = await client.image("C0150401", thumbnail=True)

    assert image == FAKE_JPEG
    assert all(r.headers["Digitraffic-User"] == USER_AGENT for r in seen)
    assert seen[1].url.params["thumbnail"] == "true"


async def test_server_errors_are_retried_with_backoff(make_client: MakeClient) -> None:
    responses = iter([httpx.Response(503), httpx.Response(502)])

    def handler(request: httpx.Request) -> httpx.Response:
        return next(responses, None) or recorded_api(request)

    sleep = NoSleep()
    async with make_client(handler, sleep) as client:
        assert await client.image("C0150401", thumbnail=False) == FAKE_JPEG

    assert sleep.calls == [1.0, 4.0]


async def test_timeouts_are_retried(make_client: MakeClient) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("slow", request=request)
        return recorded_api(request)

    async with make_client(handler) as client:
        assert await client.image("C0150401", thumbnail=True) == FAKE_JPEG
    assert calls == 2


async def test_gives_up_after_three_retries(make_client: MakeClient) -> None:
    sleep = NoSleep()
    async with make_client(lambda _: httpx.Response(500), sleep) as client:
        with pytest.raises(DigitrafficError, match="gave up after 3 retries"):
            await client.image("C0150401", thumbnail=True)

    assert sleep.calls == list(RETRY_DELAYS_S)


async def test_client_errors_are_not_retried(make_client: MakeClient) -> None:
    sleep = NoSleep()
    async with make_client(lambda _: httpx.Response(404), sleep) as client:
        with pytest.raises(DigitrafficError, match="HTTP 404"):
            await client.image("C9999999", thumbnail=True)

    assert sleep.calls == []


async def test_unexpected_shape_raises_validation_error(make_client: MakeClient) -> None:
    async with make_client(lambda _: httpx.Response(200, json={"oops": []})) as client:
        with pytest.raises(DataValidationError, match="unexpected response shape"):
            await client.cameras()
