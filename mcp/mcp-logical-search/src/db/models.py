"""
SQLAlchemy models for logical indexing storage.

Stores parsed document structure including:
- Documents (metadata, overview)
- Blocks (headings, text, tables, images with VLM descriptions)
- Sections (flat named containers for blocks)
"""

from datetime import datetime

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
from sqlalchemy.orm import deferred, relationship
from pgvector.sqlalchemy import HALFVEC as PgHalfVector

from src.db.session import Base
from src.config.settings import get_settings


settings = get_settings()
LOGICAL_INDEXING_EMBEDDING_DIMENSION = settings.EMBEDDING_DIMENSION

CASCADE_ALL_DELETE_ORPHAN = "all, delete-orphan"
FK_LOGICAL_DOCUMENTS_ID = "logical_documents.id"


class LogicalDocument(Base):
    """
    Links to documents via user_id, file_name, and workspace_id.
    Stores overall document structure and metadata.
    """
    __tablename__ = "logical_documents"

    id = Column(String(25), primary_key=True)
    user_id = Column(String(255), nullable=False, index=True)
    file_name = Column(String(255), nullable=False, index=True)
    file_name_embedding = Column(PgHalfVector(LOGICAL_INDEXING_EMBEDDING_DIMENSION), nullable=True)
    workspace_id = Column(String(255), nullable=True, index=True)
    source = Column(Text, nullable=True)
    total_pages = Column(Integer, nullable=False)
    overview = Column(Text, nullable=True)
    processing_time_ms = Column(Float, nullable=True)
    fts_config = Column(String(50), nullable=True, default="english")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    blocks = relationship("LogicalBlock", back_populates="document", cascade=CASCADE_ALL_DELETE_ORPHAN)
    sections = relationship("LogicalSection", back_populates="document", cascade=CASCADE_ALL_DELETE_ORPHAN)
    images = relationship("LogicalImage", back_populates="document", cascade=CASCADE_ALL_DELETE_ORPHAN)
    text_positions = relationship("LogicalTextPosition", back_populates="document", cascade=CASCADE_ALL_DELETE_ORPHAN)

    __table_args__ = (
        Index("idx_logical_documents_user_workspace", "user_id", "workspace_id"),
        Index("idx_logical_documents_user_file", "user_id", "file_name"),
        Index("idx_logical_documents_user_workspace_file", "user_id", "workspace_id", "file_name"),
    )

    def __repr__(self) -> str:
        return f"<LogicalDocument(id={self.id}, file_name={self.file_name})>"


class LogicalBlock(Base):
    """
    Content block from document parsing.

    Represents individual elements like headings, paragraphs,
    tables, and images extracted from the document.
    workspace_id is deliberately duplicated from the owning document so a
    workspace-partitioned database can prune before vector/BM25 search.
    """
    __tablename__ = "logical_blocks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(String(25), ForeignKey(FK_LOGICAL_DOCUMENTS_ID, ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String(255), nullable=False)
    section_id = Column(String(255), nullable=True)
    block_type = Column(String(50), nullable=False, index=True)
    content = Column(Text, nullable=True)
    content_tsv = Column(TSVECTOR, nullable=True)
    embedding = Column(
        PgHalfVector(LOGICAL_INDEXING_EMBEDDING_DIMENSION),
        nullable=True,
    )
    page_number = Column(Integer, nullable=True)
    bbox = Column(JSON, nullable=True)
    block_id = Column(String(255), nullable=True)

    document = relationship("LogicalDocument", back_populates="blocks")

    __table_args__ = (
        Index("idx_logical_blocks_doc", "document_id"),
        Index("idx_logical_blocks_workspace_doc", "workspace_id", "document_id"),
        Index("idx_logical_blocks_type", "block_type"),
        Index("idx_logical_blocks_section", "section_id"),
        Index("idx_logical_blocks_block_id", "block_id"),
        Index("idx_logical_blocks_doc_section_id", "document_id", "section_id", "id"),
    )

    def __repr__(self) -> str:
        return f"<LogicalBlock(id={self.id}, type={self.block_type}, page={self.page_number})>"


class LogicalSection(Base):
    """
    Flat section container for blocks.

    Each section is a named grouping of blocks within a document.
    Section titles are embedded for semantic search.
    workspace_id must equal the owning document workspace for partition pruning.
    """
    __tablename__ = "logical_sections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(String(25), ForeignKey(FK_LOGICAL_DOCUMENTS_ID, ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String(255), nullable=False)
    section_id = Column(String(255), nullable=False)
    title = Column(Text, nullable=True)
    title_tsv = Column(TSVECTOR, nullable=True)
    embedding = Column(
        PgHalfVector(LOGICAL_INDEXING_EMBEDDING_DIMENSION),
        nullable=True,
    )
    page_number = Column(Integer, nullable=True)

    document = relationship("LogicalDocument", back_populates="sections")

    __table_args__ = (
        Index("idx_logical_sections_doc", "document_id"),
        Index("idx_logical_sections_workspace_doc", "workspace_id", "document_id"),
        Index("idx_logical_sections_doc_section", "document_id", "section_id"),
    )

    def __repr__(self) -> str:
        return f"<LogicalSection(id={self.id}, title={self.title})>"


class LogicalImage(Base):
    """
    Extracted image payloads and visual embeddings, separate from block text embeddings.
    """
    __tablename__ = "logical_images"

    id = Column(String(255), primary_key=True)
    document_id = Column(String(25), ForeignKey(FK_LOGICAL_DOCUMENTS_ID, ondelete="CASCADE"), nullable=True)
    section_id = Column(String(255), nullable=True)
    image_base64 = Column(Text, nullable=False)
    content = Column(Text, nullable=True)
    embedding = deferred(Column("image_embedding", PgHalfVector(LOGICAL_INDEXING_EMBEDDING_DIMENSION), nullable=True))
    page_number = Column(Integer, nullable=True)
    bbox = Column(JSON, nullable=True)
    words = Column(JSON, nullable=True)

    document = relationship("LogicalDocument", back_populates="images")

    __table_args__ = (
        Index("idx_logical_images_doc", "document_id"),
        Index("idx_logical_images_section", "section_id"),
        Index("idx_logical_images_doc_section", "document_id", "section_id"),
    )

    def __repr__(self) -> str:
        return f"<LogicalImage(id={self.id}, page={self.page_number})>"


class LogicalTextPosition(Base):
    """
    Word-level text positions extracted from source documents.
    """
    __tablename__ = "logical_text_positions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(String(25), ForeignKey(FK_LOGICAL_DOCUMENTS_ID, ondelete="CASCADE"), nullable=False)
    section_id = Column(String(255), nullable=True)
    block_id = Column(String(255), nullable=True, index=True)
    page_number = Column(Integer, nullable=False)
    words = Column(JSON, nullable=False)

    document = relationship("LogicalDocument", back_populates="text_positions")

    __table_args__ = (
        Index("idx_logical_text_positions_doc", "document_id"),
        Index("idx_logical_text_positions_block", "block_id"),
        Index("idx_logical_text_positions_doc_block", "document_id", "block_id"),
        Index("idx_logical_text_positions_doc_section_page", "document_id", "section_id", "page_number"),
    )

    def __repr__(self) -> str:
        return f"<LogicalTextPosition(id={self.id}, block_id={self.block_id}, page={self.page_number})>"
