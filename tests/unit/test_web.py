"""The API serves the built web app: files, caching, SPA fallback, API routes untouched."""

from pathlib import Path

from fastapi.testclient import TestClient

from keli.api.main import create_app
from keli.api.provider import DataProvider
from keli.config import Settings


def make_dist(root: Path) -> Path:
    dist = root / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Keli Live</title>")
    (dist / "config.json").write_text('{"apiBase": ""}')
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
    return dist


async def no_db(_: Settings) -> object:
    raise OSError("no database in this test")


def client(tmp_path: Path, dist: Path | None) -> TestClient:
    settings = Settings(_env_file=None, web_dist_dir=dist, data_dir=tmp_path)
    return TestClient(create_app(settings, DataProvider(settings, live=None, connect=no_db)))


def test_index_and_spa_fallback(tmp_path: Path) -> None:
    with client(tmp_path, make_dist(tmp_path)) as c:
        assert "Keli Live" in c.get("/").text
        deep = c.get("/some/client/route")
        assert deep.status_code == 200
        assert "Keli Live" in deep.text
        assert deep.headers["cache-control"] == "no-cache"


def test_hashed_assets_are_cached_long_and_missing_ones_404(tmp_path: Path) -> None:
    with client(tmp_path, make_dist(tmp_path)) as c:
        js = c.get("/assets/index-abc123.js")
        assert js.status_code == 200
        assert "immutable" in js.headers["cache-control"]
        assert c.get("/assets/missing.js").status_code == 404


def test_api_routes_are_not_swallowed(tmp_path: Path) -> None:
    with client(tmp_path, make_dist(tmp_path)) as c:
        assert c.get("/v1/health").status_code == 503  # API answered (no DB, no fallback)
        assert c.get("/config.json").json() == {"apiBase": ""}


def test_without_a_build_only_the_api_is_served(tmp_path: Path) -> None:
    with client(tmp_path, tmp_path / "nope") as c:
        assert c.get("/").status_code == 404
