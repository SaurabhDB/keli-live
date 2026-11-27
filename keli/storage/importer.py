"""Load the recorder's raw files (``meta/``, ``sensors/``) into PostgreSQL.

``python -m keli.storage.importer`` imports everything new once; ``--watch`` repeats every
cycle so the API stays current. Imports are idempotent: ``import_log`` records each file,
and readings use ``ON CONFLICT DO NOTHING``. The raw files remain the source of truth, so
the database can always be rebuilt from them.
"""

import argparse
import asyncio
import gzip
import logging

from keli.config import Settings
from keli.digitraffic.models import (
    CameraStationsResponse,
    WeatherStationDataResponse,
    WeatherStationsResponse,
    to_cameras,
    to_sensor_readings,
    to_weather_stations,
)
from keli.ingest.validate import is_plausible
from keli.log import configure_logging
from keli.storage.db import Pool, create_pool
from keli.storage.import_roadinfo import import_road_info
from keli.storage.objects import ImageStore, LocalImageStore

logger = logging.getLogger(__name__)

UPSERT_STATIONS = """
INSERT INTO weather_station (id, name, geom, collection_status, updated_at)
SELECT id, name, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, status, now()
FROM unnest($1::int[], $2::text[], $3::float8[], $4::float8[], $5::text[])
     AS s(id, name, lon, lat, status)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom,
  collection_status = EXCLUDED.collection_status, updated_at = now()
"""

UPSERT_CAMERAS = """
INSERT INTO camera (id, name, geom, collection_status, updated_at)
SELECT id, name, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, status, now()
FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::text[])
     AS c(id, name, lon, lat, status)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom,
  collection_status = EXCLUDED.collection_status, updated_at = now()
"""

UPSERT_PRESETS = """
INSERT INTO preset (id, camera_id, in_collection)
SELECT * FROM unnest($1::text[], $2::text[], $3::bool[])
ON CONFLICT (id) DO UPDATE SET camera_id = EXCLUDED.camera_id,
  in_collection = EXCLUDED.in_collection
"""

# Presets missing from the latest snapshot are no longer collected.
RETIRE_PRESETS = "UPDATE preset SET in_collection = false WHERE NOT (id = ANY($1::text[]))"

# Nearest station per camera with a KNN index scan; training = station within the radius.
NEAREST_STATION = """
UPDATE camera c SET weather_station = n.station_id, station_dist_m = n.dist_m
FROM (
  SELECT c2.id AS camera_id, s.id AS station_id,
         round(ST_Distance(c2.geom, s.geom))::int AS dist_m
  FROM camera c2
  CROSS JOIN LATERAL (
    SELECT id, geom FROM weather_station ORDER BY geom <-> c2.geom LIMIT 1
  ) s
) n
WHERE n.camera_id = c.id
"""

MARK_TRAINING = """
UPDATE preset p SET is_training = (c.station_dist_m IS NOT NULL AND c.station_dist_m <= $1)
FROM camera c WHERE c.id = p.camera_id
"""

INSERT_READINGS = """
INSERT INTO sensor_reading (station_id, sensor, value, measured_at)
SELECT r.* FROM unnest($1::int[], $2::text[], $3::real[], $4::timestamptz[])
     AS r(station_id, sensor, value, measured_at)
WHERE EXISTS (SELECT 1 FROM weather_station w WHERE w.id = r.station_id)
ON CONFLICT DO NOTHING
"""


