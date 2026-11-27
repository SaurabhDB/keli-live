"""Run the recorder: ``python -m keli.ingest`` (continuous) or ``--once`` (one cycle)."""

import argparse
import asyncio
import logging
from datetime import UTC, datetime

from keli.config import Settings
from keli.digitraffic.client import DigitrafficClient
from keli.digitraffic.ratelimit import RateLimiter
from keli.ingest.scheduler import RecorderState, run_cycle, run_forever
from keli.log import configure_logging
from keli.storage.objects import LocalImageStore

logger = logging.getLogger("keli.ingest")


async def _main(once: bool, settings: Settings) -> None:
    limiter = RateLimiter(settings.rate_limit_requests, settings.rate_limit_window_s)
    store = LocalImageStore(settings.data_dir)
    async with DigitrafficClient(settings, limiter) as client:
        if once:
            now = datetime.now(UTC)
            report = await run_cycle(client, store, RecorderState(), settings, now)
            logger.info("cycle_done", extra={"fields": report.as_fields()})
        else:  # pragma: no cover - runs until stopped
            await run_forever(client, store, settings)


def main(argv: list[str] | None = None) -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(prog="python -m keli.ingest", description=__doc__)
    parser.add_argument("--once", action="store_true", help="run one cycle and exit")
    args = parser.parse_args(argv)
    configure_logging()
    asyncio.run(_main(args.once, Settings()))


if __name__ == "__main__":  # pragma: no cover
    main()
