---
name: keli-engineering-standards
description: Clean-code rules, quality gates (lint, types, tests, security), commit conventions, error handling and the GitHub Actions CI/CD pipeline for the Keli Live repository. Use whenever writing, reviewing, refactoring or committing code, adding a dependency, setting up or changing CI/CD, or fixing a failing pipeline.
---

# Keli Live engineering standards

Keli Live is read by recruiters and senior engineers. Every change must look like it came from a well-run enterprise team: clean, typed, tested, secure, reviewed by automation. Project context lives in `CLAUDE.md`; this skill covers **how** code is written, checked and shipped.

## 1. Workflow for every change

1. Read the relevant LLD section; state a short plan (files, tests, docs).
2. Create a branch: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`, `docs/<short-name>`.
3. Write the test first when fixing a bug or adding logic.
4. Implement in small steps.
5. Run the local gate (section 4). Fix everything; never silence a check to get green.
6. Commit with a Conventional Commit message (section 6).
7. Push and open a pull request using the PR template; CI must pass before merge.
8. Update docs in the same PR when behaviour, config or schema changes.

Never push directly to `main`. Never use `--no-verify`, `git push --force` on shared branches, or skip CI.

## 2. Clean-code rules

### Design
- Single responsibility: one module = one concern; one function = one job.
- Functions ≤ 40 lines, ≤ 4 parameters (group the rest in a pydantic model or dataclass), cyclomatic complexity ≤ 10 (ruff `C901`).
- Pure functions for domain logic (mapping, validation, aggregation); I/O at the edges.
- Dependency injection: pass clients, sessions and settings in; no global state, no module-level connections.
- Name things for the domain: `preset_id`, `road_temp_c`, `station_dist_m`. Units in names when not obvious.
- No magic numbers: constants in `keli/constants.py` or settings, with a comment saying where the value comes from.
- Prefer composition over inheritance; use `Protocol` for interfaces (e.g. `Voter`, `ImageStore`).
- Delete dead code; no commented-out code; no `TODO` without an issue number (`TODO(#12): …`).

### Python specifics
- Python 3.12, full type hints, `from __future__ import annotations` not needed.
- pydantic v2 models at every boundary (Digitraffic responses, API I/O, config).
- `pathlib`, f-strings, `enum.StrEnum` for fixed sets (road classes, alert status).
- Timezone-aware UTC datetimes only.
- Async I/O (`httpx.AsyncClient`, `asyncpg`); never block the event loop (no `time.sleep`, no sync HTTP in async code).
- Context managers for every resource (clients, sessions, files).
- Docstrings (Google style) on public modules, classes and functions; comments explain *why*, not *what*.

### Error handling
- Custom exception hierarchy in `keli/errors.py`:
  ```python
  class KeliError(Exception): """Base for all Keli Live errors."""
  class DigitrafficError(KeliError): ...
  class RateLimitedError(DigitrafficError): ...
  class DataValidationError(KeliError): ...
  class StorageError(KeliError): ...
  class ModelError(KeliError): ...
  ```
- Catch specific exceptions only; never bare `except:` or `except Exception: pass`.
- Retry only transient failures (timeouts, 5xx, 429) with exponential backoff + jitter (`tenacity`), max 3 attempts; log each retry.
- Fail one item, not the cycle: a bad image or station is logged and skipped; the cycle continues and reports counts.
- Validate at the boundary, trust inside: invalid external data raises `DataValidationError` with the offending field.
- API errors return RFC 9457 problem details (`type`, `title`, `status`, `detail`), never stack traces.
- Structured JSON logs (`structlog`) with `event`, `preset_id`/`station_id`, `cycle_id`; never log secrets or full payloads.
- Unexpected errors in services are reported to error tracking (GlitchTip, open-source and Sentry-compatible) when `SENTRY_DSN` is set.

### Frontend (`web/`)
- Vanilla ES modules, no framework, no bundler.
- `const`/`let` only, strict equality, no globals except one `app` namespace; escape any text inserted as HTML.
- ESLint (flat config, `eslint:recommended`) + Prettier.

## 3. Tooling (configured in `pyproject.toml` and `.pre-commit-config.yaml`)

| Concern | Tool | Rule |
|---|---|---|
| Lint + import order + style | **ruff** | Rule sets below; zero warnings |
| Formatting | **ruff format** | Line length 100 |
| Static types | **mypy --strict** | Zero errors; `# type: ignore[code]` only with a reason |
| Tests | **pytest**, pytest-asyncio, pytest-cov | Coverage ≥ 85% overall, ≥ 95% for `keli/labels` and `keli/ingest/validate.py` |
| Property tests | **hypothesis** | For mapping, validation, aggregation |
| Security (code) | **bandit** | No medium/high findings |
| Security (deps) | **pip-audit** | No known vulnerabilities |
| Secrets | **gitleaks** | Pre-commit and CI |
| Dockerfiles | **hadolint** | No errors |
| YAML / workflows | **yamllint**, **actionlint** | No errors |
| JS / CSS | **eslint**, **prettier** | No errors |
| Commit messages | **commitizen** | Conventional Commits |
| Dead code | **vulture** (CI, advisory) | Review findings |
| Code quality dashboard | **SonarCloud** (free for public repos) | Quality gate passed; no new bugs, vulnerabilities or code smells rated above minor |

### `pyproject.toml` (tool sections)

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "N", "UP", "B", "A", "C4", "C90", "SIM", "RET", "ARG",
          "PTH", "PL", "RUF", "S", "ASYNC", "DTZ", "T20", "ERA", "PT", "TRY", "D"]
