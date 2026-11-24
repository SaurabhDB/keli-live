"""Day-1 feasibility check for Keli Live: run on your own machine.
Checks camera/preset counts, camera-to-weather-station pairing, image size,
and which road-surface sensors the weather stations expose.
Usage: pip install requests && python check_digitraffic.py
"""
import collections
import requests

BASE = "https://tie.digitraffic.fi"
H = {"Digitraffic-User": "KeliLive/feasibility-check", "Accept-Encoding": "gzip"}


def get(path):
    r = requests.get(BASE + path, headers=H, timeout=30)
    r.raise_for_status()
    return r.json()


# 1. Cameras and presets
cams = get("/api/weathercam/v1/stations")["features"]
print(f"Camera stations: {len(cams)}")
print("Fields on a camera station:", sorted(cams[0]["properties"].keys()))

detail = get(f"/api/weathercam/v1/stations/{cams[0]['properties']['id']}")
props = detail["properties"]
print("Fields on camera detail:", sorted(props.keys()))
pairing_keys = [k for k in props if "weather" in k.lower() or "nearest" in k.lower()]
print("Possible weather-station link fields:", pairing_keys or "none found")

presets = sum(len(get(f"/api/weathercam/v1/stations/{c['properties']['id']}")["properties"].get("presets", []))
              for c in cams[:20])
print(f"Presets on first 20 cameras: {presets} (scale up for a total estimate)")

# 2. One image: size of full and thumbnail
preset_id = props["presets"][0]["id"]
for suffix in ("", "?thumbnail=true"):
    img = requests.get(f"https://weathercam.digitraffic.fi/{preset_id}.jpg{suffix}", headers=H, timeout=30)
    print(f"Image {preset_id}{suffix or ' (full)'}: {len(img.content) / 1024:.0f} KB")

# 3. Weather stations and road-surface sensors
ws = get("/api/weather/v1/stations")["features"]
print(f"Weather stations: {len(ws)}")
data = get(f"/api/weather/v1/stations/{ws[0]['id']}/data")
names = collections.Counter(s["name"] for s in data.get("sensorValues", []))
surface = [n for n in names if any(t in n.upper() for t in ("KELI", "VAROITUS", "TIE_", "PINTA", "KITKA"))]
print("Sensors on first station:", len(names))
print("Road-surface related sensors:", surface or "none on this station; try others")