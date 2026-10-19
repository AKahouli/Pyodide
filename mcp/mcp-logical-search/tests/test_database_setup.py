import unittest
from unittest.mock import Mock, patch

from scripts import setup_database as setup


class DatabaseSetupTests(unittest.TestCase):
    def setUp(self):
        self.spec = {"name": "new_name", "table_name": "logical_documents",
                     "method": "btree", "keys": ["file_name"], "collations": ["default"],
                     "owner": "shared-ingestion", "options": {}, "sql": "CREATE INDEX example"}
        self.index = {"name": "ingestion_name", "table_name": "logical_documents",
                      "method": "btree", "keys": ["file_name", "id"],
                      "collations": ["default", None], "opclasses": [],
                      "valid": True, "ready": True, "partial": False, "options": []}
        self.catalog = {"tables": [{"name": "logical_documents", "kind": "r"}],
                        "indexes": [self.index], "columns": [], "primary_keys": [],
                        "triggers": [], "extensions": [{"name": n} for n in setup.EXTENSIONS],
                        "available_extensions": [{"name": n} for n in setup.EXTENSIONS]}

    def test_reuses_ingestion_index_with_different_name_and_extra_keys(self):
        missing, matched, issues = setup.plan_indexes([self.spec], self.catalog)
        self.assertEqual(missing, [])
        self.assertEqual(matched[0]["existing"], "ingestion_name")
        self.assertEqual(issues, [])

    def test_wrong_collation_is_not_equivalent(self):
        self.index["collations"][0] = "C"
        self.assertFalse(setup.equivalent(self.spec, self.index))

    def test_wrong_ann_operator_is_not_equivalent(self):
        self.spec.update(method="hnsw", keys=["embedding halfvec_cosine_ops"])
        self.index.update(method="hnsw", keys=["embedding"], opclasses=["halfvec_l2_ops"])
        self.assertFalse(setup.equivalent(self.spec, self.index))
        self.index["opclasses"] = ["halfvec_cosine_ops"]
        self.assertTrue(setup.equivalent(self.spec, self.index))

    def test_invalid_equivalent_index_is_blocked_instead_of_duplicated(self):
        self.index["valid"] = False
        missing, _, issues = setup.plan_indexes([self.spec], self.catalog)
        self.assertEqual(missing, [])
        self.assertTrue(issues)

    def test_incompatible_bm25_is_blocked_instead_of_rebuilt(self):
        self.spec.update(method="bm25", keys=["id", "content"], options={"text_fields": "{}"})
        self.index.update(method="bm25", keys=["id", "content"], options=["key_field=other"])
        missing, _, issues = setup.plan_indexes([self.spec], self.catalog)
        self.assertEqual(missing, [])
        self.assertTrue(issues)

    def run_setup(self, catalogs, apply=False, issues=None):
        connection = Mock()
        connection.execute.return_value.scalar.return_value = "on"
        with patch.object(setup, "inspect_catalog", side_effect=catalogs), \
             patch.object(setup, "index_specs", return_value=[self.spec]), \
             patch.object(setup, "schema_issues", return_value=issues or []):
            report = setup.verify_and_apply(connection, "public", apply=apply)
        return report, connection

    def test_check_only_plans_missing_index_without_ddl(self):
        self.catalog["indexes"] = []
        report, connection = self.run_setup([self.catalog])
        self.assertEqual(report["status"], "changes_needed")
        connection.exec_driver_sql.assert_not_called()

    def test_ingestion_schema_issue_blocks_apply(self):
        self.catalog["indexes"] = []
        report, connection = self.run_setup([self.catalog], apply=True,
                                            issues=["Ingestion migration required: missing table."])
        self.assertEqual(report["status"], "blocked")
        connection.exec_driver_sql.assert_not_called()

    def test_apply_creates_missing_index_and_checks_result(self):
        before = dict(self.catalog, indexes=[])
        report, connection = self.run_setup([before, self.catalog], apply=True)
        self.assertEqual(report["status"], "ready")
        connection.exec_driver_sql.assert_any_call(self.spec["sql"])
        report, connection = self.run_setup([self.catalog, self.catalog], apply=True)
        self.assertEqual(report["created"], [])
        connection.exec_driver_sql.assert_not_called()

    def test_missing_ingestion_tables_are_reported(self):
        self.catalog["tables"] = []
        issues = setup.schema_issues(self.catalog, 1024)
        self.assertEqual(len(issues), len(setup.MODELS))
        self.assertTrue(all("missing table" in issue for issue in issues))

    def test_partitioned_parent_requires_migration(self):
        self.catalog["indexes"] = []
        self.catalog["tables"][0]["kind"] = "p"
        missing, _, issues = setup.plan_indexes([self.spec], self.catalog)
        self.assertEqual(missing, [])
        self.assertIn("partitioned", issues[0])

    def test_missing_extension_is_installed_and_verified(self):
        before = dict(self.catalog, extensions=[{"name": "vector"}])
        report, connection = self.run_setup([before, self.catalog], apply=True)
        self.assertEqual(report["status"], "ready")
        connection.exec_driver_sql.assert_called_once_with("CREATE EXTENSION IF NOT EXISTS pg_search")

    def test_unavailable_extension_blocks_all_changes(self):
        self.catalog["extensions"] = [{"name": "vector"}]
        self.catalog["available_extensions"] = [{"name": "vector"}]
        report, connection = self.run_setup([self.catalog], apply=True)
        self.assertEqual(report["status"], "blocked")
        connection.exec_driver_sql.assert_not_called()

    def test_apply_does_not_report_ready_when_index_still_missing(self):
        self.catalog["indexes"] = []
        report, _ = self.run_setup([self.catalog, self.catalog], apply=True)
        self.assertEqual(report["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