ignore = ["D203", "D213", "TRY003"]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "D", "PLR2004", "ARG"]
"scripts/**" = ["T20", "D"]

[tool.ruff.lint.mccabe]
max-complexity = 10

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.mypy]
strict = true
python_version = "3.12"
plugins = ["pydantic.mypy"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
addopts = "-q --strict-markers --cov=keli --cov-report=term-missing --cov-fail-under=85"
markers = ["contract: hits the live Digitraffic API", "slow: long-running"]

[tool.coverage.run]
branch = true
omit = ["keli/models/train.py"]

[tool.bandit]
exclude_dirs = ["tests", "scripts"]
```

### `.pre-commit-config.yaml`

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-added-large-files
        args: ["--maxkb=500"]
      - id: detect-private-key
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.8.0
    hooks:
      - id: ruff
        args: ["--fix"]
      - id: ruff-format
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.13.0
    hooks:
      - id: mypy
        additional_dependencies: ["pydantic>=2", "types-requests"]
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.0
    hooks:
      - id: gitleaks
  - repo: https://github.com/commitizen-tools/commitizen
    rev: v4.0.0
    hooks:
      - id: commitizen
        stages: [commit-msg]
```

Hook versions above are a starting point: run `pre-commit autoupdate` on setup and pin what it writes.

## 4. Local gate (run before every commit)

```bash
pre-commit run --all-files
mypy keli
pytest
bandit -c pyproject.toml -r keli
pip-audit
```

All must pass. If a check fails, fix the cause. Only relax a rule with a one-line justification in the config and mention it in the PR.

## 5. Tests

- Layout mirrors the package: `tests/unit/...`, `tests/e2e/...`, `tests/contract/...`.
- Arrange-Act-Assert; one behaviour per test; descriptive names (`test_wet_below_zero_becomes_ice_risk`).
- No network in unit or e2e tests: recorded fixtures in `tests/fixtures/` (`respx` for httpx).
- Contract tests (`-m contract`) hit live Digitraffic, run only in the scheduled workflow.
- Database tests use a disposable PostGIS container (`testcontainers`), not a shared database.
- Every bug fix starts with a failing test that reproduces it.
- Model code: a tiny deterministic fixture dataset; assert shapes, determinism and that evaluation splits by camera.

## 6. Commits, branches, versions

- **Conventional Commits:** `type(scope): summary` in the imperative, ≤ 72 characters.
  Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`.
  Example: `feat(ingest): spread image requests evenly across the cycle`.
- Body explains *why*; reference issues (`Closes #14`). Breaking changes: `BREAKING CHANGE:` footer.
- One logical change per commit; no "wip" or "fix stuff" on `main`.
- Squash-merge PRs; the PR title is a Conventional Commit.
- Semantic versioning via `cz bump`; `CHANGELOG.md` generated from commits; tags `vX.Y.Z`.

## 7. CI/CD (GitHub Actions)

### Workflows

| File | Trigger | Jobs |
|---|---|---|
| `.github/workflows/ci.yml` | push, pull_request | lint → typecheck → test (with PostGIS service) → security → build image |
| `.github/workflows/contract.yml` | daily 05:00 UTC + manual | live Digitraffic contract tests; opens an issue on failure |
| `.github/workflows/release.yml` | tag `v*` | build and push image to GHCR, create GitHub Release with changelog |
| `.github/workflows/deploy.yml` | after release succeeds, manual approval (`production` environment) | SSH deploy with Docker Compose, smoke test `/v1/health`, automatic rollback on failure |
| `.github/workflows/codeql.yml` | weekly + pull_request | CodeQL security analysis (Python, JavaScript) |
| `.github/dependabot.yml` | weekly | pip, GitHub Actions, Docker updates |

### `ci.yml` skeleton

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: pip }
      - run: pip install -e ".[dev]"
      - run: pre-commit run --all-files --show-diff-on-failure
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: pip }
      - run: pip install -e ".[dev]"
      - run: mypy keli
  test:
    runs-on: ubuntu-latest
    needs: [lint, typecheck]
    services:
      db:
        image: postgis/postgis:16-3.4
        env: { POSTGRES_PASSWORD: keli, POSTGRES_USER: keli, POSTGRES_DB: keli_test }
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://keli:keli@localhost:5432/keli_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: pip }
      - run: pip install -e ".[dev]"
      - run: pytest --junitxml=junit.xml --cov-report=xml
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: test-results, path: "junit.xml\ncoverage.xml" }
  security:
    runs-on: ubuntu-latest
    needs: [lint]
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: pip }
      - run: pip install -e ".[dev]"
      - run: bandit -c pyproject.toml -r keli
      - run: pip-audit
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
  build:
    runs-on: ubuntu-latest
    needs: [test, security]
    steps:
      - uses: actions/checkout@v4
      - uses: hadolint/hadolint-action@v3.1.0
      - uses: docker/build-push-action@v6
        with: { context: ., push: false, tags: "keli-live:ci" }
