# CLAUDE.md: Keli Live

Instructions for Claude Code working in this repository. Read this first, every session.

## What we are building

Keli Live is a live map of road-surface conditions (dry, wet, slush, snow, ice risk) for every collecting Finnish road camera (809 cameras, 2,282 presets). Road sensors exist near only ~20% of cameras; a computer-vision model trained on those cameras reads conditions from images everywhere else. An LLM agent explains route risk (v1); forecast-mismatch alerts drafted for human approval follow in v1.1. v1 scope and the 15 Dec go/no-go check are in `docs/Project_Timeline.md`; don't build v1.1 features unless asked.

It is an open-source portfolio project by Saurabh Bhadane, built to win an on-site AI engineering job in the Nordics. **Code quality, honest results and clear docs matter as much as features**: recruiters and engineers will read this repo.

## Sources of truth

| Topic | File |
|---|---|
| Goals, scope, components, cost, risks | `docs/HLD_Architecture.md` |
| Schema, modules, algorithms, API, config | `docs/LLD_Architecture.md` |
| Setup, data sources, sensor reference, runbook | `docs/Technical_Documentation.md` |
| Phases and current milestone | `docs/Project_Timeline.md` |
| Public description | `README.md` |

If code and docs disagree, ask which is right, then update the other in the same change.

## Current phase

Phase 0 → 1 (Nov–Dec 2026). Priority order:
1. **Recorder running 24/7** (`keli/ingest/`). Digitraffic deletes images after 24 h; every lost day is lost training data.
2. Database schema and validation.
3. API + map on real, sensor-based data.

Do not start agents or model work before the recorder is stable unless asked.

## Stack

Python 3.12 · FastAPI · PostgreSQL 16 + PostGIS · S3-compatible object storage (Hetzner) · httpx (async) · SQLAlchemy 2 / asyncpg · pydantic v2 + pydantic-settings · PyTorch (MPS on Apple Silicon) · timm · open_clip · ONNX Runtime · Label Studio · cleanlab · LangGraph · MCP Python SDK · Ollama · Leaflet + OpenStreetMap (vanilla JS, no build step) · Docker Compose · GitHub Actions · ruff · pytest.

Development machine: MacBook M1, 16 GB RAM, 256 GB disk. Keep memory and disk use modest; large data goes to an external SSD or object storage.

## Repository layout

```
keli/digitraffic/   API client, typed models, rate limiter
keli/ingest/        scheduler, cameras, sensors, announcements, validate
keli/storage/       schema.sql, db, objects (S3)
keli/vision/        lane crops, image quality
keli/labels/        voters (sensor, zeroshot, rules, vlm), aggregate, review
keli/models/        dataset, train, evaluate, fusion, export_onnx, registry, infer
keli/alerts/        deterministic mismatch rules
keli/agents/        LangGraph agents + shared tools
keli/api/           FastAPI app and routes
keli/mcp_server/    MCP server (read-only tools + route brief)
web/                static map (index.html, app.js, live.js, style.css)
scripts/            one-off checks (check_digitraffic.py, inspect_sensors.py)
tests/              unit, contract, e2e (fixtures in tests/fixtures/)
```

Put new code where the LLD says. Don't create new top-level folders without asking.

## Commands

```bash
source .venv/bin/activate
pip install -e ".[dev,ml]"
docker compose up -d db
python -m keli.storage.migrate
python -m keli.ingest --once            # one cycle
python -m keli.ingest                   # continuous
uvicorn keli.api.main:app --reload
cd web && python3 -m http.server 5173
ruff check . && ruff format .
pytest -q                               # unit + e2e (offline, fixtures)
pytest -q -m contract                   # hits live Digitraffic; run sparingly
```

## Non-negotiable rules

### Data and Digitraffic
- Base `https://tie.digitraffic.fi`; images `https://weathercam.digitraffic.fi/{presetId}.jpg` (`?thumbnail=true` ≈ 19 KB).
- Always send header `Digitraffic-User: KeliLive/<version>`; gzip for JSON.
- **Rate limit:** at most 1,200 image requests per 5 min (Digitraffic limit is 6,000). Spread requests evenly over the 10-minute cycle; never burst.
- Retries: 3, exponential backoff, only on 5xx/timeouts.
- Every API response, page and dataset carries: `Source: Fintraffic / digitraffic.fi, license CC 4.0 BY`.
- Tests must not hit the live API except those marked `@pytest.mark.contract`. Use recorded fixtures.

