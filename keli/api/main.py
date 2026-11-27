"""FastAPI app: ``uvicorn keli.api.main:app``."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from keli import ATTRIBUTION, __version__
from keli.api.live import LiveRepository
from keli.api.provider import DataProvider
from keli.api.routes import router
from keli.api.web import web_app
from keli.config import Settings
from keli.digitraffic.client import DigitrafficClient
from keli.digitraffic.ratelimit import RateLimiter
from keli.log import configure_logging


def create_app(settings: Settings | None = None, provider: DataProvider | None = None) -> FastAPI:
    """Build the app; pass ``provider`` to choose data sources (tests)."""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging()
        if provider is not None:
            app.state.provider = provider
            yield
            return
        async with AsyncExitStack() as stack:
            live = None
            if settings.live_fallback:
                limiter = RateLimiter(settings.rate_limit_requests, settings.rate_limit_window_s)
                client = await stack.enter_async_context(DigitrafficClient(settings, limiter))
                live = LiveRepository(client, settings)
            app.state.provider = DataProvider(settings, live)
            stack.push_async_callback(app.state.provider.close)
            await app.state.provider.start()
            yield

    app = FastAPI(
        title="Keli Live API",
        version=__version__,
        description=f"Road-surface conditions for Finnish road cameras. {ATTRIBUTION}",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.api_cors_origins, allow_methods=["GET"]
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)  # map JSON compresses ~8x
    app.include_router(router)
    # Mounted last, so /v1 routes and /docs win; everything else is the web app.
    web = web_app(settings.web_dist_dir)
    if web is not None:
        app.mount("/", web, name="web")
    return app


app = create_app()
