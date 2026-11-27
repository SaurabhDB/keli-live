"""Record winter maintenance tracks and road weather forecasts (raw, gzipped) each cycle."""

import gzip
import logging
from datetime import datetime, timedelta

from keli.config import Settings
from keli.digitraffic.client import DigitrafficClient
from keli.storage.objects import ImageStore, forecasts_key, maintenance_key, metadata_key

logger = logging.getLogger(__name__)


async def record_maintenance(
    client: DigitrafficClient,
    store: ImageStore,
    settings: Settings,
    since: datetime | None,
    now: datetime,
) -> int:
    """Store tracks completed since the last fetch (a little overlap); returns the count.

    After a restart ``since`` is None and the last ``maintenance_initial_lookback_s`` are
    fetched; the importer de-duplicates by track id, so overlaps are harmless.
    """
    start = since or now - timedelta(seconds=settings.maintenance_initial_lookback_s)
    start -= timedelta(seconds=settings.maintenance_overlap_s)
    fetched = await client.maintenance_routes(start, settings.maintenance_tasks)
    if fetched.value:
        await store.put(maintenance_key(now), gzip.compress(fetched.raw))
    return len(fetched.value)


async def record_forecasts(
    client: DigitrafficClient, store: ImageStore, last_issued: datetime | None
) -> datetime | None:
    """Store the road weather forecast if a new issue is out; returns its issue time."""
    fetched = await client.road_forecasts()
    if not fetched.value:
        return last_issued
    issued = fetched.value[0].issued_at
    if issued != last_issued:
        await store.put(forecasts_key(issued), gzip.compress(fetched.raw))
        logger.info("forecast_saved", extra={"fields": {"issued_at": issued.isoformat()}})
    return issued


async def record_forecast_sections(
    client: DigitrafficClient, store: ImageStore, now: datetime
) -> int:
    """Daily snapshot of the forecast sections' geometry (for the database import)."""
    fetched = await client.forecast_sections()
    await store.put(metadata_key("forecast_sections", now), gzip.compress(fetched.raw))
    return len(fetched.value)
