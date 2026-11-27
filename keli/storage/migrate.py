"""``python -m keli.storage.migrate``: apply pending database migrations."""

import asyncio

import asyncpg

from keli.config import Settings
from keli.log import configure_logging
from keli.storage.db import dsn, migrate


async def _run(settings: Settings) -> None:
    conn = await asyncpg.connect(dsn(settings))
    try:
        await migrate(conn)
    finally:
        await conn.close()


def main() -> None:  # pragma: no cover - thin CLI wrapper, covered by the db tests
    """Entry point."""
    configure_logging()
    asyncio.run(_run(Settings()))


if __name__ == "__main__":  # pragma: no cover
    main()
