"""Load recorded maintenance tracks and road weather forecasts into PostgreSQL.

Same pattern as the sensor import: each raw file is loaded once (``import_log``), rows are
idempotent (``ON CONFLICT``), and the raw files stay the source of truth.
"""

import gzip
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from keli.digitraffic.models import (
    ForecastSectionsResponse,
    MaintenanceRoutesResponse,
    RoadForecastsResponse,
    to_forecast_sections,
    to_maintenance_routes,
    to_road_forecasts,
)
from keli.storage.db import Pool
from keli.storage.objects import ImageStore

logger = logging.getLogger(__name__)

# ST_Force2D: Digitraffic sends [lon, lat, 0]; ST_MakeValid guards odd GPS tracks.
GEOM = "ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)))::geography"

UPSERT_SECTIONS = f"""
INSERT INTO forecast_section (id, description, road_number, geom, updated_at)
SELECT id, description, road_number, {GEOM}, now()
FROM unnest($1::text[], $2::text[], $3::int[], $4::text[]) AS s(id, description, road_number, g)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description,
  road_number = EXCLUDED.road_number, geom = EXCLUDED.geom, updated_at = now()
"""  # noqa: S608 - GEOM is a constant, values are bound parameters

INSERT_ROUTES = f"""
INSERT INTO maintenance_route (id, start_time, end_time, tasks, geom)
SELECT id, start_time, end_time, string_to_array(tasks, ','), {GEOM}
FROM unnest($1::bigint[], $2::timestamptz[], $3::timestamptz[], $4::text[], $5::text[])
     AS r(id, start_time, end_time, tasks, g)
ON CONFLICT (id) DO NOTHING
"""  # noqa: S608 - GEOM is a constant, values are bound parameters

INSERT_FORECASTS = """
INSERT INTO road_forecast (section_id, issued_at, name, valid_at, kind, road_temp_c,
  air_temp_c, road_condition, overall_condition)
SELECT f.* FROM unnest($1::text[], $2::timestamptz[], $3::text[], $4::timestamptz[], $5::text[],
  $6::real[], $7::real[], $8::text[], $9::text[])
  AS f(section_id, issued_at, name, valid_at, kind, road_temp_c, air_temp_c, road_condition,
       overall_condition)
WHERE EXISTS (SELECT 1 FROM forecast_section s WHERE s.id = f.section_id)
ON CONFLICT DO NOTHING
"""

Loader = Callable[[Any, bytes], Awaitable[int]]  # (connection, raw JSON) -> rows


async def _load_sections(conn: Any, raw: bytes) -> int:
    sections = to_forecast_sections(ForecastSectionsResponse.model_validate_json(raw))
    await conn.execute(
        UPSERT_SECTIONS,
        [s.id for s in sections],
        [s.description for s in sections],
        [s.road_number for s in sections],
        [s.geojson for s in sections],
    )
    return len(sections)


async def _load_routes(conn: Any, raw: bytes) -> int:
    routes = to_maintenance_routes(MaintenanceRoutesResponse.model_validate_json(raw))
    await conn.execute(
        INSERT_ROUTES,
        [r.id for r in routes],
        [r.start_time for r in routes],
        [r.end_time for r in routes],
        [",".join(r.tasks) for r in routes],
        [r.geojson for r in routes],
    )
    return len(routes)


async def _load_forecasts(conn: Any, raw: bytes) -> int:
    rows = to_road_forecasts(RoadForecastsResponse.model_validate_json(raw))
    await conn.execute(
        INSERT_FORECASTS,
        [f.section_id for f in rows],
        [f.issued_at for f in rows],
        [f.name for f in rows],
        [f.valid_at for f in rows],
        [f.kind for f in rows],
        [f.road_temp_c for f in rows],
        [f.air_temp_c for f in rows],
        [f.road_condition for f in rows],
        [f.overall_condition for f in rows],
    )
    return len(rows)


async def _import_new(pool: Pool, store: ImageStore, keys: list[str], load: Loader) -> int:
    async with pool.acquire() as conn:
        done = {r["key"] for r in await conn.fetch("SELECT key FROM import_log")}
    todo = [k for k in keys if k not in done]
    for key in todo:
        raw = gzip.decompress(await store.get(key))
        async with pool.acquire() as conn, conn.transaction():
            rows = await load(conn, raw)
            await conn.execute("INSERT INTO import_log (key, rows) VALUES ($1, $2)", key, rows)
    return len(todo)


async def import_road_info(pool: Pool, store: ImageStore) -> dict[str, int]:
    """Forecast sections (newest snapshot), then new forecast and maintenance files."""
    sections = [k for k in await store.keys("meta/") if k.endswith("/forecast_sections.json.gz")]
    counts = {
        "forecast_sections": await _import_new(pool, store, sections[-1:], _load_sections),
        "forecasts": await _import_new(
            pool, store, await store.keys("forecasts/"), _load_forecasts
        ),
        "maintenance": await _import_new(
            pool, store, await store.keys("maintenance/"), _load_routes
        ),
    }
    if any(counts.values()):
        logger.info("road_info_imported", extra={"fields": counts})
    return counts
