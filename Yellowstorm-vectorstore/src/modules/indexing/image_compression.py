import os
from typing import Optional

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from src.logger.logging import get_logger

logger = get_logger(__name__)


def get_compressed_local_path(local_image_path: str) -> str:
    base_name = os.path.basename(local_image_path)
    name, _ = os.path.splitext(base_name)
    return os.path.join(os.path.dirname(local_image_path), f"{name}_compressed.jpeg")


def create_compressed_image(local_image_path: str) -> Optional[str]:
    """
    Create a compressed (50% resized enhanced) JPEG next to the original image.
    Returns the compressed local path on success, otherwise None.
    """
    try:
        with Image.open(local_image_path) as image:
            original_width, original_height = image.size

            new_width = max(1, int(original_width * 0.5))
            new_height = max(1, int(original_height * 0.5))

            if image.mode in ('RGBA', 'LA', 'P'):
                rgb_image = Image.new('RGB', image.size, (255, 255, 255))
                if image.mode == 'P':
                    image = image.convert('RGBA')
                rgb_image.paste(image, mask=image.split()[-1] if image.mode in ('RGBA', 'LA') else None)
                image = rgb_image
            elif image.mode != 'RGB':
                image = image.convert('RGB')

            image = ImageOps.autocontrast(image, cutoff=1)
            resized_image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            resized_image = resized_image.filter(ImageFilter.UnsharpMask(radius=1.5, percent=180, threshold=3))
            resized_image = ImageEnhance.Contrast(resized_image).enhance(1.15)

            compressed_local_path = get_compressed_local_path(local_image_path)
            resized_image.save(compressed_local_path, format='JPEG', quality=85, optimize=True)
            logger.info(
                f"Created compressed (50% enhanced) JPEG: {compressed_local_path} - "
                f"{original_width}x{original_height} -> {new_width}x{new_height}"
            )
            return compressed_local_path
    except Exception as e:
        logger.error(f"Error creating compressed JPEG for {local_image_path}: {e}")
        return None
