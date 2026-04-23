"""
SQLAlchemy models for logical indexing storage.

Stores parsed document structure including:
- Documents (metadata, TOC, overview)
- Blocks (headings, text, tables)
- Sections (hierarchical structure)
- Images (extracted image/figure/chart regions with VLM descriptions)
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Float,
    DateTime,
    ForeignKey,
    Index,
    JSON,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import HALFVEC as PgHalfVector

from src.db.session import Base
from src.config.settings import get_settings


settings = get_settings()
LOGICAL_INDEXING_EMBEDDING_DIMENSION = settings.EMBEDDING_DIMENSION

CASCADE_ALL_DELETE_ORPHAN = "all, delete-orphan"
FK_LOGICAL_DOCUMENTS_ID = "logical_documents.id"


class LogicalDocument(Base):
    """
   
    

    Links to external documents via external_id and brain_id.
    Stores overall document structure and metadata.
    """
    __tablename__ = "logical_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(String(255), unique=True, nullable=False)
    external_id = Column(String(255), nullable=False, index=True)
    brain_id = Column(String(255), nullable=False, index=True)
    source = Column(Text, nullable=True)
    total_pages = Column(Integer, nullable=False)
    overview = Column(Text, nullable=True)
    toc = Column(Text, nullable=True)  # Table of contents (JSON or markdown)
    processing_time_ms = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    blocks = relationship("LogicalBlock", back_populates="document", cascade=CASCADE_ALL_DELETE_ORPHAN)
    sections = relationship("LogicalSection", back_populates="document", cascade=CASCADE_ALL_DELETE_ORPHAN)
    images = relationship("LogicalImage", back_populates="document", cascade=CASCADE_ALL_DELETE_ORPHAN)

    def __repr__(self) -> str:
        return f"<LogicalDocument(id={self.id}, doc_id={self.doc_id}, external_id={self.external_id})>"


class LogicalBlock(Base):
    """
    Content block from document parsing.

    Represents individual elements like headings, paragraphs,
    tables, and images extracted from the document.
    """
    __tablename__ = "logical_blocks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey(FK_LOGICAL_DOCUMENTS_ID, ondelete="CASCADE"), nullable=False)
    block_id = Column(String(255), nullable=False)
    block_type = Column(String(50), nullable=False, index=True)  # heading, text, table, image, etc.
    content = Column(Text, nullable=True)
    content_tsv = Column(TSVECTOR, nullable=True)  # Full-text search vector
    embedding = Column(
        PgHalfVector(LOGICAL_INDEXING_EMBEDDING_DIMENSION),
        nullable=True,
    )
    page_number = Column(Integer, nullable=True)
    bbox = Column(JSON, nullable=True)  # {"x1": 0, "y1": 0, "x2": 100, "y2": 100}
    level = Column(Integer, nullable=True)  # For headings (1-6)
    parent_id = Column(String(255), nullable=True)  # Parent block ID for hierarchy
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    document = relationship("LogicalDocument", back_populates="blocks")

    # Indexes
    __table_args__ = (
        Index("idx_logical_blocks_doc", "document_id"),
        Index("idx_logical_blocks_type", "block_type"),
    )

    def __repr__(self) -> str:
        return f"<LogicalBlock(id={self.id}, type={self.block_type}, page={self.page_number})>"


class LogicalSection(Base):
    """
    Hierarchical document structure.

    Represents sections/subsections extracted from the document,
    useful for navigation and hierarchical retrieval.
    """
    __tablename__ = "logical_sections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey(FK_LOGICAL_DOCUMENTS_ID, ondelete="CASCADE"), nullable=False)
    section_id = Column(String(255), nullable=False)
    title = Column(Text, nullable=True)  # Changed from String(500) to Text for long titles
    title_tsv = Column(TSVECTOR, nullable=True)  # Full-text search vector
    level = Column(Integer, nullable=False)  # 1 = chapter, 2 = section, 3 = subsection, etc.
    parent_section_id = Column(String(255), nullable=True)
    start_block_id = Column(String(255), nullable=True)
    end_block_id = Column(String(255), nullable=True)
    page_start = Column(Integer, nullable=True)
    page_end = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    document = relationship("LogicalDocument", back_populates="sections")

    # Indexes
    __table_args__ = (
        Index("idx_logical_sections_doc", "document_id"),
    )

    def __repr__(self) -> str:
        return f"<LogicalSection(id={self.id}, title={self.title}, level={self.level})>"


class LogicalImage(Base):
    """
    Extracted image from document parsing.

    Stores image/figure/chart regions cropped from the document with
    VLM-generated descriptions, embeddings, and Azure Data Lake paths.
    """
    __tablename__ = "logical_images"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey(FK_LOGICAL_DOCUMENTS_ID, ondelete="CASCADE"), nullable=False)
    image_id = Column(String(255), nullable=False)
    section_id = Column(String(255), nullable=True)
    label = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    description_tsv = Column(TSVECTOR, nullable=True)
    embedding = Column(
        PgHalfVector(LOGICAL_INDEXING_EMBEDDING_DIMENSION),
        nullable=True,
    )
    image_path = Column(Text, nullable=True)
    image_compressed_path = Column(Text, nullable=True)
    bbox = Column(JSON, nullable=True)
    page_number = Column(Integer, nullable=True)
    dimensions = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    document = relationship("LogicalDocument", back_populates="images")

    __table_args__ = (
        Index("idx_logical_images_doc", "document_id"),
        Index("idx_logical_images_section", "section_id"),
    )

    def __repr__(self) -> str:
        return f"<LogicalImage(id={self.id}, image_id={self.image_id}, page={self.page_number})>"
