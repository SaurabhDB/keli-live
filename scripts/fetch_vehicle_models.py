"""Download the 3D vehicle models used by the Drive game (Kenney Car Kit, CC0).

The models are not committed (they include a texture image); run this once after cloning:

    python scripts/fetch_vehicle_models.py

Source and licence: https://kenney.nl/assets/car-kit (Creative Commons Zero).
"""

import io
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

PAGE = "https://kenney.nl/assets/car-kit"
LINK = "https://kenney.nl/download-link/6173736574732f6361722d6b6974"  # id = hex("assets/car-kit")
MODELS = [
    "sedan",
    "sedan-sports",
    "hatchback-sports",
    "suv",
    "suv-luxury",
    "van",
    "taxi",
    "race",
    "race-future",
]
DEST = Path(__file__).resolve().parent.parent / "frontend" / "public" / "models" / "kenney"
HEADERS = {"User-Agent": "KeliLive model fetch", "Referer": PAGE}


def get(url: str) -> bytes:
    """GET ``url`` with the headers Kenney's download page uses."""
    req = urllib.request.Request(url, headers=HEADERS)  # noqa: S310 - fixed https URLs
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        data: bytes = resp.read()
        return data


def main() -> None:
    """Fetch the kit, copy the needed GLB files, the shared texture and the licence."""
    url = json.loads(get(LINK))["url"]
    kit = zipfile.ZipFile(io.BytesIO(get(url)))
    (DEST / "Textures").mkdir(parents=True, exist_ok=True)
    wanted = {f"Models/GLB format/{m}.glb": DEST / f"{m}.glb" for m in MODELS}
    wanted["Models/GLB format/Textures/colormap.png"] = DEST / "Textures" / "colormap.png"
    wanted["License.txt"] = DEST / "LICENSE.txt"
    for name, target in wanted.items():
        with kit.open(name) as src, target.open("wb") as out:
            shutil.copyfileobj(src, out)
    print(f"Saved {len(wanted)} files to {DEST}")


if __name__ == "__main__":
    main()
