"""Loader exel using pandas"""

import os
from typing import List

import pandas as pd
from langchain_core.documents import Document

from src.logger.logging import get_logger

logger = get_logger(__name__)


class ExcelLoader:
    def __init__(self, file_path: str):
        logger.debug(f"Creating ExcelLoader with file path {file_path}")
        self.file_path = file_path
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File {file_path} not found")

    def load(self) -> List[Document]:
        logger.debug(f"Loading Excel document from {self.file_path}")
        sheets = pd.read_excel(self.file_path, sheet_name=None)
        page_number = 0
        documents: List[Document] = []
        logger.debug(f"Loaded {len(sheets)} sheets")
        for sheet_name, sheet_df in sheets.items():
            logger.debug(f"Processing sheet {sheet_name}")
            sheet_content = self._process_sheet(sheet_df)
            documents.append(
                Document(
                    page_content=sheet_content,
                    metadata={
                        "source": self.file_path,
                        "page": page_number,
                        "sheet_name": sheet_name,
                    },
                )
            )
        logger.debug(f"Loaded {len(documents)} documents")
        logger.debug(f"Documents: {documents}")
        return documents

    def _process_sheet(self, sheet_df: pd.DataFrame) -> str:
        logger.debug(f"Processing sheet with shape {sheet_df.shape}")
        sheet_content = sheet_df.to_csv(path_or_buf=None, index=False, quotechar='"', sep=",")
        logger.debug(f"Processed sheet content: {sheet_content}")
        return sheet_content
