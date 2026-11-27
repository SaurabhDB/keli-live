"""Serve the built web app (frontend/dist) from the API process: one server, one port.

Hashed build files (``assets/``) are cached for a year; everything else (``index.html``,
``config.json``) is revalidated so a new deploy shows up at once. Unknown paths fall back to
``index.html`` so client-side routes still load. ``/v1`` API routes are matched first.
"""

from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

HTTP_NOT_FOUND = 404
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"


class WebApp(StaticFiles):
    """Static files with long caching for hashed assets and an index.html fallback."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        """File for ``path``; ``index.html`` for paths that are not files."""
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != HTTP_NOT_FOUND or path.startswith(("v1/", "assets/", "models/")):
                raise
            response = await super().get_response("index.html", scope)
        immutable = path.startswith(("assets/", "models/"))
        response.headers["Cache-Control"] = IMMUTABLE if immutable else REVALIDATE
        return response


def web_app(dist: Path | None) -> WebApp | None:
    """The web app for ``dist``, or None when it has not been built."""
    if dist is None or not (dist / "index.html").is_file():
        return None
    return WebApp(directory=dist, html=True)
