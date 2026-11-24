import re

import keli


def test_version_is_semver() -> None:
    assert re.fullmatch(r"\d+\.\d+\.\d+", keli.__version__)


def test_user_agent_carries_version() -> None:
    assert f"KeliLive/{keli.__version__}" == keli.USER_AGENT


def test_attribution_names_source_and_licence() -> None:
    assert keli.ATTRIBUTION == "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY"
