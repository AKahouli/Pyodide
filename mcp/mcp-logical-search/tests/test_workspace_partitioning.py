import unittest

from sqlalchemy import select

from src.db.models import (
    LogicalBlock,
    LogicalDocument,
    LogicalImage,
    LogicalSection,
    LogicalTextPosition,
)
from src.mcp_server import db_helpers


class WorkspacePartitioningTests(unittest.TestCase):
    def test_search_models_require_workspace_id(self):
        self.assertFalse(LogicalBlock.__table__.c.workspace_id.nullable)
        self.assertFalse(LogicalSection.__table__.c.workspace_id.nullable)

    def test_partition_filter_is_directly_present_on_search_table(self):
        statement = db_helpers._apply_workspace_partition_filter(
            select(LogicalBlock.id),
            LogicalBlock,
            {
                "507f1f77bcf86cd799439011": {"workspace_id": "workspace-a"},
                "507f191e810c19729de860ea": {"workspace_id": "workspace-b"},
            },
            ["507f191e810c19729de860ea"],
        )

        compiled = statement.compile()
        self.assertIn("logical_blocks.workspace_id IN", str(compiled))
        self.assertIn(["workspace-b"], compiled.params.values())

    def test_document_primary_and_foreign_keys_use_mongo_style_strings(self):
        self.assertEqual(LogicalDocument.__table__.c.id.type.length, 25)
        self.assertFalse(LogicalDocument.__table__.c.id.autoincrement is True)
        for model in (LogicalBlock, LogicalSection, LogicalImage, LogicalTextPosition):
            self.assertEqual(model.__table__.c.document_id.type.length, 25)

if __name__ == "__main__":
    unittest.main()