### Sensor mapping (confirmed 23 Nov 2026; don't change without new evidence)
- `KELI_n`: 0 fault · 1 dry · 2 moist · 3 wet · 4 wet+salty · 5 frost · 6 snow · 7 ice · 8 probably moist+salty · 9 slushy.
- `VAROITUS_n`: 0 OK · 1 beware · 2 alarm · 3 frost · 4 rain.
- Class map: dry {1}; wet {2,3,4,8}; slush {9}; snow {6}; ice_risk {5,7}; code 0 → no label.
- Overrides: `KELI_n` ∈ {2,3} (unsalted moist/wet) and `TIE_n` ≤ 0 °C → ice_risk; `VAROITUS_n` ∈ {2,3} → ice_risk.
- **Salt exception:** salty codes 4 and 8 stay `wet` at any temperature (salt lowers the freezing point; otherwise salted roads show false ice everywhere). Only `VAROITUS_n` can raise them to ice_risk.
- Use lanes 1 and 2 only. Ignore `PINTASIGNAALI_n`. Readings older than 60 min are not labels.
- Optical `OPTISEN_ANTURIN_KELIn` codes are inferred (same scale without 4 and 8); treat as provisional.
- A sensor labels a camera only if the station is within 0.5 km.

### Architecture
- **Deterministic core, agents at the edges.** Road conditions come from sensors or the model, never from an LLM. LLMs only summarise, explain or draft. Agent output is validated against structured evidence; alerts need human approval before publishing.
- Keep the Digitraffic client the only place that knows Digitraffic's field names.
- Async I/O for ingestion; no blocking calls in the event loop.
- Configuration only through environment variables (`keli/config.py`); never hard-code secrets or URLs of paid services.

### ML honesty
- Split data **by camera**, never by image. No camera in two splits.
- Report macro-F1, per-class recall and **ice-risk recall**; day and night separately.
- **Never invent or estimate metrics** in README, docs or commit messages. Only numbers produced by `keli.models.evaluate`, with snapshot name and date.
- Promote a model only if it beats the current one on test cameras and ice-risk recall doesn't drop.

### Privacy
- No number-plate reading, vehicle detection, tracking or counting. Don't add such models even "for testing".
- Store thumbnails and lane crops; full images only for training presets, private.
- Published datasets: lane crops only.

## Coding conventions
- Type hints everywhere; pydantic models at boundaries (API, Digitraffic, config).
- Small functions, clear names, docstrings on public functions; comments explain *why*.
- Logging: structured (JSON) via the standard `logging` module; no `print` in library code.
- Times are UTC `datetime` with tzinfo; store as `timestamptz`.
- Coordinates: GeoJSON order `[lon, lat]` from Digitraffic; convert explicitly, name variables `lat`, `lon`.
- Frontend: vanilla JS, no framework or bundler; keep it runnable with `python3 -m http.server`.
- Dependencies: ask before adding a new one; prefer the standard library and the stack above.

## How to work
1. Before coding, read the relevant section of the LLD and state a short plan.
2. Work in small, reviewable steps; one concern per commit.
3. Write or update tests with every change; `ruff` and `pytest` must pass.
4. Update docs (LLD, technical docs, README) in the same change when behaviour changes.
5. When unsure about a requirement, data meaning or a cost, ask rather than guess.
6. Never run long jobs (training, full ingestion) or anything that costs money without saying so first.
7. Never commit `.env`, credentials, images or model weights; they belong in object storage.

Commit messages: imperative and short, e.g. `Add rate limiter to Digitraffic client`.

## Definition of done (per change)
- [ ] Code follows the LLD and the rules above
- [ ] Tests added/updated; `ruff check .` and `pytest -q` pass
- [ ] Docs updated if behaviour, config or schema changed
- [ ] No secrets, no live-API calls in default tests, attribution intact
