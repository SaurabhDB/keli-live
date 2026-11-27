"""Object storage: the ``ImageStore`` interface, a local-disk implementation and key layout.

Keys follow LLD section 4. An S3 implementation can replace ``LocalImageStore`` without
changing callers.
"""

import asyncio
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Protocol

from keli.errors import StorageError


class ImageStore(Protocol):
    """Write-once object store for images and raw payloads, addressed by key."""

    async def put(self, key: str, data: bytes) -> None:
        """Store ``data`` under ``key``, replacing any previous object."""
        ...

    async def exists(self, key: str) -> bool:
        """Whether an object with ``key`` exists."""
        ...


class LocalImageStore:
    """``ImageStore`` on the local file system, rooted at ``root``."""

    def __init__(self, root: Path) -> None:
        """Store objects under ``root`` (created on first write)."""
        self._root = root

    def path_for(self, key: str) -> Path:
        """File path for ``key``; rejects keys that would escape the root."""
        rel = PurePosixPath(key)
        if rel.is_absolute() or ".." in rel.parts or not rel.parts:
            raise StorageError(f"invalid object key: {key!r}")
        return self._root.joinpath(*rel.parts)

    async def put(self, key: str, data: bytes) -> None:
        """Write atomically (temp file + rename) so a crash never leaves half a file."""
        path = self.path_for(key)
        try:
            await asyncio.to_thread(_write_atomic, path, data)
        except OSError as exc:
            raise StorageError(f"cannot write {key}: {exc}") from exc

    async def exists(self, key: str) -> bool:
        """Whether the file for ``key`` exists."""
        return await asyncio.to_thread(self.path_for(key).is_file)


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def _day(ts: datetime) -> str:
    return ts.strftime("%Y/%m/%d")


def thumb_key(preset_id: str, captured_at: datetime) -> str:
    """``thumbs/{yyyy}/{mm}/{dd}/{preset_id}/{HHMM}.jpg`` (UTC capture time)."""
    return f"thumbs/{_day(captured_at)}/{preset_id}/{captured_at:%H%M}.jpg"


def full_key(preset_id: str, captured_at: datetime) -> str:
    """``full/{yyyy}/{mm}/{dd}/{preset_id}/{HHMM}.jpg`` (training presets, private)."""
    return f"full/{_day(captured_at)}/{preset_id}/{captured_at:%H%M}.jpg"


def sensors_key(fetched_at: datetime) -> str:
    """``sensors/{yyyy}/{mm}/{dd}/{HHMM}.json.gz``: raw station data of one cycle."""
    return f"sensors/{_day(fetched_at)}/{fetched_at:%H%M}.json.gz"


def metadata_key(kind: str, fetched_at: datetime) -> str:
    """``meta/{yyyy}/{mm}/{dd}/{kind}.json.gz``: daily camera or station list snapshot."""
    return f"meta/{_day(fetched_at)}/{kind}.json.gz"
