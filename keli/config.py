"""Settings: ``config/keli.json`` for every non-secret value, ``.env`` / environment for secrets.

Precedence, highest first: constructor arguments, environment variables (prefix ``KELI_``),
``.env``, the JSON file, then the defaults below. Secrets such as the database URL live only
in ``.env`` or the environment, never in the JSON file (it is committed).
"""

from pathlib import Path

from pydantic import BaseModel, Field, SecretStr
from pydantic_settings import (
    BaseSettings,
    JsonConfigSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

CONFIG_FILE = Path("config/keli.json")


class HazardSettings(BaseModel):
    """Thresholds for ``keli.labels.hazard`` (see its docstring for sensor meanings)."""

    grip_high_below: float = 0.30
    grip_medium_below: float = 0.45
    freeze_horizon_h: float = Field(default=1.0, gt=0)
    frost_margin_c: float = Field(default=1.0, ge=0)
    precip_min_mm_h: float = Field(default=0.1, ge=0)
    precip_max_mm_h: float = Field(default=100.0, gt=0)


class Settings(BaseSettings):
    """Runtime configuration for the recorder, importer and API."""

    model_config = SettingsConfigDict(
        env_prefix="KELI_", env_file=".env", json_file=CONFIG_FILE, extra="ignore"
    )

    # Secrets (only from .env or the environment).
    database_url: SecretStr | None = None

    data_dir: Path = Path("data")
    digitraffic_base_url: str = "https://tie.digitraffic.fi"
    image_base_url: str = "https://weathercam.digitraffic.fi"

    # 1,200 requests per 5 minutes is 20% of Digitraffic's 6,000 limit.
    rate_limit_requests: int = Field(default=1200, gt=0)
    rate_limit_window_s: float = Field(default=300.0, gt=0)

    cycle_s: float = Field(default=600.0, gt=0)
    full_image_interval_s: float = Field(default=3600.0, gt=0)
    metadata_refresh_s: float = Field(default=86400.0, gt=0)
    training_radius_km: float = Field(default=0.5, gt=0)
    # A preset whose latest image is older than this is frozen (camera down or placeholder
    # image); recording it again wastes budget and pollutes training data.
    max_image_age_s: float = Field(default=3600.0, gt=0)

    # Winter maintenance tracks and road weather forecasts, recorded each cycle.
    maintenance_tasks: list[str] = Field(
        default_factory=lambda: [
            "SALTING", "LINE_SANDING", "SPOT_SANDING", "PLOUGHING_AND_SLUSH_REMOVAL",
            "REMOVAL_OF_BULGE_ICE",
        ]
    )  # fmt: skip
    maintenance_overlap_s: float = Field(default=120.0, ge=0)  # re-ask a little to miss none
    maintenance_initial_lookback_s: float = Field(default=3600.0, gt=0, le=82800)  # API max < 24 h

    # API: maintenance and forecast context around a camera.
    maintenance_radius_m: float = Field(default=150.0, gt=0)  # track to camera distance
    maintenance_window_h: float = Field(default=12.0, gt=0)  # "last treated" look-back
    maintenance_layer_max_h: float = Field(default=6.0, gt=0)  # map layer window cap
    forecast_radius_m: float = Field(default=3000.0, gt=0)  # camera to forecast section

    workers: int = Field(default=8, gt=0)
    image_timeout_s: float = Field(default=10.0, gt=0)
    json_timeout_s: float = Field(default=60.0, gt=0)

    # Importer: only these sensors go into the database (labels and map need no others).
    imported_sensors: list[str] = Field(
        default_factory=lambda: [
            "KELI_1", "KELI_2", "TIE_1", "TIE_2", "VAROITUS_1", "VAROITUS_2",
            "OPTISEN_ANTURIN_KELI1", "OPTISEN_ANTURIN_KELI2", "ILMA", "KITKA1_LUKU",
            "TIE_1_DERIVAATTA", "KUURAPISTE_ERO_TIE", "SADE_INTENSITEETTI",
        ]
    )  # fmt: skip
    # A sensor reading older than this is not a label (CLAUDE.md: 60 min).
    label_max_age_s: float = Field(default=3600.0, gt=0)
    hazard: HazardSettings = Field(default_factory=HazardSettings)

    # API. With web_dist_dir built (cd frontend && npm run build) the API also serves the
    # web app on the same port: one server, no CORS. None or a missing folder = API only.
    web_dist_dir: Path | None = Path("frontend/dist")
    api_cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    api_max_history_hours: int = Field(default=72, gt=0)
    db_pool_max: int = Field(default=5, gt=0)
    db_connect_timeout_s: float = Field(default=5.0, gt=0)
    # When PostgreSQL is unreachable the API serves Digitraffic's latest data instead.
    live_fallback: bool = True
    live_cache_s: float = Field(default=60.0, gt=0)  # one Digitraffic call per minute at most
    db_retry_s: float = Field(default=30.0, gt=0)  # how often to try the database again

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,  # noqa: ARG003 - name fixed by pydantic
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """Add the JSON file below the environment so env vars can override it."""
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            JsonConfigSettingsSource(settings_cls),
        )
