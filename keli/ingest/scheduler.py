"""The recording cycle: every 10 minutes, sensors plus every changed image.

Request budget per cycle (defaults): one rate-limiter slot every 0.25 s gives 2,400 slots
in 10 minutes. A cycle uses ~2,282 thumbnails + ~1/6 of the training presets' full images
+ 2 JSON calls, so it fits; requests are spaced evenly by the limiter, never burst.
"""

import asyncio
import gzip
import logging
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from keli.config import Settings
from keli.digitraffic.client import DigitrafficClient
from keli.errors import KeliError
from keli.ingest.cameras import (
    ImageJob,
    Outcome,
    collecting_presets,
    record_image,
    training_presets,
)
from keli.ingest.roadinfo import record_forecast_sections, record_forecasts, record_maintenance
from keli.ingest.sensors import record_sensors
from keli.storage.objects import ImageStore, metadata_key

logger = logging.getLogger(__name__)


@dataclass
class RecorderState:
    """What the recorder remembers between cycles (in memory; rebuilt after a restart)."""

    presets: list[str] = field(default_factory=list)
    training: frozenset[str] = frozenset()
    metadata_at: datetime | None = None
    last_thumb: dict[str, datetime] = field(default_factory=dict)  # preset -> capture time
    last_full: dict[str, datetime] = field(default_factory=dict)  # preset -> fetch time
    maintenance_since: datetime | None = None  # start of the last maintenance fetch
    forecast_issued: datetime | None = None  # issue time of the last stored forecast
    sections_at: datetime | None = None  # last forecast-section snapshot


@dataclass
class CycleReport:
    """Counts for one cycle, logged as one structured line."""

    started_at: datetime
    duration_s: float = 0.0
    thumbs_saved: int = 0
    full_saved: int = 0
    already_stored: int = 0
    unchanged: int = 0
    frozen: int = 0
    failures: int = 0
    sensor_stations: int = 0
    maintenance_routes: int = 0

    def as_fields(self) -> dict[str, object]:
        """Fields for the structured log line."""
        return dict(vars(self))


class Plan(NamedTuple):
    """Images to fetch this cycle, plus counts of presets skipped and why."""

    jobs: list[ImageJob]
    unchanged: int
    frozen: int


def plan_jobs(
    capture_times: dict[str, datetime],
    state: RecorderState,
    settings: Settings,
    now: datetime,
) -> Plan:
    """Decide which images to fetch this cycle.

    Frozen presets (latest image older than ``max_image_age_s``) are skipped entirely.
    Thumbnails: every other collecting preset whose capture time moved since the last stored
    one. Full images: training presets not fetched in the last hour, capped per cycle so the
    hourly load is spread over all cycles of the hour instead of one burst.
    """
    max_age = timedelta(seconds=settings.max_image_age_s)
    fresh = {p: t for p, t in capture_times.items() if now - t <= max_age}
    jobs: list[ImageJob] = []
    unchanged = frozen = 0
    for preset in state.presets:
        captured = fresh.get(preset)
        if captured is None:
            frozen += preset in capture_times
            continue
        if state.last_thumb.get(preset) == captured:
            unchanged += 1
        else:
            jobs.append(ImageJob(preset, thumbnail=True, captured_at=captured))
    jobs.extend(_due_full_images(fresh, state, settings, now))
    return Plan(jobs, unchanged, frozen)


def _due_full_images(
    capture_times: dict[str, datetime], state: RecorderState, settings: Settings, now: datetime
) -> list[ImageJob]:
    cycles_per_interval = max(1.0, settings.full_image_interval_s / settings.cycle_s)
    cap = math.ceil(len(state.training) / cycles_per_interval)
    # Half a cycle of slack so a preset fetched at :00:30 is due again at :59:50.
    min_age_s = settings.full_image_interval_s - settings.cycle_s / 2
    epoch = datetime.min.replace(tzinfo=UTC)
    due = [
        p
        for p in state.training
        if p in capture_times and (now - state.last_full.get(p, epoch)).total_seconds() >= min_age_s
    ]
    due.sort(key=lambda p: state.last_full.get(p, epoch))  # oldest first
    return [ImageJob(p, thumbnail=False, captured_at=capture_times[p]) for p in due[:cap]]


async def refresh_metadata(
    client: DigitrafficClient,
    store: ImageStore,
    state: RecorderState,
    settings: Settings,
    now: datetime,
) -> None:
    """Reload cameras and stations once a day; store raw snapshots for the database import."""
    cameras = await client.cameras()
    stations = await client.weather_stations()
    await store.put(metadata_key("cameras", now), gzip.compress(cameras.raw))
    await store.put(metadata_key("weather_stations", now), gzip.compress(stations.raw))
    state.presets = collecting_presets(cameras.value)
    state.training = training_presets(cameras.value, stations.value, settings.training_radius_km)
    state.metadata_at = now
    logger.info(
        "metadata_refreshed",
        extra={"fields": {"presets": len(state.presets), "training": len(state.training)}},
    )


