# Keli Live: Technical Documentation

| | |
|---|---|
| **Version** | 0.1 |
| **Date** | 23 Nov 2026 |
| **Related** | [HLD](HLD_Architecture.md) · [LLD](LLD_Architecture.md) · [Timeline](Project_Timeline.md) |

## 1. Overview

Keli Live ingests open Finnish road data, labels camera images automatically, trains a vision model on a laptop, and serves live road conditions through an API, a map and AI agents. This guide covers setup, data sources, the sensor reference, training, deployment and operations.

## 2. Prerequisites

| Item | Version / note |
|---|---|
| macOS (Apple Silicon) or Linux | Development on a MacBook M1, 16 GB |
| Python | 3.12 |
| PostgreSQL 18 + PostGIS 3.7 | `brew install postgresql@18 postgis` (Homebrew's PostGIS supports 18/19, not 16); Docker for the server |
| Node.js | 22+ for the web app (`frontend/`) |
| Git, GitHub account | |
| Ollama | Optional, for the local vision-language voter |
| Free disk | ~60 GB for a local training subset; use an external SSD for more |

## 3. Local setup

```bash
git clone https://github.com/SaurabhDB/keli-live.git && cd keli-live
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,ml]"
cp .env.example .env                     # set KELI_DATABASE_URL (secrets only)
brew services start postgresql@18        # see "Local database" below
python -m keli.storage.migrate           # applies keli/storage/migrations/*.sql
python scripts/check_digitraffic.py      # feasibility check
python -m keli.ingest --once             # one full cycle
python -m keli.storage.importer          # raw files -> database
(cd frontend && npm install && npm run build)
uvicorn keli.api.main:app                # web app + API on http://localhost:8000
```

Open **http://localhost:8000**: one process serves both the API (`/v1`, `/docs`) and the built web app. For frontend development with hot reload, also run `cd frontend && npm run dev` and open http://localhost:5173; Vite forwards `/v1` to port 8000. Settings live in `config/keli.json` (any of them can be overridden with `KELI_<NAME>` in `.env`); the web app's settings in `frontend/public/config.json`.

### 3.1 Local database

The Homebrew PostgreSQL 18 runs on **port 5433**, because another local PostgreSQL may already use 5432:

```bash
brew install postgresql@18 postgis
sed -i '' 's/^#\{0,1\}port = .*/port = 5433/' /opt/homebrew/var/postgresql@18/postgresql.conf
brew services start postgresql@18
psql -p 5433 -d postgres -c "CREATE ROLE keli LOGIN PASSWORD '<secret>'"
createdb -p 5433 -O keli keli && psql -p 5433 -d keli -c "CREATE EXTENSION postgis"
# .env: KELI_DATABASE_URL=postgresql://keli:<secret>@localhost:5433/keli
```

### 3.2 Running the recorder and importer

| Task | Command |
|---|---|
| Record continuously | `nohup caffeinate -is python -m keli.ingest >> recorder.log 2>&1 &` (keeps the Mac awake while plugged in; closing the lid still sleeps unless `sudo pmset -a disablesleep 1`) |
| Stop recording | `pkill -f "python -m keli.ingest"` |
| Load new files into the database | `python -m keli.storage.importer --watch` (every cycle) |
| After adding a sensor to `imported_sensors` | `python -m keli.storage.importer --rescan` |
| Data location | `data/` by default; set `KELI_DATA_DIR` to an external SSD (about 11 GB per day) |
| Health | `curl localhost:8000/v1/health`; each cycle logs one `cycle_done` JSON line in `recorder.log` |

## 4. Data sources

| Source | Endpoint | Update | Licence |
|---|---|---|---|
| Camera stations | `GET /api/weathercam/v1/stations` | Metadata | CC BY 4.0 |
| Camera detail | `GET /api/weathercam/v1/stations/{id}` | Metadata (`nearestWeatherStationId`, presets) | CC BY 4.0 |
| Camera image | `https://weathercam.digitraffic.fi/{presetId}.jpg` | ~10 min; kept 24 h | CC BY 4.0 |
| Camera history | `GET /api/weathercam/v1/stations/{id}/history` | Last 24 h | CC BY 4.0 |
| Weather stations | `GET /api/weather/v1/stations` | Metadata | CC BY 4.0 |
| Station data (all) | `GET /api/weather/v1/stations/data` | ~1 min | CC BY 4.0 |
| Sensor metadata | `GET /api/weather/v1/sensors` | Metadata | CC BY 4.0 |
| Traffic announcements | Traffic message API, type `TRAFFIC_ANNOUNCEMENT` | Event-driven; also MQTT | CC BY 4.0 |

Rules: send `Digitraffic-User`; use gzip for JSON; stay under 6,000 image requests per 5 minutes per IP (Keli Live uses at most 1,200). Attribution: **Source: Fintraffic / digitraffic.fi, license CC BY 4.0.**

### 4.1 Measured volumes (23 Nov 2026)

| Measure | Value |
|---|---|
| Camera stations / collecting | 810 / 809 |
| Presets on collecting cameras | 2,282 |
| Full image / thumbnail | ~250–275 KB / ~19 KB |
| Weather stations reporting | 533 |
| Sensor reading median age | 4 min |
| Cameras with station < 0.5 km (sample of 150) | 20% |
| Cameras with station ≥ 2 km or none | 57% |

## 5. Sensor reference

Meanings come from `/api/weather/v1/sensors` (Finnish descriptions) and the live cross-check on 23 Nov 2026.

| Sensor | Unit | Meaning | Coverage (stations) | Use |
|---|---|---|---|---|
| `TIE_1`…`TIE_4` | °C | Road surface temperature, road sensor 1–4 | 464 / 346 / 40 / 36 | Ice-risk override |
| `TIE_n_DERIVAATTA` | °C/h | Rate of change of road temperature | 423 / 314 / 40 / 35 | Early warning (cooling toward 0 °C) |
| `KELI_1`…`KELI_4` | code | Road condition inferred by the station | 481 / 397 / 50 / 49 | Main label |
| `VAROITUS_1`…`VAROITUS_4` | code | Warning level | 464 / 401 / 50 / 49 | Ice-risk override |
| `PINTASIGNAALI_n` | V | Raw surface signal | 460 / 399 / 49 / 48 | Not used |
| `OPTISEN_ANTURIN_KELI1/2` | code | Road condition from the optical DSC sensor | 251 / 141 | Second label |
| `OPTISEN_ANTURIN_VAROITUS1/2` | code | Warning from the optical sensor | 251 / 141 | Ice-risk override |
| `KITKA1/2`, `KITKA1/2_LUKU` | µ | Calculated friction from the DSC sensor (0–1) | 251 / 141 | Grip, plausibility |
| `KASTEPISTE_ERO_TIE_ENNUSTE` | °C | Forecast road-minus-dew-point difference | | Frost risk (later) |

**KELI codes:** 0 sensor fault · 1 dry · 2 moist · 3 wet · 4 wet and salty · 5 frost · 6 snow · 7 ice · 8 probably moist and salty · 9 slushy.

**Ice-risk temperature override:** only unsalted codes 2 and 3 become ice risk when `TIE_n` ≤ 0 °C. The salty codes 4 and 8 stay wet at any temperature, because salt lowers the freezing point; they become ice risk only through a `VAROITUS_n` alarm (2) or frost (3) warning. See LLD §2.2.

**VAROITUS codes:** 0 OK · 1 beware · 2 alarm · 3 frost · 4 rain.

**Optical KELI codes:** not documented in the metadata; the live cross-tab shows the same scale without the salt codes 4 and 8. Confirm on 20 images before relying on codes 2, 5 and 7.

**Consistency checks (run `scripts/inspect_sensors.py`):** freshness, coverage, in-road vs optical agreement (about 85% at the coarse level on 23 Nov), friction vs temperature plausibility, camera-to-station distance.

## 6. Labelling

1. `python -m keli.labels.run --since 2026-12-01` runs the four voters and the aggregator.
2. Disagreements are exported to Label Studio: `python -m keli.labels.review export`.
3. Label in Label Studio (`docker compose up -d labelstudio`, http://localhost:8080). Aim for 200–300 disputed images per week.
4. Import: `python -m keli.labels.review import <export.json>`.
5. Freeze a snapshot: `python -m keli.labels.snapshot --name 2026-12-20`.

## 7. Training on a Mac M1

```bash
python -m keli.models.train --snapshot 2026-12-20 --model dinov2_small_probe
python -m keli.models.train --snapshot 2026-12-20 --model convnext_tiny --epochs 15 --batch 32 --device mps
python -m keli.models.evaluate --run runs/convnext_tiny/latest --split test
python -m keli.models.export_onnx --run runs/convnext_tiny/latest
```

| Tip | Why |
|---|---|
| Train on 224 px lane crops | Fits 16 GB; crops carry the signal |
| `PYTORCH_ENABLE_MPS_FALLBACK=1` | Some ops are not on MPS yet |
| Keep the dataset on an external SSD | 256 GB internal disk fills fast |
| Close other apps; batch 32 | Memory headroom |
| Cache DINOv2 features once | Linear probes then train in seconds |

Expected time: DINOv2 probe minutes; ConvNeXt-Tiny on ~20,000 crops about 1–3 hours. Optional: a cloud GPU for a few euros if you need larger runs.

## 8. Evaluation rules

- Split by **camera**, never by image.
- Report macro-F1, per-class recall, ice-risk recall, confusion matrix, calibration.
- Report night and day separately.
- Publish only measured numbers in the README; include the date and the snapshot name.

## 9. Deployment

| Step | Command / note |
|---|---|
| Server | Hetzner Cloud, 4 vCPU / 8 GB, Ubuntu 24.04, EU region |
| Install | Docker + Compose; clone repo; copy `.env` |
| Start | `docker compose -f docker-compose.prod.yml up -d` |
| Web app | Built into `frontend/dist` and served by the API process (no separate web server) |
| HTTPS | Caddy reverse proxy with automatic certificates |
| Model | Upload ONNX to object storage; set `MODEL_ID`; restart `inference` |
| Deploy | GitHub Actions builds images and deploys over SSH on tag `v*` |

Services: `db`, `ingest` (recorder + importer), `api` (also serves the web app), later `inference`, `agents`, `mcp`. A free-tier option (Render for the API in live-fallback mode) is being evaluated.

## 10. Operations

### 10.1 Daily

- Check `/v1/health`: last cycle < 15 min ago, failures < 10%.
- Review pending alerts.
- Glance at the ops agent's summary.

### 10.2 Runbook

| Symptom | Likely cause | Action |
|---|---|---|
| Data age > 30 min | Ingest stopped, Mac asleep or Digitraffic down | `tail recorder.log`; check status.digitraffic.fi; restart the recorder and importer |
| `/v1/health` says `degraded` | PostgreSQL unreachable; API serves Digitraffic live data | `brew services restart postgresql@18`; the API reconnects within `db_retry_s` |
| Many 429 responses | Rate limit | Lower `KELI_RATE_LIMIT_REQUESTS`; check requests are spread over the cycle |
| Maintenance fetch HTTP 400 | Window ≥ 24 h | Keep `maintenance_initial_lookback_s` ≤ 82800 |
| Many identical images from one camera | Camera frozen | Automatic flag; excluded from the map until it changes |
| Contract test failed | API field changed | Update `keli/digitraffic/models.py`; release a fix |
| All predictions "unusable" at night | Expected | Map relies on sensors at night |
| Disk or storage near limit | Full images accumulating | Run retention job; check `is_training` flags |

### 10.3 Demo modes

| Mode | When | How |
|---|---|---|
| Live | Normal | Default |
| Replay | Interesting day already recorded | `?replay=2026-12-15` |
| Offline sample | No internet, or a mild day during an interview | `?sample=1` loads a bundled day |

## 11. Privacy

- Never run plate recognition or vehicle tracking.
- Store thumbnails and lane crops; full images only for training presets, private, deleted after the season.
- Any published dataset contains lane crops only, with CC BY 4.0 attribution.

## 12. Contributing

- Branch from `main`, open a pull request, keep changes small.
- `ruff check . && pytest` before pushing.
- Commit messages: imperative, short (`Add optical KELI mapping`).

## 13. Glossary

| Term | Meaning |
|---|---|
| Keli | Finnish for road and driving conditions |
| Preset | One camera angle; a camera has 1–4 |
| DSC | Vaisala's optical road-state sensor |
| KELI / VAROITUS / TIE / KITKA | Road condition / warning / road temperature / friction |
| Weak supervision | Training labels produced automatically, not by hand |
| MCP | Model Context Protocol, a standard way for AI assistants to call tools |
