# Keli Live: Low-Level Design (LLD)

| | |
|---|---|
| **Version** | 0.1 (draft) |
| **Date** | 23 Nov 2026 |
| **Related** | [HLD](HLD_Architecture.md) · [Technical documentation](Technical_Documentation.md) |

## 1. Repository layout

```
keli-live/
├── README.md, SKILLS.md, LICENSE, pyproject.toml, .env.example, docker-compose.yml
├── docs/                      # HLD, LLD, technical docs, timeline, images
├── keli/
│   ├── config.py              # settings from environment (pydantic-settings)
│   ├── digitraffic/           # API client, typed responses, rate limiter
│   │   ├── client.py
│   │   └── models.py
│   ├── ingest/
│   │   ├── scheduler.py       # 10-minute cycle, spreads requests evenly
│   │   ├── cameras.py         # camera + preset sync, image fetch
│   │   ├── sensors.py         # station data fetch
│   │   ├── announcements.py   # traffic announcements
│   │   └── validate.py        # faults, staleness, plausibility
│   ├── storage/
│   │   ├── schema.sql
│   │   ├── db.py              # SQLAlchemy / asyncpg
│   │   └── objects.py         # S3 client, key layout
│   ├── vision/
│   │   ├── lanes.py           # per-preset lane polygon, crop
│   │   └── quality.py         # night, blur, blocked-lens checks
│   ├── labels/
│   │   ├── voters/{sensor,zeroshot,rules,vlm}.py
│   │   ├── aggregate.py       # agreement rules, temporal smoothing
│   │   └── review.py          # Label Studio export/import
│   ├── models/
│   │   ├── dataset.py, train.py, evaluate.py, fusion.py
│   │   ├── export_onnx.py, registry.py
│   │   └── infer.py           # inference worker
│   ├── alerts/mismatch.py     # deterministic mismatch rules
│   ├── agents/                # LangGraph graphs
│   │   ├── route_brief.py, mismatch.py, labelling.py, ops.py
│   │   └── tools.py           # tools shared with the MCP server
│   ├── api/
│   │   ├── main.py
│   │   └── routes/{cameras,conditions,alerts,routes,health}.py
│   └── mcp_server/server.py
├── web/                       # index.html, app.js, live.js, style.css
├── scripts/                   # check_digitraffic.py, inspect_sensors.py, helsinki_cams.py
└── tests/                     # unit, contract, end-to-end
```

## 2. Domain model

### 2.1 Classes

| Class | Code | Meaning |
|---|---|---|
| `dry` | 1 | Dry surface |
| `wet` | 2 | Wet or moist, above freezing |
| `slush` | 3 | Slush |
| `snow` | 4 | Snow-covered lane |
| `ice_risk` | 5 | Ice, frost, or unsalted wet/moist at or below 0 °C |
| `unusable` | 0 | Night, fog, blocked lens, camera turned away |

### 2.2 Sensor-to-class mapping (confirmed 23 Nov 2026)

| Class | In-road `KELI_n` | Optical `OPTISEN_ANTURIN_KELIn` | Overrides |
|---|---|---|---|
| dry | 1 | 1 | |
| wet | 2, 3, 4, 8 | 2, 3 | codes 2, 3 → ice_risk if `TIE_n` ≤ 0 °C; salty codes 4, 8 stay wet |
| slush | 9 | 9 | |
| snow | 6 | 6 | |
| ice_risk | 5, 7 | 5, 7 | also if `VAROITUS_n` ∈ {2 alarm, 3 frost} |
| (no label) | 0 fault | 0 | reading older than 60 min |

**Salt exception.** The temperature override does not apply to the salty codes 4 (wet and salty) and 8 (probably moist and salty): salt lowers the freezing point, so a salted road at −3 °C is wet, not icy. Without this exception every salted main road would show false ice risk all winter. A salty reading becomes `ice_risk` only through `VAROITUS_n` ∈ {2, 3}, or through codes 5/7 themselves.

