import asyncio

from keli.digitraffic.ratelimit import RateLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.starts: list[float] = []

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds


async def test_requests_are_spaced_evenly_at_the_configured_rate() -> None:
    clock = FakeClock()
    limiter = RateLimiter(1200, 300.0, clock=clock, sleep=clock.sleep)

    for _ in range(5):
        await limiter.acquire()
        clock.starts.append(clock.now)

    assert limiter.interval_s == 0.25
    assert clock.starts == [0.0, 0.25, 0.5, 0.75, 1.0]


async def test_never_more_than_the_limit_in_any_window() -> None:
    clock = FakeClock()
    limiter = RateLimiter(10, 5.0, clock=clock, sleep=clock.sleep)

    for _ in range(35):
        await limiter.acquire()
        clock.starts.append(clock.now)

    for start in clock.starts:
        in_window = [t for t in clock.starts if start <= t < start + 5.0]
        assert len(in_window) <= 10


async def test_idle_time_is_not_saved_up_as_a_burst() -> None:
    clock = FakeClock()
    limiter = RateLimiter(4, 1.0, clock=clock, sleep=clock.sleep)
    await limiter.acquire()
    clock.now = 100.0  # long idle period

    for _ in range(3):
        await limiter.acquire()
        clock.starts.append(clock.now)

    assert clock.starts == [100.0, 100.25, 100.5]


async def test_concurrent_callers_get_distinct_slots() -> None:
    clock = FakeClock()
    limiter = RateLimiter(2, 1.0, clock=clock, sleep=clock.sleep)

    async def call() -> float:
        await limiter.acquire()
        return clock.now

    starts = await asyncio.gather(*(call() for _ in range(4)))

    assert sorted(starts) == [0.0, 0.5, 1.0, 1.5]