```

Pin third-party actions to a full commit SHA once the pipeline is stable.

### Repository settings (document in `docs/Technical_Documentation.md`)
- Branch protection on `main`: PR required, all CI jobs required, linear history, no force pushes.
- `production` environment with required approval for deploys.
- Secrets only in GitHub Actions secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `S3_*`, `LLM_API_KEY`, `SENTRY_DSN`.
- Dependabot and secret scanning enabled.
- Add CI, coverage and SonarCloud badges to the README.

### When CI fails
1. Read the failing job's log; reproduce locally with the same command.
2. Fix the cause in a new commit (`fix(ci): …` or the real fix). Don't re-run hoping it passes, except for a clearly flaky external service, and then open an issue.
3. Never lower coverage thresholds, disable rules or mark tests `skip` to get green without the user's agreement.
4. Contract-test failure = Digitraffic changed: update `keli/digitraffic/models.py`, add a fixture for the new shape, note it in the changelog.
5. Deploy failure: the workflow rolls back to the previous image; investigate with `docker compose logs`, fix forward with a new release.

## 8. Pull request checklist (`.github/pull_request_template.md`)

```markdown
## What and why
<!-- one paragraph -->

## How tested
<!-- commands, new tests -->

## Checklist
- [ ] Conventional Commit title
- [ ] Tests added/updated; coverage not lower
- [ ] `pre-commit`, `mypy`, `pytest`, `bandit`, `pip-audit` pass locally
- [ ] Docs updated (README / LLD / technical docs) if behaviour changed
- [ ] No secrets, no live API calls in default tests, attribution intact
- [ ] No privacy-sensitive features (plates, tracking)
```

## 9. Self-review before finishing a task

Ask, and fix anything that fails:
- Would a senior reviewer understand this code without explanation?
- Is every function small, typed, documented and tested?
- Are errors specific, logged with context, and handled without losing the cycle?
- Did I add a dependency? Is it justified and in `pyproject.toml` with a version range?
- Do the docs still describe the code?
- Did the full local gate pass?
