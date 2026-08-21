"""Canonical high-resolution image preparation used only by Gemini."""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError


DEFAULT_MAX_DIMENSION = 1600
DEFAULT_MAX_PIXEL_COUNT = 40_000_000


class GeminiImagePreparationError(ValueError):
    """Raised when an upload cannot be safely prepared for Gemini."""


@dataclass(frozen=True)
class PreparedGeminiImage:
    canonical_bytes: bytes
    mime_type: str
    width: int
    height: int
    sha256: str


def prepare_gemini_image(
    image_bytes: bytes,
    *,
    max_dimension: int = DEFAULT_MAX_DIMENSION,
    max_pixel_count: int = DEFAULT_MAX_PIXEL_COUNT,
) -> PreparedGeminiImage:
    if not image_bytes:
        raise GeminiImagePreparationError("Image bytes are empty.")

    if max_dimension <= 0 or max_pixel_count <= 0:
        raise GeminiImagePreparationError("Image safety limits are invalid.")

    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            width, height = source.size

            if width <= 0 or height <= 0:
                raise GeminiImagePreparationError("Image dimensions are invalid.")

            if width * height > max_pixel_count:
                raise GeminiImagePreparationError(
                    "Image pixel count exceeds the Gemini safety limit."
                )

            source.load()
            canonical = ImageOps.exif_transpose(source).convert("RGB")

            # Pillow can carry source fields such as JPEG comments through a
            # mode conversion. Clear the copied metadata before re-encoding.
            canonical.info.clear()

            if max(canonical.size) > max_dimension:
                canonical.thumbnail(
                    (max_dimension, max_dimension),
                    resample=Image.Resampling.LANCZOS,
                )

            # Saving a newly encoded RGB image without EXIF/ICC arguments strips
            # source metadata while retaining substantially more detail than the
            # separate 224x224 specialist path.
            output = io.BytesIO()
            canonical.save(
                output,
                format="JPEG",
                quality=90,
                optimize=False,
                progressive=False,
                subsampling=0,
            )
            canonical_bytes = output.getvalue()
            canonical_width, canonical_height = canonical.size

    except GeminiImagePreparationError:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as error:
        raise GeminiImagePreparationError(
            "Image could not be safely canonicalized for verification."
        ) from error

    return PreparedGeminiImage(
        canonical_bytes=canonical_bytes,
        mime_type="image/jpeg",
        width=canonical_width,
        height=canonical_height,
        sha256=hashlib.sha256(canonical_bytes).hexdigest(),
    )
