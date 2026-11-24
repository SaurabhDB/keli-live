"""Inspect Digitraffic road-surface sensors and camera-station pairing for Keli Live.

Answers: what each sensor means (official metadata), what values it reports right now,
how fresh and widespread the data is, whether embedded and optical sensors agree,
and how far each camera is from its paired weather station.

Usage: python inspect_sensors.py > sensor_report.txt
Data: Fintraffic / digitraffic.fi, license CC 4.0 BY
"""
import collections
import json
import math
from datetime import datetime, timezone

import requests

BASE = "https://tie.digitraffic.fi"
H = {"Digitraffic-User": "KeliLive/sensor-inspection", "Accept-Encoding": "gzip"}
SURFACE = ("TIE_", "KELI", "VAROITUS", "PINTASIGNAALI", "OPTISEN_ANTURIN", "KITKA")


def get(path):
    r = requests.get(BASE + path, headers=H, timeout=60)
    r.raise_for_status()
    return r.json()


def is_surface(name):
    return any(name.upper().startswith(p) or p in name.upper() for p in SURFACE)


def km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def listify(payload, *keys):
    """Return the list inside a payload, whatever the wrapper key is."""
    if isinstance(payload, list):
        return payload
    for k in keys:
        if isinstance(payload.get(k), list):
            return payload[k]
    return []


print("=" * 70, "\n1. OFFICIAL SENSOR METADATA (what each sensor means)\n" + "=" * 70)
meta = listify(get("/api/weather/v1/sensors"), "sensors", "features")
for s in meta:
    props = s.get("properties", s)
    if is_surface(str(props.get("name", ""))):
        print(json.dumps(props, ensure_ascii=False))

print("\n" + "=" * 70, "\n2. CURRENT VALUES ACROSS ALL STATIONS\n" + "=" * 70)
data = get("/api/weather/v1/stations/data")
stations = listify(data, "stations")
now = datetime.now(timezone.utc)
coverage = collections.Counter()
values = collections.defaultdict(collections.Counter)
ages = collections.defaultdict(list)
per_station = {}
example_printed = False
for st in stations:
    sv = {}
    for v in st.get("sensorValues", []):
        name = v.get("name", "")
        if not is_surface(name):
            continue
        if not example_printed:
            print("Example sensor value record:", json.dumps(v, ensure_ascii=False))
            example_printed = True
        coverage[name] += 1
        desc = v.get("sensorValueDescriptionEn") or v.get("sensorValueDescriptionFi") or ""
        val = v.get("value")
        key = f"{val} {v.get('unit', '')} {desc}".strip()
        if not name.startswith(("TIE_", "KITKA")) or "LUKU" not in name:
            values[name][key] += 1
        t = v.get("measuredTime") or v.get("timeWindowEnd")
        if t:
            age = (now - datetime.fromisoformat(t.replace("Z", "+00:00"))).total_seconds() / 60
            ages[name].append(age)
        sv[name] = (val, desc)
    per_station[st.get("id")] = sv

print(f"\nStations reporting: {len(stations)}")
for name in sorted(coverage):
    a = sorted(ages[name])
    med = a[len(a) // 2] if a else float("nan")
    stale = sum(1 for x in a if x > 60)
    print(f"\n{name}: on {coverage[name]} stations | median age {med:.0f} min | older than 60 min: {stale}")
    if name in values:
        for k, n in values[name].most_common(8):
            print(f"    {n:4d} x {k}")

print("\n" + "=" * 70, "\n3. CONSISTENCY: embedded KELI_1 vs optical OPTISEN_ANTURIN_KELI1\n" + "=" * 70)
pairs = collections.Counter()
for sid, sv in per_station.items():
    if "KELI_1" in sv and "OPTISEN_ANTURIN_KELI1" in sv:
        pairs[(sv["KELI_1"][1] or sv["KELI_1"][0], sv["OPTISEN_ANTURIN_KELI1"][1] or sv["OPTISEN_ANTURIN_KELI1"][0])] += 1
print(f"Stations with both sensors: {sum(pairs.values())}")
for (emb, opt), n in pairs.most_common(15):
    print(f"    {n:4d} x embedded={emb!r:30} optical={opt!r}")

print("\n" + "=" * 70, "\n4. CAMERA TO WEATHER-STATION PAIRING\n" + "=" * 70)
ws = {f["id"]: tuple(reversed(f["geometry"]["coordinates"][:2])) for f in get("/api/weather/v1/stations")["features"]}
cams = get("/api/weathercam/v1/stations")["features"]
active = [c for c in cams if c["properties"].get("collectionStatus") in (None, "GATHERING")]
presets = sum(len(c["properties"].get("presets", [])) for c in active)
print(f"Camera stations: {len(cams)} | collecting: {len(active)} | presets on collecting cameras: {presets}")

buckets = collections.Counter()
with_surface = 0
sample = 0
for c in active:
    if sample >= 150:  # detail calls are rate-friendly; 150 gives a solid estimate
        break
    detail = get(f"/api/weathercam/v1/stations/{c['properties']['id']}")["properties"]
    sample += 1
    wid = detail.get("nearestWeatherStationId")
    if wid is None or wid not in ws:
        buckets["no paired station"] += 1
        continue
    lon, lat = c["geometry"]["coordinates"][:2]
    d = km((lat, lon), ws[wid])
    b = "< 0.1 km" if d < 0.1 else "< 0.5 km" if d < 0.5 else "< 2 km" if d < 2 else ">= 2 km"
    buckets[b] += 1
    if any(k.startswith(("KELI", "OPTISEN_ANTURIN_KELI")) for k in per_station.get(wid, {})):
        with_surface += 1
print(f"Sampled {sample} collecting cameras:")
for b in ("< 0.1 km", "< 0.5 km", "< 2 km", ">= 2 km", "no paired station"):
    print(f"    {b:18} {buckets[b]}")
print(f"    paired station reports a road-condition sensor: {with_surface}")
print("\nSource: Fintraffic / digitraffic.fi, license CC 4.0 BY")