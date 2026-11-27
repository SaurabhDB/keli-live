import json
import logging
import sys

from keli.log import JsonFormatter, configure_logging


def _record(**extra: object) -> logging.LogRecord:
    record = logging.LogRecord("keli.test", logging.INFO, __file__, 1, "cycle_done", None, None)
    record.__dict__.update(extra)
    return record


def test_structured_fields_are_merged_into_one_json_line() -> None:
    line = JsonFormatter().format(_record(fields={"thumbs_saved": 6}))

    entry = json.loads(line)
    assert entry["event"] == "cycle_done"
    assert entry["level"] == "INFO"
    assert entry["thumbs_saved"] == 6


def test_exceptions_are_included() -> None:
    def fail() -> None:
        raise ValueError("boom")

    try:
        fail()
    except ValueError:
        line = JsonFormatter().format(_record(exc_info=sys.exc_info()))

    assert "ValueError: boom" in json.loads(line)["exc"]


def test_configure_logging_installs_the_json_handler() -> None:
    root = logging.getLogger()
    saved = root.handlers[:], root.level
    try:
        configure_logging()
        assert isinstance(root.handlers[0].formatter, JsonFormatter)
        assert logging.getLogger("httpx").level == logging.WARNING
    finally:
        root.handlers[:], level = saved
        root.setLevel(level)