async def import_metadata(pool: Pool, store: ImageStore, settings: Settings) -> bool:
    """Load the newest camera and station snapshots; False if none is stored yet."""
    keys = await store.keys("meta/")
    cams = [k for k in keys if k.endswith("/cameras.json.gz")]
    stas = [k for k in keys if k.endswith("/weather_stations.json.gz")]
    if not cams or not stas:
        return False
    cameras = to_cameras(
        CameraStationsResponse.model_validate_json(gzip.decompress(await store.get(cams[-1])))
    )
    stations = to_weather_stations(
        WeatherStationsResponse.model_validate_json(gzip.decompress(await store.get(stas[-1])))
    )
    presets = [(p, c.id) for c in cameras for p in c.preset_ids]
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            UPSERT_STATIONS,
            [s.id for s in stations],
            [s.name for s in stations],
            [s.lon for s in stations],
            [s.lat for s in stations],
            [s.status for s in stations],
        )
        await conn.execute(
            UPSERT_CAMERAS,
            [c.id for c in cameras],
            [c.name for c in cameras],
            [c.lon for c in cameras],
            [c.lat for c in cameras],
            [c.status for c in cameras],
        )
        await conn.execute(
            UPSERT_PRESETS,
            [p for p, _ in presets],
            [c for _, c in presets],
            [True] * len(presets),
        )
        await conn.execute(RETIRE_PRESETS, [p for p, _ in presets])
        await conn.execute(NEAREST_STATION)
        await conn.execute(MARK_TRAINING, settings.training_radius_km * 1000)
    logger.info(
        "metadata_imported",
        extra={"fields": {"cameras": len(cameras), "stations": len(stations), "key": cams[-1]}},
    )
    return True


async def import_sensors(
    pool: Pool, store: ImageStore, settings: Settings, *, rescan: bool = False
) -> int:
    """Load every sensor snapshot not yet in ``import_log``; returns files imported.

    ``rescan`` re-reads every file, e.g. after adding a sensor to ``imported_sensors``;
    existing readings are kept (``ON CONFLICT DO NOTHING``).
    """
    wanted = frozenset(settings.imported_sensors)
    async with pool.acquire() as conn:
        done = {r["key"] for r in await conn.fetch("SELECT key FROM import_log")}
    todo = [k for k in await store.keys("sensors/") if rescan or k not in done]
    for key in todo:
        resp = WeatherStationDataResponse.model_validate_json(gzip.decompress(await store.get(key)))
        rows = [r for r in to_sensor_readings(resp, wanted) if is_plausible(r)]
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute(
                INSERT_READINGS,
                [r.station_id for r in rows],
                [r.sensor for r in rows],
                [r.value for r in rows],
                [r.measured_at for r in rows],
            )
            await conn.execute(
                "INSERT INTO import_log (key, rows) VALUES ($1, $2)"
                " ON CONFLICT (key) DO UPDATE SET rows = EXCLUDED.rows, imported_at = now()",
                key,
                len(rows),
            )
    if todo:
        logger.info("sensors_imported", extra={"fields": {"files": len(todo)}})
    return len(todo)


async def import_all(
    pool: Pool, store: ImageStore, settings: Settings, *, rescan: bool = False
) -> int:
    """Metadata first (readings reference stations), then sensors, then road info."""
    if not await import_metadata(pool, store, settings):
        logger.warning("no_metadata_yet")
        return 0
    files = await import_sensors(pool, store, settings, rescan=rescan)
    await import_road_info(pool, store)
    return files


async def _run(settings: Settings, *, watch: bool, rescan: bool) -> None:  # pragma: no cover
    pool = await create_pool(settings)
    store = LocalImageStore(settings.data_dir)
    try:
        while True:
            await import_all(pool, store, settings, rescan=rescan)
            rescan = False
            if not watch:
                return
            await asyncio.sleep(settings.cycle_s)
    finally:
        await pool.close()


def main(argv: list[str] | None = None) -> None:  # pragma: no cover - thin CLI wrapper
    """Entry point."""
    parser = argparse.ArgumentParser(prog="python -m keli.storage.importer")
    parser.add_argument("--watch", action="store_true", help="import new files every cycle")
    parser.add_argument(
        "--rescan", action="store_true", help="re-read all files once (after adding sensors)"
    )
    args = parser.parse_args(argv)
    configure_logging()
    asyncio.run(_run(Settings(), watch=args.watch, rescan=args.rescan))


if __name__ == "__main__":  # pragma: no cover
    main()
