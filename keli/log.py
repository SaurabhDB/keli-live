"""Structured JSON logging on top of the standard ``logging`` module.

Pass structured fields with ``logger.info("event", extra={"fields": {...}})``.
"""

import json
import logging
from datetime import UTC, datetime
from typing import Any, override


class JsonFormatter(logging.Formatter):
    """Format each record as one JSON object per line."""

    @override
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            entry.update(fields)
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Send JSON logs to stderr for the whole process."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # httpx logs every request at INFO; ~2,300 lines per cycle is noise.
    logging.getLogger("httpx").setLevel(logging.WARNING)
