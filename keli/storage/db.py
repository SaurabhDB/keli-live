"""PostgreSQL access: connection pool and SQL migrations (asyncpg, plain SQL)."""

import logging
from importlib import resources
from typing import Any

import asyncpg

from keli.config import Settings
from keli.errors import StorageError

logger = logging.getLogger(__name__)

Pool = Any  # asyncpg ships no type hints; keep the alias in one place.


def dsn(settings: Settings) -> str:
    """The database URL from ``.env`` / environment; fails clearly when it is missing."""
    url = settings.database_url.get_secret_value() if settings.database_url else ""
    if not url:
        raise StorageError("KELI_DATABASE_URL is not set (see .env.example)")
    return url


async def create_pool(settings: Settings) -> Pool:
    """Open a small connection pool (size from ``db_pool_max``)."""
    return await asyncpg.create_pool(
        dsn(settings),
        min_size=1,
        max_size=settings.db_pool_max,
        timeout=settings.db_connect_timeout_s,  # fail fast so the API can fall back
        command_timeout=settings.db_connect_timeout_s * 2,
    )


def migration_files() -> list[tuple[str, str]]:
    """``(version, sql)`` for every file in ``keli/storage/migrations``, in name order."""
    folder = resources.files("keli.storage") / "migrations"
    files = sorted((f for f in folder.iterdir() if f.name.endswith(".sql")), key=lambda f: f.name)
    return [(f.name.removesuffix(".sql"), f.read_text(encoding="utf-8")) for f in files]


async def migrate(conn: Any) -> list[str]:
    """Apply pending migrations, each in its own transaction; returns versions applied."""
    await conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migration ("
        " version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    done = {r["version"] for r in await conn.fetch("SELECT version FROM schema_migration")}
    applied = []
    for version, sql in migration_files():
        if version in done:
            continue
        async with conn.transaction():
            await conn.execute(sql)
            await conn.execute("INSERT INTO schema_migration (version) VALUES ($1)", version)
        logger.info("migration_applied", extra={"fields": {"version": version}})
        applied.append(version)
    return applied