Use lanes 1 and 2 only. Ignore `PINTASIGNAALI_n`. Optical codes are inferred from the cross-tab and must be confirmed on 20 images.

## 3. Database schema

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE camera (
  id              text PRIMARY KEY,            -- e.g. C0167400
  name            text NOT NULL,
  geom            geography(Point, 4326) NOT NULL,
  collection      text,                        -- GATHERING, REMOVED_TEMPORARILY...
  weather_station int,                         -- nearestWeatherStationId
  station_dist_m  int,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preset (
  id              text PRIMARY KEY,            -- e.g. C0167401
  camera_id       text NOT NULL REFERENCES camera(id),
  direction       text,
  in_collection   boolean NOT NULL,
  lane_polygon    jsonb,                       -- normalised [x,y] points for the crop
  is_training     boolean NOT NULL DEFAULT false  -- station within 0.5 km
);

CREATE TABLE weather_station (
  id              int PRIMARY KEY,
  name            text NOT NULL,
  geom            geography(Point, 4326) NOT NULL
);

CREATE TABLE sensor_reading (
  station_id      int NOT NULL REFERENCES weather_station(id),
  sensor          text NOT NULL,               -- KELI_1, TIE_1, KITKA1_LUKU...
  value           real NOT NULL,
  measured_at     timestamptz NOT NULL,
  PRIMARY KEY (station_id, sensor, measured_at)
);

CREATE TABLE image (
  id              bigserial PRIMARY KEY,
  preset_id       text NOT NULL REFERENCES preset(id),
  captured_at     timestamptz NOT NULL,        -- Last-Modified header
  thumb_key       text NOT NULL,
  full_key        text,                        -- only for training presets
  quality         jsonb,                       -- brightness, blur, night flag
  UNIQUE (preset_id, captured_at)
);

CREATE TABLE label (
  image_id        bigint NOT NULL REFERENCES image(id),
  source          text NOT NULL,               -- sensor, zeroshot, rules, vlm, human, aggregate
  class           smallint NOT NULL,
  confidence      real,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (image_id, source)
);

CREATE TABLE model_version (
  id              text PRIMARY KEY,            -- e.g. convnext-t-2026-12-20
  metrics         jsonb NOT NULL,
  artifact_key    text NOT NULL,
  promoted_at     timestamptz
);

CREATE TABLE prediction (
  image_id        bigint NOT NULL REFERENCES image(id),
  model_id        text NOT NULL REFERENCES model_version(id),
  class           smallint NOT NULL,
  probs           real[] NOT NULL,
  confidence      real NOT NULL,
  PRIMARY KEY (image_id, model_id)
);

CREATE TABLE announcement (
  id              text PRIMARY KEY,
  kind            text NOT NULL,               -- TRAFFIC_ANNOUNCEMENT...
  geom            geography(Geometry, 4326),
  title           text,
  valid_from      timestamptz,
  valid_to        timestamptz,
  raw             jsonb NOT NULL
);

CREATE TABLE alert (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL,               -- forecast_mismatch, sensor_camera_conflict
  preset_id       text REFERENCES preset(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending', -- pending, approved, rejected, expired
  evidence        jsonb NOT NULL,
  draft_text      text,
  reviewed_by     text
);

CREATE INDEX ON sensor_reading (measured_at);
CREATE INDEX ON image (captured_at);
CREATE INDEX ON camera USING gist (geom);
```

Retention: `sensor_reading` and `prediction` are kept; `image` rows and thumbnails for one season; `full_key` objects deleted after the training snapshot is frozen.

## 4. Object storage layout

```
thumbs/{yyyy}/{mm}/{dd}/{preset_id}/{HHMM}.jpg
full/{yyyy}/{mm}/{dd}/{preset_id}/{HHMM}.jpg        # training presets, hourly
sensors/{yyyy}/{mm}/{dd}/{HHMM}.json.gz             # raw station data, every cycle
meta/{yyyy}/{mm}/{dd}/{cameras,weather_stations}.json.gz  # daily raw snapshots
crops/{model_input_size}/{image_id}.jpg             # 384 px lane crops
models/{model_id}/model.onnx, card.md, metrics.json
snapshots/{snapshot_id}/manifest.parquet
```

## 5. Ingestion

### 5.1 Digitraffic client

- Base URL `https://tie.digitraffic.fi`, images from `https://weathercam.digitraffic.fi/{presetId}.jpg` (`?thumbnail=true` for 19 KB thumbnails).
- Headers: `Digitraffic-User: KeliLive/<version>`, `Accept-Encoding: gzip` (not needed for images).
- Even-spacing limiter: 1,200 requests per 5 min (20% of the 6,000 limit), one slot every 0.25 s shared by all requests (JSON and images). Unlike a token bucket it never bursts after idle time.
- Retries: 3 with exponential backoff (1, 4, 16 s) on 5xx, 429, timeouts and connection errors; no retry on other 4xx. Each attempt takes a limiter slot.
- Timeout: 10 s per image, 60 s per JSON call.

### 5.2 Cycle

```python
async def run_cycle(now):
    presets = await db.active_presets()                    # ~2,282
    slots = spread_evenly(presets, window=timedelta(minutes=10))
    async for preset, at in slots:
        await sleep_until(at)
        img = await client.image(preset.id, thumbnail=not preset.is_training)
        if img.last_modified <= await db.last_capture(preset.id):
            continue                                       # unchanged since last cycle
        q = quality.check(img)                             # night, blur, blocked
        key = await objects.put_thumb(preset.id, img)
        image_id = await db.insert_image(preset.id, img.last_modified, key, q)
        await queue.push("infer", image_id)
```

- Camera and preset metadata synced once a day.
- **Skipping unchanged images.** Thumbnails carry no `Last-Modified` header (only an `ETag`; checked 24 Nov 2026), so one request to `/api/weathercam/v1/stations/data` per cycle gives every preset's `measuredTime`, which equals the full image's `Last-Modified`. A preset is fetched only when its capture time moved; the key is derived from that time, and an existing key is never downloaded again (restart-safe).
- **Frozen cameras:** a preset whose latest image is older than 60 min (`KELI_MAX_IMAGE_AGE_S`) is skipped and counted as `frozen` in the cycle log. Seen on 24 Nov 2026: C1457409 still served a 9.9 KB placeholder from 20 Nov.
- **Training presets** are presets of collecting cameras with any weather station within 0.5 km, computed from coordinates. Their full images are fetched hourly, spread over the six cycles of the hour (at most ⌈n / 6⌉ per cycle) instead of one burst at the top of the hour.
- **Budget:** ~2,282 thumbnails + ~1/6 of training full images + 2 JSON calls per cycle, within the 2,400 slots of 10 minutes. A cycle that overruns starts the next one immediately.
- **Failure handling:** a failed image or sensor call is logged and counted; the cycle continues. Current implementation (`keli/ingest/`) writes to local disk through the `ImageStore` interface (`keli/storage/objects.py`); S3 replaces it on the server.

### 5.3 Validation rules

| Rule | Action |
|---|---|
| `KELI_n == 0` | Drop as label, mark station sensor faulty |
| Reading older than 60 min | Drop as label |
| `TIE_n` outside −45…+60 °C | Drop reading |
| Friction outside 0…1 | Drop reading |
| Image identical to the previous one (hash) | Skip; flag camera if 6 cycles in a row |
| Mean brightness < threshold and sun below horizon | `unusable: night` |
| Laplacian variance < threshold | `unusable: blur or fog` |

## 6. Vision preprocessing

- **Lane polygon per preset:** drawn once in a small annotation tool for training presets; for others, a default bottom-centre trapezoid refined by the labelling agent.
- **Crop:** polygon bounding box → mask outside the polygon → resize to 384 px (training) or 224 px (inference).
- **Why lane crops:** snow on the verge is visible even when the lane is clear; whole-image models learn the verge.

## 7. Auto-labelling

### 7.1 Voters

| Voter | Input | Output |
|---|---|---|
| `sensor` | Station readings within ±10 min, station within 0.5 km | Class via mapping table, confidence 0.9 |
| `zeroshot` | Lane crop; OpenCLIP or SigLIP with class prompts | Softmax over 5 classes |
| `rules` | White-pixel share, brightness, detail | `snow`, `unusable` or abstain |
| `vlm` | Lane crop; Gemma 3 4B via Ollama | Class from a constrained prompt; only for disputed images |

### 7.2 Aggregation

```python
def aggregate(votes):
    usable = [v for v in votes if v.class_ is not None and v.conf >= MIN_CONF[v.source]]
    if any(v.class_ == UNUSABLE for v in usable if v.source == "rules"):
        return Label(UNUSABLE, source="aggregate")
    counts = Counter(v.class_ for v in usable)
    top, n = counts.most_common(1)[0] if counts else (None, 0)
    if n >= 2 and (sensor_agrees(top, votes) or no_sensor(votes)):
        return Label(top, source="aggregate", conf=mean_conf(usable, top))
    return Review(votes)   # to Label Studio
```

Then: temporal smoothing (a class flip lasting one frame among five is dropped) and cleanlab on out-of-fold predictions to flag likely label errors.

## 8. Models

| Stage | Model | Input | Notes |
|---|---|---|---|
| Baseline | OpenCLIP ViT-B/32 zero-shot | Lane crop 224 | No training |
| Probe | DINOv2-small frozen + logistic regression | Lane crop 224 | Fast on M1 |
| Main | ConvNeXt-Tiny (timm), fine-tuned | Lane crop 224 | MPS, mixed precision off |
| Fusion | Main image embedding + [road temp, air temp, hour, month] → MLP | | Temperature from nearest station; missing → learned default |

- **Split:** by camera (70/15/15), stratified by region; no camera in more than one split.
- **Loss:** cross-entropy with class weights; ice-risk weight × 2.
- **Augmentation:** colour jitter, small rotation, random erasing; no horizontal flip of text overlays.
- **Metrics:** macro-F1, per-class recall, ice-risk recall, confusion matrix, calibration (ECE).
- **Promotion rule:** macro-F1 on the test cameras ≥ current + 0.01 and ice-risk recall not lower.
- **Export:** ONNX opset 17; dynamic batch; INT8 quantisation tested against FP32 (keep if macro-F1 drops < 0.01).

## 9. Inference worker

- Consumes `infer` queue (PostgreSQL `LISTEN/NOTIFY` or a simple table queue).
- Batch of 32 crops, ONNX Runtime CPU, 4 threads.
- Writes `prediction`; final displayed class = sensor class when the station is within 0.5 km and fresh, otherwise model class; both stored.
- Confidence below 0.5 → displayed as "uncertain" with the top two classes.

## 10. Alerts

### 10.1 Deterministic mismatch rule

```
For each preset with a prediction in the last 20 min:
  observed = displayed class
  forecast = road-weather forecast for the nearest forecast section
  if observed in {ice_risk, snow, slush} and forecast in {dry, wet}
     and confidence >= 0.7 and the same holds for 2 consecutive cycles:
       create alert(kind="forecast_mismatch", status="pending", evidence={...})
```

Forecast source: Digitraffic road-weather forecasts (endpoint to confirm in week 1). Fallback: sensor-vs-camera conflict alerts.

### 10.2 Mismatch agent

LangGraph graph: `collect_evidence → draft_text → validate → await_approval → publish`. `validate` checks that every place and class in the text exists in the evidence. Approval through `POST /v1/alerts/{id}/approve`.

## 11. API (FastAPI)

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/health` | Status, last cycle time, data age |
| GET | `/v1/cameras?bbox=` | Cameras with presets and station distance |
| GET | `/v1/conditions?bbox=&at=` | Latest (or at a time) class, source, confidence per preset |
| GET | `/v1/presets/{id}/history?hours=24` | Time series of class and sensor values |
| GET | `/v1/alerts?status=approved` | Alerts |
| POST | `/v1/alerts/{id}/approve` | Approve (auth required) |
| POST | `/v1/route-brief` | `{from, to}` or polyline → brief text + evidence |
| GET | `/v1/stats` | Coverage, counts per class |

Every response includes `"attribution": "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY"`.

Example:

```json
GET /v1/conditions?bbox=24.7,60.1,25.2,60.3
{
  "generated_at": "2026-12-15T07:40:00Z",
  "items": [
    {"preset_id": "C0167401", "camera": "Helsinki, Ruoholahti", "lat": 60.163, "lon": 24.913,
     "class": "ice_risk", "source": "sensor", "confidence": 0.95,
     "model_class": "wet", "road_temp_c": -0.6, "image_at": "2026-12-15T07:34:12Z",
     "thumb_url": "https://weathercam.digitraffic.fi/C0167401.jpg?thumbnail=true"}
  ],
  "attribution": "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY"
}
```

## 12. Route brief

1. Resolve route: preset list along a predefined route, or presets within 1 km of a polyline (PostGIS `ST_DWithin`).
2. Build structured evidence: per checkpoint class, confidence, road temperature, alerts, announcements.
3. LLM prompt with evidence only; output limited to 80 words; must name the worst checkpoint.
4. Validate (places and classes exist in evidence); on failure fall back to a template.
5. Cache by route for 10 minutes.

## 13. MCP server

| Tool | Description |
|---|---|
| `get_conditions(bbox)` | Current conditions in an area |
| `get_camera(preset_id)` | Detail, history, thumbnail URL |
| `route_brief(from, to)` | Plain-language brief |
| `list_alerts(status)` | Approved alerts |

Read-only; rate limited; same attribution as the API.

## 14. Configuration

| Variable | Example | Purpose |
|---|---|---|
| `KELI_DATA_DIR` | `data` | Root of the local `ImageStore` |
| `KELI_RATE_LIMIT_REQUESTS`, `KELI_RATE_LIMIT_WINDOW_S` | `1200`, `300` | Request budget |
| `KELI_CYCLE_S`, `KELI_FULL_IMAGE_INTERVAL_S` | `600`, `3600` | Cycle and full-image cadence |
| `KELI_TRAINING_RADIUS_KM` | `0.5` | Station distance for training presets |
| `KELI_MAX_IMAGE_AGE_S` | `3600` | Older latest image → camera treated as frozen |
| `KELI_WORKERS` | `8` | Concurrent image downloads (pacing is set by the limiter) |
| `DATABASE_URL` | `postgresql://keli:...@db/keli` | PostgreSQL |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET` | | Object storage |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | | Route brief and alert drafts |
| `OLLAMA_URL` | `http://localhost:11434` | Local VLM for labelling |
| `MODEL_ID` | `convnext-t-2026-12-20` | Model served |
| `ADMIN_TOKEN` | | Alert approval |

## 15. Testing

| Level | What |
|---|---|
| Unit | Mapping table, validation rules, aggregation, crop geometry |
| Contract (daily, CI) | Live Digitraffic endpoints still return the fields we use |
| Model | Fixed test set; fails the build if metrics drop |
| End to end | One cycle against recorded fixtures; API returns expected conditions |

## 16. Observability

- Structured JSON logs; `/v1/health` exposes cycle duration, images fetched, failures, data age.
- Ops agent reads health hourly and posts a summary (and anomalies) to a private channel.
- Alerting thresholds: data age > 30 min; > 10% image failures in a cycle; inference backlog > 2 cycles.
