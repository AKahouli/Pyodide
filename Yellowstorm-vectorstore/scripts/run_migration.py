"""
Python script to create logical indexing tables and related search objects in PostgreSQL.

Usage:
    cd Yellowstorm-vectorstore
    python scripts/run_migration.py
"""

import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from src.config.settings import get_settings


def get_sync_database_url():
    """Convert async DATABASE_URL to sync URL for psycopg2."""
    settings = get_settings()
    url = settings.DATABASE_URL
    # Remove +asyncpg for psycopg2
    return url.replace('+asyncpg', '')


def run_sql_file(cursor, sql_file: str):
    """Execute one SQL migration file."""
    settings = get_settings()
    with open(sql_file, 'r', encoding='utf-8') as f:
        sql = f.read()
    sql = sql.replace("__EMBEDDING_DIMENSION__", str(settings.EMBEDDING_DIMENSION))

    print(f"Executing SQL file: {os.path.basename(sql_file)}")
    cursor.execute(sql)


def create_tables():
    """Create logical indexing tables plus FTS and halfvec search support."""

    # Get connection URL
    database_url = get_sync_database_url()
    print(f"Connecting to database...")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    sql_files = [
        os.path.join(script_dir, 'create_logical_indexing_tables.sql'),
        os.path.join(script_dir, 'add_fulltext_search.sql'),
        os.path.join(script_dir, 'add_embeddings.sql'),
        os.path.join(script_dir, 'add_logical_images_table.sql'),
        os.path.join(script_dir, 'add_source_column.sql'),
    ]

    # Connect and execute
    conn = psycopg2.connect(database_url)
    conn.autocommit = True

    try:
        cursor = conn.cursor()
        for sql_file in sql_files:
            run_sql_file(cursor, sql_file)
        print("✅ Tables created successfully!")
        print("")
        print("Created/updated database objects:")
        print("  - logical_documents")
        print("  - logical_blocks")
        print("  - logical_sections")
        print("  - logical_images")
        print("  - content_tsv / title_tsv / description_tsv columns and triggers")
        print(f"  - embedding HALFVEC({get_settings().EMBEDDING_DIMENSION}) column and HNSW index")

    except Exception as e:
        print(f"❌ Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    print("=" * 60)
    print("  Logical Indexing - Database Migration")
    print("=" * 60)
    print("")
    create_tables()
