"""Settings, read only from environment variables (prefix ``KELI_``) or a local ``.env``."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the recorder.

    Defaults are the public Digitraffic endpoints and the limits from CLAUDE.md.
    """

    model_config = SettingsConfigDict(env_prefix="KELI_", env_file=".env", extra="ignore")

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

    workers: int = Field(default=8, gt=0)
    image_timeout_s: float = Field(default=10.0, gt=0)
    json_timeout_s: float = Field(default=60.0, gt=0)
