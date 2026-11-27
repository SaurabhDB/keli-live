"""Even-spacing rate limiter."""

import asyncio
import time
from collections.abc import Awaitable, Callable

Sleep = Callable[[float], Awaitable[None]]


class RateLimiter:
    """Allow at most ``max_requests`` per ``window_s``, spaced evenly (never in bursts).

    Each caller gets the next free slot, ``window_s / max_requests`` seconds after the
    previous one. Evenly spaced slots can never exceed the limit in any window, which a
    token bucket with a large capacity cannot promise.
    """

    def __init__(
        self,
        max_requests: int,
        window_s: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        """Create a limiter; ``clock`` and ``sleep`` are injectable for tests."""
        self._interval = window_s / max_requests
        self._clock = clock
        self._sleep = sleep
        self._next_slot: float | None = None
        self._lock = asyncio.Lock()

    @property
    def interval_s(self) -> float:
        """Seconds between two consecutive requests."""
        return self._interval

    async def acquire(self) -> None:
        """Wait until the caller's slot; callers are served first come, first served."""
        async with self._lock:
            now = self._clock()
            slot = now if self._next_slot is None else max(now, self._next_slot)
            if slot > now:
                await self._sleep(slot - now)
            self._next_slot = slot + self._interval
