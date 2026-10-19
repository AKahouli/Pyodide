import asyncio
import unittest
from unittest.mock import patch

from src.mcp_server.context_navigation import Hierarchy, combine_content, paginate_context, attach_search_ancestors
from src.mcp_server.evidence import serialized_bytes
import src.mcp_server.logical_indexing_server as server


def node(sid, parent=None, children=(), ancestors=(), page=1, position=1):
    return dict(id=sid, section_id='sec_' + str(sid), title=str(sid),
                parent_section_id=str(parent) if parent is not None else None,
                descendants=[str(c) for c in children], ancestors=[str(a) for a in ancestors],
                page_number=page, position=position)


class ContextNavigationTests(unittest.TestCase):
    def hierarchy(self):
        # Asset Detail: four children, with a nested Stubs instruction in child 3.
        return Hierarchy([node(1, children=[2, 9]), node(2, 1, [3, 4, 5, 7], [1]),
                          node(3, 2, ancestors=[1, 2]), node(4, 2, ancestors=[1, 2]),
                          node(5, 2, [6], [1, 2]), node(6, 5, ancestors=[1, 2, 5]),
                          node(7, 2, ancestors=[1, 2]), node(9, 1, ancestors=[1])])

    def test_all_children_and_grandchildren_but_no_unrelated_sibling(self):
        ordered, ancestors, issues, _ = self.hierarchy().select('2')
        self.assertEqual(ordered, ['1', '2', '3', '4', '5', '6', '7'])
        self.assertEqual(ancestors, ['1'])
        self.assertEqual(issues, [])

    def test_leaf_does_not_automatically_expand_parent_subtree(self):
        self.assertEqual(self.hierarchy().select('4')[0], ['1', '2', '4'])

    def test_direct_children_exclude_grandchildren_and_support_legacy_refs(self):
        self.assertEqual(self.hierarchy().direct_child_ids('2'), ['3', '4', '5', '7'])
        self.assertEqual(self.hierarchy().direct_child_ids('6'), [])
        root, child, grandchild = node(1, children=[2, 3]), node(2, children=[3]), node(3)
        root['descendants'] = ['sec_2', 'sec_3']
        self.assertEqual(Hierarchy([root, child, grandchild]).direct_child_ids('1'), ['2'])
        child['ancestors'] = ['sec_1']
        grandchild['ancestors'] = ['sec_1', 'sec_2']
        self.assertEqual(Hierarchy([root, child, grandchild]).direct_child_ids('1'), ['2'])

    def test_descendant_budget_preserves_count_and_evidence(self):
        hierarchy = Hierarchy([node(1)] + [node(i, 1) for i in range(2, 17)])
        results = [{'document_id': 'd', 'section_id': 1, 'matched_block':
                    {'block_id': 90, 'content': 'Important evidence'}}]
        with patch('src.mcp_server.context_navigation.load_hierarchy', return_value=hierarchy):
            attach_search_ancestors(object(), results)
        self.assertEqual(results[0]['descendant_count'], 15)
        self.assertEqual(len(results[0]['descendants']), 15)
        self.assertFalse(results[0]['descendants_truncated'])
        legacy = server._compact_search_results(results, 5, 'ws')[0]
        self.assertEqual(legacy['descendants'], results[0]['descendants'])
        response = server._search_evidence_response(results, '', max_bytes=500)
        section = response['documents'][0]['sections'][0]
        self.assertEqual(section['descendant_count'], 15)
        self.assertTrue(section['descendants_truncated'])
        self.assertLess(len(section['descendants']), 15)
        self.assertEqual(section['blocks'][0]['content'], 'Important evidence')
        self.assertLessEqual(serialized_bytes(response), 500)
        self.assertEqual(len(results[0]['descendants']), 15)

    def test_self_parent_and_missing_child_are_reported_without_looping(self):
        h = Hierarchy([node(1, 1, [999])])
        ordered, _, issues, _ = h.select('1')
        self.assertEqual(ordered, ['1'])
        self.assertEqual({i['reason'] for i in issues}, {'self_parent', 'missing_child:999'})

    def test_parent_cycle_is_reported_without_looping(self):
        h = Hierarchy([node(1, 2), node(2, 1)])
        self.assertTrue(h.select('1')[2])

    def test_descendant_only_cycle_is_reported(self):
        h = Hierarchy([node(1, children=[2]), node(2, children=[1])])
        self.assertIn('descendant_cycle', {issue['reason'] for issue in h.select('1')[2]})

    def test_interleaved_parent_blocks_preserve_page_and_block_order(self):
        rows = [node(1), node(2, 1)]
        payloads = {1: {'blocks': [
            {'block_id': 10, 'page_number': 1, 'content': 'before'},
            {'block_id': 30, 'page_number': 3, 'content': 'after'}]},
            2: {'blocks': [{'block_id': 20, 'page_number': 2, 'content': 'middle'}]}}
        content = combine_content(rows, payloads)
        self.assertLess(content.index('before'), content.index('middle'))
        self.assertLess(content.index('middle'), content.index('after'))

    def test_tool_schema_exposes_continuation_without_adding_another_tool(self):
        properties = server.expand_context.parameters['properties']
        self.assertEqual(properties['content_offset']['minimum'], 0)
        self.assertIn('context_version', properties)
        tools = asyncio.run(server.mcp.get_tools())
        self.assertNotIn('read_context', tools)

    def test_legacy_external_refs_and_sibling_local_positions(self):
        root, child = node(1, position=9), node(2, position=1)
        root['descendants'] = ['sec_2']
        child['ancestors'] = ['sec_1']
        self.assertEqual(Hierarchy([root, child]).select('1')[0], ['1', '2'])

    def test_single_content_preserves_exact_text_and_citation_ids(self):
        h = self.hierarchy()
        rows = [h.rows[s] for s in h.select('2')[0]]
        content = combine_content(rows, {2: {'blocks': [{'block_id': 20, 'content': 'Exact \"text\" é', 'page_number': 1}]},
                                        6: {'blocks': [{'block_id': 60, 'content': 'Stubs instruction', 'page_number': 2}]}})
        self.assertIn('Exact "text" é', content)
        self.assertIn('"block_id": 60', content)
        self.assertIn('Stubs instruction', content)
        self.assertNotIn('"section_id": 9', content)

    def test_unicode_continuations_reconstruct_entire_context_within_budget(self):
        original = {'target_section_id': 2, 'workspace_id': 'ws', 'content': 'é\\"\n例' * 3000,
                    'hierarchy_issues': [], 'boundary': {}}
        offset, version, parts = 0, None, []
        while True:
            result = paginate_context(original, offset, 1500, version)
            self.assertLessEqual(serialized_bytes(result), 1500)
            parts.append(result['content'])
            if not result['has_more']:
                self.assertTrue(result['context_complete'])
                break
            self.assertFalse(result['context_complete'])
            self.assertEqual(result['stop_reason'], 'response_budget')
            self.assertGreater(result['next_content_offset'], offset)
            offset, version = result['next_content_offset'], result['context_version']
        self.assertEqual(''.join(parts), original['content'])
        self.assertIn('error', paginate_context({**original, 'content': 'changed'}, 1, 1500, version))

    def test_search_path_reuses_document_load_and_survives_output_shaping(self):
        results = [{'document_id': 'd', 'section_id': sid, 'section_title': str(sid)} for sid in (5, 6)]
        with patch('src.mcp_server.context_navigation.load_hierarchy', return_value=self.hierarchy()) as load:
            attach_search_ancestors(object(), results)
        load.assert_called_once_with(unittest.mock.ANY, 'd')
        self.assertEqual([r['section_id'] for r in results[1]['ancestors']], [1, 2, 5])
        response = server._search_evidence_response(results, '')
        self.assertEqual(response['documents'][0]['sections'][1]['ancestors'], results[1]['ancestors'])
        sections = response['documents'][0]['sections']
        self.assertEqual(sections[0]['descendants'], [{'section_id': 6, 'title': '6'}])
        self.assertEqual(sections[1]['descendants'], [])
        self.assertEqual(sections[1]['descendant_count'], 0)
        self.assertFalse(sections[1]['descendants_truncated'])

    def test_tool_batch_has_one_content_field_and_separate_continuations(self):
        async def run(operation, deadline):
            return operation(object())
        def expand(session, sid, doc_ids, *, batch_cache):
            return {'target_section_id': int(sid), 'workspace_id': 'ws', 'content': sid * 5000}
        with patch.object(server, '_require_search_scope'), patch.object(server, '_run_reader_db', side_effect=run), \
             patch.object(server, '_resolve_document_id', return_value=['d']), \
             patch.object(server, 'expand_section_context', side_effect=expand), \
             patch.object(server.settings, 'SEARCH_EVIDENCE_MAX_BYTES', 4000):
            result = asyncio.run(server.expand_context.fn.__wrapped__(section_id=['2', '3'], workspace_id='ws'))
        self.assertLessEqual(serialized_bytes(result), 4000)
        self.assertIsInstance(result['content'], str)
        self.assertTrue(all('content' not in context for context in result['contexts']))
        self.assertEqual([c['required_next_tool_call']['arguments']['section_id'] for c in result['contexts']], ['2', '3'])

    def test_tool_rejects_invalid_continuations_and_unauthorized_scope(self):
        for kwargs in ({'content_offset': -1}, {'content_offset': 1},
                       {'section_id': ['1', '2'], 'content_offset': 1, 'context_version': 'v'}):
            with patch.object(server, '_run_reader_db') as run:
                result = asyncio.run(server.expand_context.fn.__wrapped__(**{'section_id': '1', 'workspace_id': 'ws', **kwargs}))
                self.assertIn('error', result)
                run.assert_not_called()
        with patch.object(server, '_get_effective_workspace_ids', return_value=['allowed']), \
             patch.object(server, '_run_reader_db') as run:
            with self.assertRaises(server.AuthorizationScopeError):
                asyncio.run(server.expand_context.fn.__wrapped__(section_id='1', workspace_id='outside'))
            run.assert_not_called()
