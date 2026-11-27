from datetime import UTC, datetime
from pathlib import Path

import pytest

from keli.errors import StorageError
from keli.storage.objects import (
    LocalImageStore,
    full_key,
    metadata_key,
    sensors_key,
    thumb_key,
)

T = datetime(2026, 11, 24, 5, 35, 29, tzinfo=UTC)


def test_keys_follow_the_lld_layout() -> None:
    assert thumb_key("C0150401", T) == "thumbs/2026/11/24/C0150401/0535.jpg"
    assert full_key("C0150401", T) == "full/2026/11/24/C0150401/0535.jpg"
    assert sensors_key(T) == "sensors/2026/11/24/0535.json.gz"
    assert metadata_key("cameras", T) == "meta/2026/11/24/cameras.json.gz"


async def test_put_then_exists(tmp_path: Path) -> None:
    store = LocalImageStore(tmp_path)
    key = thumb_key("C0150401", T)

    assert not await store.exists(key)
    await store.put(key, b"jpeg")

    assert await store.exists(key)
    assert store.path_for(key).read_bytes() == b"jpeg"
    assert not list(tmp_path.rglob(".*.tmp"))  # temp file renamed away


@pytest.mark.parametrize("key", ["../escape.jpg", "/abs/path.jpg", ""])
def test_keys_cannot_escape_the_root(tmp_path: Path, key: str) -> None:
    with pytest.raises(StorageError, match="invalid object key"):
        LocalImageStore(tmp_path).path_for(key)


async def test_write_failure_raises_storage_error(tmp_path: Path) -> None:
    (tmp_path / "thumbs").write_text("a file where a folder should be")

    with pytest.raises(StorageError, match="cannot write"):
        await LocalImageStore(tmp_path).put(thumb_key("C0150401", T), b"jpeg")
