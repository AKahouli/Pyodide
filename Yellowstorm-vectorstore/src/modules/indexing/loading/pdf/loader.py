""" PDF Loader module """

from typing import Any, Dict, List, Optional

from langchain_community.document_loaders import PyMuPDFLoader
from langchain_community.document_loaders.blob_loaders import Blob
from langchain_core.documents import Document

from src.logger.logging import get_logger
from .parser import PDFParser

logger = get_logger(__name__)


class PDFLoader(PyMuPDFLoader):
    def  __init__(
        self,
        file_path: str,
        *,
        headers: Optional[Dict] = None,
        use_ocr: bool = False,
        save_images: bool = False,
        datalake_directory: Optional[str] = None,
        save_pages_as_images: bool = False,
        **kwargs: Any,
    ) -> None:
        super().__init__(file_path, headers=headers, extract_images=use_ocr, **kwargs)
        self.save_images = save_images
        self.datalake_directory = datalake_directory
        self.save_pages_as_images = save_pages_as_images

    def load(self, **kwargs: Any) -> List[Document]:
        """Load file."""
        if kwargs:
            logger.warning(
                f"Received runtime arguments {kwargs}. Passing runtime args to `load`"
                f" is deprecated. Please pass arguments during initialization instead."
            )

        text_kwargs = {**self.text_kwargs, **kwargs}
        parser = PDFParser(
            text_kwargs=text_kwargs,
            use_ocr=self.extract_images,
            save_images=self.save_images,
            datalake_directory=self.datalake_directory,
            save_pages_as_images=self.save_pages_as_images,
        )
        if self.web_path:
            blob = Blob.from_data(open(self.file_path, "rb").read(), path=self.web_path)
        else:
            blob = Blob.from_path(self.file_path)
        return parser.parse(blob)
