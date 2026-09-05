import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config.settings import get_settings
from src.grpc_server import chatbot_servicer as servicer_module
from src.grpc_server.chatbot_servicer import ChatbotServicer

IMAGE_BYTES = b"fake-image-bytes-0123456789"


def _write_image(tmp_path, name: str) -> str:
    file_path = tmp_path / name
    file_path.write_bytes(IMAGE_BYTES)
    return str(file_path)


@pytest.mark.asyncio
async def test_encodes_image_from_storage_router_as_data_uri(tmp_path):
    servicer = ChatbotServicer(MagicMock())
    local_path = _write_image(tmp_path, "image.png")

    with patch.object(servicer_module, "CommonHelpers") as helper_cls:
        helper_cls.return_value.async_download_from_storage = AsyncMock(
            return_value=local_path
        )

        result = await servicer._download_and_encode_images(["ws-1/photo.png"])

    helper_cls.return_value.async_download_from_storage.assert_awaited_once_with(
        "ws-1/photo.png"
    )
    assert len(result) == 1
    data_uri = result[0]["image 1"]
    assert data_uri == f"data:image/png;base64,{base64.b64encode(IMAGE_BYTES).decode()}"


@pytest.mark.asyncio
async def test_skips_oversized_image(tmp_path, monkeypatch):
    monkeypatch.setattr(
        servicer_module.app_settings, "MAX_IMAGE_SIZE", len(IMAGE_BYTES) - 1
    )
    servicer = ChatbotServicer(MagicMock())
    local_path = _write_image(tmp_path, "image.png")

    with patch.object(servicer_module, "CommonHelpers") as helper_cls:
        helper_cls.return_value.async_download_from_storage = AsyncMock(
            return_value=local_path
        )

        result = await servicer._download_and_encode_images(["ws-1/photo.png"])

    assert result == []


@pytest.mark.asyncio
async def test_isolates_per_image_download_failures(tmp_path):
    servicer = ChatbotServicer(MagicMock())
    local_path = _write_image(tmp_path, "image.png")

    async def fake_download(filepath: str) -> str:
        if "broken" in filepath:
            raise RuntimeError("download failed")
        return local_path

    with patch.object(servicer_module, "CommonHelpers") as helper_cls:
        helper_cls.return_value.async_download_from_storage = AsyncMock(
            side_effect=fake_download
        )

        result = await servicer._download_and_encode_images(
            ["ws-1/broken.png", "ws-1/good.jpg"]
        )

    assert len(result) == 1
    assert list(result[0].keys()) == ["image 2"]
    assert result[0]["image 2"].startswith("data:image/jpeg;base64,")


@pytest.mark.asyncio
async def test_limits_images_to_configured_maximum(tmp_path, monkeypatch):
    monkeypatch.setattr(servicer_module.app_settings, "MAX_IMAGES", 2)
    servicer = ChatbotServicer(MagicMock())
    local_path = _write_image(tmp_path, "image.png")

    with patch.object(servicer_module, "CommonHelpers") as helper_cls:
        helper_cls.return_value.async_download_from_storage = AsyncMock(
            return_value=local_path
        )

        result = await servicer._download_and_encode_images(
            ["ws-1/a.png", "ws-1/b.png", "ws-1/c.png"]
        )

    assert helper_cls.return_value.async_download_from_storage.await_count == 2
    assert [list(image.keys())[0] for image in result] == ["image 1", "image 2"]


def test_settings_expose_image_limits():
    settings = get_settings()
    assert settings.MAX_IMAGES >= 1
    assert settings.MAX_IMAGE_SIZE > 0