async def run_cycle(
    client: DigitrafficClient,
    store: ImageStore,
    state: RecorderState,
    settings: Settings,
    now: datetime,
) -> CycleReport:
    """Run one cycle. A failing image or sensor call is logged and counted, never fatal."""
    report = CycleReport(started_at=now)
    t0 = time.monotonic()
    try:
        report.sensor_stations = await record_sensors(client, store, now)
    except KeliError:
        report.failures += 1
        logger.exception("sensors_failed")
    await _record_road_info(client, store, state, settings, report)
    stale = state.metadata_at is None or (
        (now - state.metadata_at).total_seconds() >= settings.metadata_refresh_s
    )
    try:
        if stale:
            await refresh_metadata(client, store, state, settings, now)
        capture_times = await client.capture_times()
    except KeliError:
        # Without metadata or capture times no image can be planned; retry next cycle.
        report.failures += 1
        logger.exception("image_planning_failed")
        capture_times = {}
    jobs, report.unchanged, report.frozen = plan_jobs(capture_times, state, settings, now)
    await _run_jobs(
        client,
        store,
        jobs,
        settings.workers,
        lambda job, outcome: _account(job, outcome, state, report, now),
    )
    report.duration_s = round(time.monotonic() - t0, 1)
    return report


async def _record_road_info(
    client: DigitrafficClient,
    store: ImageStore,
    state: RecorderState,
    settings: Settings,
    report: CycleReport,
) -> None:
    """Maintenance tracks, forecasts and (daily) forecast sections; each fails on its own."""
    now = report.started_at
    try:
        report.maintenance_routes = await record_maintenance(
            client, store, settings, state.maintenance_since, now
        )
        state.maintenance_since = now
    except KeliError:
        report.failures += 1
        logger.exception("maintenance_failed")
    try:
        state.forecast_issued = await record_forecasts(client, store, state.forecast_issued)
        due = state.sections_at is None or (
            (now - state.sections_at).total_seconds() >= settings.metadata_refresh_s
        )
        if due:
            await record_forecast_sections(client, store, now)
            state.sections_at = now
    except KeliError:
        report.failures += 1
        logger.exception("forecasts_failed")


async def _run_jobs(
    client: DigitrafficClient,
    store: ImageStore,
    jobs: list[ImageJob],
    workers: int,
    on_done: Callable[[ImageJob, Outcome | None], None],
) -> None:
    """Run jobs on ``workers`` concurrent workers; ``on_done`` gets None for a failed job."""
    queue: asyncio.Queue[ImageJob] = asyncio.Queue()
    for job in jobs:
        queue.put_nowait(job)

    async def worker() -> None:
        while not queue.empty():
            job = queue.get_nowait()
            try:
                outcome = await record_image(client, store, job)
            except KeliError as exc:
                logger.warning(
                    "image_failed",
                    extra={"fields": {"preset_id": job.preset_id, "error": str(exc)}},
                )
                on_done(job, None)
                continue
            on_done(job, outcome)

    async with asyncio.TaskGroup() as tg:
        for _ in range(min(workers, len(jobs))):
            tg.create_task(worker())


def _account(
    job: ImageJob,
    outcome: Outcome | None,
    state: RecorderState,
    report: CycleReport,
    now: datetime,
) -> None:
    if outcome is None:
        report.failures += 1
        return
    if job.thumbnail:
        state.last_thumb[job.preset_id] = job.captured_at
    else:
        state.last_full[job.preset_id] = now
    if outcome is Outcome.ALREADY_STORED:
        report.already_stored += 1
    elif job.thumbnail:
        report.thumbs_saved += 1
    else:
        report.full_saved += 1


def next_boundary(now: datetime, cycle_s: float) -> datetime:
    """Next wall-clock multiple of ``cycle_s`` (e.g. :00, :10, :20 for 10 minutes)."""
    ts = now.timestamp()
    return datetime.fromtimestamp((ts // cycle_s + 1) * cycle_s, UTC)


async def run_forever(
    client: DigitrafficClient, store: ImageStore, settings: Settings
) -> None:  # pragma: no cover - infinite loop; each cycle is tested via run_cycle
    """Run a cycle at every boundary; an overrunning cycle starts the next one at once."""
    state = RecorderState()
    while True:
        report = await run_cycle(client, store, state, settings, datetime.now(UTC))
        logger.info("cycle_done", extra={"fields": report.as_fields()})
        wait_s = next_boundary(datetime.now(UTC), settings.cycle_s) - datetime.now(UTC)
        await asyncio.sleep(max(0.0, wait_s.total_seconds()))
