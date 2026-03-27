import io
import os
import hashlib
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Iterator, List, Mapping, Optional, Tuple
from uuid import uuid4

import fitz
import numpy as np
from PIL import Image
from langchain_community.document_loaders.blob_loaders import Blob
from langchain_community.document_loaders.parsers.pdf import PyMuPDFParser, extract_from_images_with_rapidocr
from langchain_core.documents import Document

from src.logger.logging import get_logger
from src.modules.indexing.convert_files_to_pdf import upload_to_azure_datalake, upload_bytes_to_azure_datalake
from .image_processing import image_maybe_relevant
from src.config import settings

logger = get_logger(__name__)

# ────────────────────────── constants ──────────────────────────
TEMP_DIR_NAME = "tmp"
settings=settings.get_settings()
class PDFParser(PyMuPDFParser):
    """
    A class to parse PDF documents, with optional OCR and image extraction capabilities.
    """

    def __init__(
        self,
        text_kwargs: Optional[Mapping[str, Any]] = None,
        use_ocr: bool = False,
        save_images: bool = False,
        datalake_directory: Optional[str] = None,
        image_threshold_top: float = 0.05,
        image_threshold_bottom: float = 0.05,
        save_pages_as_images: bool = False,
    ):
        """
        Initialize the PDFParser with the given parameters.

        Args:
            text_kwargs (Optional[Mapping[str, Any]]): Additional keyword arguments for text extraction.
            use_ocr (bool): Flag to determine whether to use OCR for text extraction from images.
            save_images (bool): Flag to determine whether to save extracted images.
            datalake_directory (Optional[str]): Directory path for saving images in a datalake.
            image_threshold_top (float): Threshold for filtering images based on their top position on the page.
            image_threshold_bottom (float): Threshold for filtering images based on their bottom position on the page.
            save_pages_as_images (bool): Flag to determine whether to save entire pages as images.
        """
        self.text_kwargs = text_kwargs or {}
        self.use_ocr = use_ocr
        self.save_images = save_images
        self.datalake_directory = datalake_directory
        self.image_threshold_top = image_threshold_top
        self.image_threshold_bottom = image_threshold_bottom
        self.save_pages_as_images = save_pages_as_images

    def lazy_parse(self, blob: Blob) -> Iterator[Document]:
        """
        Lazily parse the blob and yield Document objects.

        Args:
            blob (Blob): The blob to parse.

        Yields:
            Document: Parsed document object.
        """
        import fitz

        with blob.as_bytes_io() as file_path:
            if blob.data is None:
                doc = fitz.open(file_path)
            else:
                doc = fitz.open(stream=file_path, filetype="pdf")

            with ThreadPoolExecutor(max_workers=16) as executor: # Mostly IO-bound in saving images to the blob storage
                futures = [executor.submit(self._process_page, doc, page, blob) for page in doc]
                for future in futures:
                    yield future.result()

    def _process_page(self, doc: fitz.Document, page: fitz.Page, blob: Blob) -> Document:
        """
        Process a single page of the document and return a Document object.

        Args:
            doc (fitz.Document): The PDF document.
            page (fitz.Page): The page to process.
            blob (Blob): The blob containing the document.

        Returns:
            Document: The processed document object.
        """
        images_content, file_paths = self._extract_images_from_page(doc, page)
        page_content = page.get_text(**self.text_kwargs) + images_content  # type: ignore

        metadata = dict(
            {
                "source": blob.source,
                "file_path": blob.source,
                "page": page.number + 1 if page.number is not None else 0,
                "total_pages": len(doc),
                "images": file_paths,
                "n_characters": len(page_content),
                "n_words": len(page_content.split()),
            }
        )

        if self.save_pages_as_images:
            metadata["page_image"] = self._extract_page_as_image(page)

        return Document(
            page_content=page_content,
            metadata=metadata,
        )

    def _get_images_from_page(self, page: fitz.Page):
        """
        Get images from a page that meet the specified threshold criteria.

        Args:
            page (fitz.Page): The page to extract images from.

        Returns:
            List: A list of filtered images.
        """
        img_list = page.get_images(full=True)
        filtered_img_list = []
        for img in img_list:
            bbox = page.get_image_bbox(img)
            if not isinstance(bbox, fitz.Rect):
                raise TypeError(f"Expected bounding box of type Rect, found {type(bbox)} instead.")
            y0, y1 = bbox.y0, bbox.y1
            page_height = page.rect.height
            if not isinstance(page_height, float):
                raise TypeError(f"Expected page height of type float, found {type(page_height)} instead")
            img_top_percentage = y0 / page_height
            img_bottom_percentage = (page_height - y1) / page_height

            # Check if the image is within the specified thresholds
            if img_top_percentage > self.image_threshold_top and img_bottom_percentage > self.image_threshold_bottom:
                filtered_img_list.append(img)
        return filtered_img_list

    def _save_image_from_xref(self, xref, doc: fitz.Document) -> str:
        """
        Save an image from a given xref and return the local path.

        Args:
            xref: The xref of the image.
            doc (fitz.Document): The PDF document.

        Returns:
            str: The local path where the image is saved.
        """
        base_images = doc.extract_image(xref)
        image_bytes = base_images["image"]
        image_ext = base_images["ext"]
        image = Image.open(io.BytesIO(image_bytes))
        local_path = os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, f"{uuid4()}.{image_ext}")
        with open(local_path, "wb") as f:
            image.save(f)
        return local_path

    def _get_datalake_destination_path(self) -> str:
        """
        Get the destination path for saving images in the datalake.

        Returns:
            str: The destination path for the datalake.
        """
        if self.datalake_directory:
            return f"{self.datalake_directory}/images/{uuid4()}.png"
        return f"images/{uuid4()}.png"

    def _extract_images_from_page(self, doc: fitz.Document, page: fitz.Page) -> Tuple[str, List[str]]:
        """
        Extract images from a page, upload them to Azure datalake, and get the text with RapidOCR.

        Args:
            doc (fitz.Document): The PDF document.
            page (fitz.Page): The page to extract images from.

        Returns:
            Tuple[str, List[str]]: A tuple containing the extracted text and a list of file paths.
        """
        if not self.save_images and not self.use_ocr:
            return ("", [])
        import fitz

        img_list = self._get_images_from_page(page)
        images = []
        file_paths: List[str] = []
        logger.info(f"Extracting {len(img_list)} images from page {page.number}")
        for img in img_list:
            xref = img[0]
            pix = fitz.Pixmap(doc, xref)
            image_ndarray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, -1)
            if not image_maybe_relevant(image_ndarray):
                continue
            if self.save_images:
                local_path = self._save_image_from_xref(xref, doc)
                destination_path = self._get_datalake_destination_path()
                upload_to_azure_datalake(local_path, destination_path)
                file_paths.append(destination_path)
            if self.use_ocr:
                images.append(image_ndarray)
        return extract_from_images_with_rapidocr(images), file_paths

    def _extract_page_as_image(self, page: fitz.Page) -> str:
        """
        Extract a page as an image and upload it to Azure datalake.

        Args:
            page (fitz.Page): The page to extract as an image.

        Returns:
            str: The remote path where the image is saved.
        """
        pix = page.get_pixmap(dpi=300)
        # Create a deterministic hash based on the pix variable
        hash_object = hashlib.sha256(pix.samples)
        hex_dig = hash_object.hexdigest()[:16]
        # Deterministic names for the same images to save space in case of re-indexing.
        image_remote_path = f"{self.datalake_directory}/{hex_dig}_page_{page.number}.png"
        upload_bytes_to_azure_datalake(pix.tobytes(), image_remote_path)

        return image_remote_path
