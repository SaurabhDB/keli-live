"""One full recorder cycle against recorded Digitraffic fixtures, writing to a temp dir."""

import gzip
import json
from collections.abc import Callable
from datetime import UTC, datetime

import httpx
import pytest

from keli.config import Settings
from keli.digitraffic.client import DigitrafficClient
from keli.ingest import __main__ as cli
from keli.ingest.scheduler import RecorderState, run_cycle
from keli.storage.objects import LocalImageStore
from tests.conftest import FAKE_JPEG, recorded_api

MakeClient = Callable[..., DigitrafficClient]
NOW = datetime(2026, 11, 24, 5, 40, 5, tzinfo=UTC)


async def test_first_cycle_stores_thumbnails_full_images_and_sensors(
    make_client: MakeClient, settings: Settings
) -> None:
    store = LocalImageStore(settings.data_dir)
    async with make_client() as client:
        report = await run_cycle(client, store, RecorderState(), settings, NOW)

    root = settings.data_dir
    assert report.thumbs_saved == 6
    assert report.full_saved == 1  # 3 training presets spread over 6 cycles
    assert report.failures == 0
    assert report.sensor_stations == 2
    assert (root / "thumbs/2026/11/24/C0150401/0535.jpg").read_bytes() == FAKE_JPEG
    assert len(list((root / "full").rglob("*.jpg"))) == 1
    sensors = json.loads(gzip.decompress((root / "sensors/2026/11/24/0540.json.gz").read_bytes()))
    assert len(sensors["stations"]) == 2
    assert (root / "meta/2026/11/24/cameras.json.gz").is_file()


async def test_second_cycle_skips_unchanged_images(
    make_client: MakeClient, settings: Settings
) -> None:
    store = LocalImageStore(settings.data_dir)
    state = RecorderState()
    image_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal image_requests
        image_requests += request.url.host == "weathercam.digitraffic.fi"
        return recorded_api(request)

    async with make_client(handler) as client:
        await run_cycle(client, store, state, settings, NOW)
        image_requests = 0
        report = await run_cycle(client, store, state, settings, NOW.replace(minute=50))

    assert report.unchanged == 6
    assert report.thumbs_saved == 0
    assert image_requests == 1  # only the next training preset's full image


async def test_restart_does_not_download_stored_images_again(
    make_client: MakeClient, settings: Settings
) -> None:
    store = LocalImageStore(settings.data_dir)
    async with make_client() as client:
        await run_cycle(client, store, RecorderState(), settings, NOW)
        report = await run_cycle(client, store, RecorderState(), settings, NOW)  # fresh state

    assert report.already_stored == 7
    assert report.thumbs_saved == 0


async def test_failing_image_is_counted_and_the_cycle_continues(
    make_client: MakeClient, settings: Settings
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "C0150301" in request.url.path:
            return httpx.Response(404)
        return recorded_api(request)

    async with make_client(handler) as client:
        report = await run_cycle(
            client, LocalImageStore(settings.data_dir), RecorderState(), settings, NOW
        )

    assert report.failures == 1
    assert report.thumbs_saved == 5


async def test_api_outage_is_reported_not_raised(
    make_client: MakeClient, settings: Settings
) -> None:
    async with make_client(lambda _: httpx.Response(503)) as client:
        report = await run_cycle(
            client, LocalImageStore(settings.data_dir), RecorderState(), settings, NOW
        )

    assert report.failures == 2  # sensors + image planning
    assert report.thumbs_saved == 0


def test_cli_once_runs_one_cycle(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    def offline_client(*args: object, **kwargs: object) -> DigitrafficClient:
        return DigitrafficClient(*args, transport=httpx.MockTransport(recorded_api), **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr("keli.ingest.__main__.DigitrafficClient", offline_client)
    # --once uses the real clock; fixtures were recorded on 24 Nov 2026, so allow old images.
    settings.max_image_age_s = 100 * 365 * 86400.0
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(cli, "configure_logging", lambda: None)

    with caplog.at_level("INFO"):
        cli.main(["--once"])

    assert "cycle_done" in caplog.messages
    assert (settings.data_dir / "thumbs").is_dir()
