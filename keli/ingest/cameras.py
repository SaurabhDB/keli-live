"""Camera presets: which to record, which are training presets, and fetching images."""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from keli.digitraffic.client import DigitrafficClient
from keli.digitraffic.models import Camera, WeatherStation
from keli.storage.objects import ImageStore, full_key, thumb_key

EARTH_RADIUS_KM = 6371.0


class Outcome(StrEnum):
    """Result of one image job."""

    SAVED = "saved"
    ALREADY_STORED = "already_stored"


@dataclass(frozen=True, slots=True)
class ImageJob:
    """One image to fetch: a preset, its size, and the capture time it should have."""

    preset_id: str
    thumbnail: bool
    captured_at: datetime

    @property
    def key(self) -> str:
        """Object key the image is stored under."""
        make_key = thumb_key if self.thumbnail else full_key
        return make_key(self.preset_id, self.captured_at)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def collecting_presets(cameras: Iterable[Camera]) -> list[str]:
    """Preset ids of all collecting cameras."""
    return [p for c in cameras if c.collecting for p in c.preset_ids]


def training_presets(
    cameras: Iterable[Camera], stations: Iterable[WeatherStation], radius_km: float
) -> frozenset[str]:
    """Presets of collecting cameras with a weather station within ``radius_km``.

    Distance is computed from coordinates rather than Digitraffic's paired station, because
    the labelling rule (CLAUDE.md) is about distance: any station that close can label.
    """
    station_list = list(stations)
    selected: set[str] = set()
    for cam in cameras:
        if not cam.collecting:
            continue
        if any(haversine_km(cam.lat, cam.lon, s.lat, s.lon) <= radius_km for s in station_list):
            selected.update(cam.preset_ids)
    return frozenset(selected)


async def record_image(client: DigitrafficClient, store: ImageStore, job: ImageJob) -> Outcome:
    """Fetch and store one image unless it is already stored (e.g. after a restart)."""
    if await store.exists(job.key):
        return Outcome.ALREADY_STORED
    data = await client.image(job.preset_id, thumbnail=job.thumbnail)
    await store.put(job.key, data)
    return Outcome.SAVED
