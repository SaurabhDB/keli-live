"""Plausibility checks on sensor readings before they enter the database (LLD 5.3)."""

from keli.digitraffic.models import SensorReading

ROAD_TEMP_C = (-45.0, 60.0)
FRICTION = (0.0, 1.0)
PRECIP_MM_H = (0.0, 100.0)  # 204.7 mm/h was seen live: a faulty gauge


def is_plausible(reading: SensorReading) -> bool:
    """False for physically impossible values (broken sensor), which are dropped."""
    name, value = reading.sensor, reading.value
    if name.endswith("_DERIVAATTA"):
        return True  # a trend in °C/h, not a temperature
    if name.startswith("TIE_"):
        return ROAD_TEMP_C[0] <= value <= ROAD_TEMP_C[1]
    if name.startswith("KITKA"):
        return FRICTION[0] <= value <= FRICTION[1]
    if name == "SADE_INTENSITEETTI":
        return PRECIP_MM_H[0] <= value <= PRECIP_MM_H[1]
    return True
