"""Choose the data source per request: PostgreSQL first, Digitraffic live as the fallback."""

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal

import asyncpg
from fastapi import HTTPException

from keli.api.repository import DatabaseRepository, Repository
from keli.config import Settings
from keli.errors import KeliError, StorageError
from keli.storage.db import Pool, create_pool

logger = logging.getLogger(__name__)

Source = Literal["database", "digitraffic_live"]
# Errors that mean "the database is unreachable", not "the query is wrong".
DB_DOWN_ERRORS = (
    OSError,
    TimeoutError,
    asyncpg.PostgresConnectionError,
    asyncpg.CannotConnectNowError,  # server starting up or shutting down
    asyncpg.InterfaceError,
)
HTTP_UNAVAILABLE = 503


class DataProvider:
    """Run each request against the database, or against the live fallback when it is down.

    After a failure the database is skipped for ``db_retry_s`` and then tried again, so the
    API switches back on its own once PostgreSQL returns.
    """

    def __init__(
        self,
        settings: Settings,
        live: Repository | None,
        connect: Callable[[Settings], Awaitable[Pool]] = create_pool,
    ) -> None:
        """``live`` is None when the fallback is disabled; ``connect`` is injectable for tests."""
        self._settings = settings
        self._live = live
        self._connect = connect
        self._pool: Pool | None = None
        self._db: Repository | None = None
        self._skip_db_until = 0.0

    async def start(self) -> None:
        """Connect if possible; never fail startup because the database is down."""
        await self._ensure_db()

    async def close(self) -> None:
        """Close the database pool."""
        if self._pool is not None:
            await self._pool.close()

    def use_database(self, repo: Repository) -> None:
        """Serve from ``repo`` as the database (tests)."""
        self._db = repo

    async def _ensure_db(self) -> Repository | None:
        if time.monotonic() < self._skip_db_until:
            return None
        if self._db is None:
            try:
                self._pool = await self._connect(self._settings)
                self._db = DatabaseRepository(self._pool)
                logger.info("database_connected")
            except (*DB_DOWN_ERRORS, StorageError) as exc:
                self._mark_down(exc)
        return self._db

    def _mark_down(self, exc: BaseException) -> None:
        self._skip_db_until = time.monotonic() + self._settings.db_retry_s
        logger.warning(
            "database_unavailable",
            extra={"fields": {"error": f"{type(exc).__name__}: {exc}", "live": bool(self._live)}},
        )

    async def run[T](self, query: Callable[[Repository], Awaitable[T]]) -> tuple[T, Source]:
        """``query`` against the database, else against Digitraffic; also returns the source."""
        db = await self._ensure_db()
        if db is not None:
            try:
                return await query(db), "database"
            except DB_DOWN_ERRORS as exc:
                self._mark_down(exc)
        if self._live is None:
            raise HTTPException(HTTP_UNAVAILABLE, "database unavailable and live fallback is off")
        try:
            return await query(self._live), "digitraffic_live"
        except KeliError as exc:
            raise HTTPException(
                HTTP_UNAVAILABLE, f"database and Digitraffic unavailable: {exc}"
            ) from exc
