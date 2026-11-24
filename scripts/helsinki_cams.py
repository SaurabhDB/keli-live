"""Download the latest images from the 5 road weather cameras nearest central Helsinki.

Data: Fintraffic / digitraffic.fi, license CC 4.0 BY
Usage:
    pip install requests
    python helsinki_cams.py              # 5 nearest cameras, saved to ./helsinki_cams/
    python helsinki_cams.py --count 10 --thumbnail
"""

import argparse
import math
from datetime import UTC, datetime
from pathlib import Path

import requests

API = "https://tie.digitraffic.fi/api/weathercam/v1"
IMG = "https://weathercam.digitraffic.fi"
HEADERS = {"Digitraffic-User": "KeliLive/helsinki-demo", "Accept-Encoding": "gzip"}
HELSINKI = (60.1699, 24.9384)  # lat, lon (Senate Square area)


def km(a, b):
    """Great-circle distance in km between two (lat, lon) points."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371 * 2 * math.asin(math.sqrt(h))


def get_json(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def nearest_active_cameras(count):
    stations = get_json(f"{API}/stations")["features"]
    active = []
    for f in stations:
        p = f["properties"]
        if p.get("collectionStatus") not in (None, "GATHERING"):
            continue  # skip cameras that are removed or not collecting
        lon, lat = f["geometry"]["coordinates"][:2]
        active.append((km(HELSINKI, (lat, lon)), p["id"], p.get("name", p["id"]), lat, lon))
    active.sort()
    return active[:count]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=5)
    ap.add_argument(
        "--thumbnail", action="store_true", help="download small thumbnails instead of full images"
    )
    ap.add_argument("--out", default="helsinki_cams")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")

    for dist, cam_id, name, lat, lon in nearest_active_cameras(args.count):
        detail = get_json(f"{API}/stations/{cam_id}")["properties"]
        presets = [p for p in detail.get("presets", []) if p.get("inCollection", True)]
        if not presets:
            print(f"- {cam_id} {name}: no active presets, skipped")
            continue

        preset = presets[0]  # first camera angle; loop over all presets if you want every view
        url = f"{IMG}/{preset['id']}.jpg" + ("?thumbnail=true" if args.thumbnail else "")
        img = requests.get(
            url, headers={"Digitraffic-User": HEADERS["Digitraffic-User"]}, timeout=30
        )
        img.raise_for_status()

        path = out / f"{stamp}_{preset['id']}.jpg"
        path.write_bytes(img.content)
        taken = img.headers.get("Last-Modified", "unknown time")
        size_kb = len(img.content) // 1024
        print(
            f"- {name} ({cam_id}), {dist:.1f} km away, {lat:.4f},{lon:.4f}\n"
            f"  preset {preset['id']} | image time: {taken} | {size_kb} KB -> {path}"
        )

    print("\nSource: Fintraffic / digitraffic.fi, license CC 4.0 BY")


if __name__ == "__main__":
    main()
