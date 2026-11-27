"""Station sensor readings: one bulk request per cycle, stored raw and gzipped."""

import gzip
from datetime import datetime

from keli.digitraffic.client import DigitrafficClient
from keli.storage.objects import ImageStore, sensors_key


async def record_sensors(client: DigitrafficClient, store: ImageStore, now: datetime) -> int:
    """Store the readings of all stations; returns the number of stations.

    The raw payload is kept so validation rules can change later without losing data.
    """
    fetched = await client.weather_station_data()
    await store.put(sensors_key(now), gzip.compress(fetched.raw))
    return fetched.value
