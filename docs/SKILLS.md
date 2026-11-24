# Skills demonstrated in Keli Live

This page is for recruiters and hiring managers. It maps each part of Keli Live to the skill it proves and to where you can check it in the code.

## In one paragraph

Keli Live is a production-style AI system built end to end by one engineer. It takes live data from 800+ public cameras and 500+ sensor stations, labels its own training data automatically, trains and evaluates a computer-vision model, serves predictions through an API and a map, and uses LLM agents to explain risk and raise alerts, with a human approving what gets published.

## Skills map

| Skill | Where it shows in Keli Live | Where to look |
|---|---|---|
| **Real-time data engineering** | Polls 2,282 camera angles and 533 stations every 10 minutes, within rate limits, with retries and freshness checks | `keli/ingest/` |
| **Working with messy, real-world data** | Faulty sensors (code 0), stale readings, blocked lenses, night images, undocumented sensor codes decoded from live data | `keli/ingest/validate.py`, [Technical docs](docs/Technical_Documentation.md#sensor-reference) |
| **Weak supervision and data labelling** | Four automatic "voters" label images; only disagreements reach a human | `keli/labels/` |
| **Computer vision** | Zero-shot baseline (OpenCLIP), DINOv2 linear probe, fine-tuned ConvNeXt-Tiny | `keli/models/` |
| **Multimodal fusion** | Image features combined with road temperature and sensor readings | `keli/models/fusion.py` |
| **Honest ML evaluation** | Split by camera, never by image; per-class metrics; ice-risk recall as the safety metric | `keli/models/evaluate.py`, README results |
| **MLOps** | Versioned models, ONNX export, CPU inference, data and model cards, drift checks | `keli/models/registry.py` |
| **LLM agents** | Route-brief, mismatch, labelling and ops agents built with LangGraph | `keli/agents/` |
| **Model Context Protocol (MCP)** | Keli Live's data and tools exposed to any MCP-capable assistant | `keli/mcp_server/` |
| **Human-in-the-loop AI** | Alerts are drafted by an agent and approved by a person before publishing | `keli/agents/mismatch.py` |
| **Geospatial engineering** | PostGIS joins between cameras, stations, roads and routes | `keli/storage/schema.sql` |
| **API and backend design** | FastAPI service with typed models, pagination, caching | `keli/api/` |
| **Frontend** | Leaflet map with live layer, replay and detail panels | `web/` |
| **Cloud and cost engineering** | Runs on one EU server for about €18–38 a month; storage plan sized from measured volumes | [HLD](docs/HLD_Architecture.md#cost) |
| **Privacy and responsible AI** | No tracking, no plates, lane crops only, uncertainty shown, licences respected | README, [HLD](docs/HLD_Architecture.md#privacy-and-security) |
| **Testing and CI** | Unit tests, a daily API contract test against Digitraffic, linting | `tests/`, `.github/workflows/` |
| **Documentation and communication** | HLD, LLD, technical docs, timeline, plain-English README | `docs/` |
| **Product thinking** | Positioned against Vaisala, NIRA Dynamics and Fintraffic's own services; a clear gap: coverage beyond sensors | [HLD](docs/HLD_Architecture.md#context) |

## Transferable to your domain

The same patterns appear in very different industries.

| Keli Live problem | Banking and fintech | Telecom and networks | Logistics and mobility |
|---|---|---|---|
| Few trusted labels, lots of unlabelled data | Fraud and AML: confirmed cases are rare | Fault detection: real failures are rare | Damage and delay detection |
| Combining many live feeds of varying quality | Transactions, market and customer data | Thousands of network elements and KPIs | Fleet telematics, weather, traffic |
| Forecast vs reality mismatch alerts | Model monitoring, early-warning signals | Anomaly detection, AIOps | ETA and disruption alerts |
| LLM explains risk; human approves | Explainable, auditable AI for regulators | Assisted network operations | Dispatcher assistants |
| Privacy by design | GDPR, data minimisation | Subscriber data protection | Driver privacy |

## About the author

**Saurabh Bhadane**: 8+ years in applied AI and software engineering, including RAG, agentic AI and Azure OpenAI systems in healthcare and fintech. Looking for an on-site role in Finland or the Nordics.
