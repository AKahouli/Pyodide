"""Structural context traversal and bounded, lossless context delivery."""

import hashlib
import json
from collections import defaultdict

from sqlalchemy import text

from src.mcp_server.evidence import serialized_bytes



def load_hierarchy(session, document_id):
    # Import lazily because db_helpers delegates expansion to this module.
    from src.mcp_server.db_helpers import _logical_sections_columns, _normalize_section_ref_list

    columns = _logical_sections_columns(session)
    names = ['id', 'section_id', 'title', 'page_number']
    names += [name for name in ('parent_section_id', 'parent_sec_id', 'ancestors',
              'descendants', 'decendants', 'position', 'level', 'previous_section_id',
              'previous_sec_id', 'next_section_id', 'next_sec_id') if name in columns]
    selected = ', '.join('"' + name + '"' for name in names)
    rows = [dict(row) for row in session.execute(
        text(f'SELECT {selected} FROM logical_sections WHERE document_id = :doc_id ORDER BY id'),
        {'doc_id': document_id},
    ).mappings().all()]
    for row in rows:
        row['ancestors'] = _normalize_section_ref_list(row.get('ancestors'))
        row['descendants'] = _normalize_section_ref_list(row.get('descendants', row.get('decendants')))
        for canonical, legacy in (('parent_section_id', 'parent_sec_id'),
                                  ('previous_section_id', 'previous_sec_id'),
                                  ('next_section_id', 'next_sec_id')):
            row[canonical] = row.get(canonical, row.get(legacy))
    return Hierarchy(rows)


class Hierarchy:
    """Document-local references; never resolve a relationship across documents."""

    def __init__(self, rows):
        self.rows = {str(row['id']): row for row in rows}
        self.external = {str(row['section_id']): str(row['id']) for row in rows}
        self.children = defaultdict(set)
        self.parents = {}
        self.problems = defaultdict(set)
        for sid, row in self.rows.items():
            parent_ref = row.get('parent_section_id')
            if parent_ref is None and row.get('ancestors'):
                parent_ref = row['ancestors'][-1]
            if parent_ref is not None:
                parent = self.resolve(parent_ref)
                if parent == sid:
                    self.problems[sid].add('self_parent')
                elif parent is None:
                    self.problems[sid].add('missing_parent:' + str(parent_ref))
                else:
                    self.parents[sid] = parent
                    self.children[parent].add(sid)
            for ref in row.get('descendants', []):
                child = self.resolve(ref)
                if child is None:
                    self.problems[sid].add('missing_child:' + str(ref))
                elif child == sid:
                    self.problems[sid].add('self_child')
                else:
                    self.children[sid].add(child)
        # Ancestor arrays can restore reachability when parent links are absent.
        for sid, row in self.rows.items():
            for ref in row.get('ancestors', []):
                ancestor = self.resolve(ref)
                if ancestor is None:
                    self.problems[sid].add('missing_ancestor:' + str(ref))
                elif ancestor != sid:
                    self.children[ancestor].add(sid)

    def resolve(self, ref):
        value = str(ref)
        return value if value in self.rows else self.external.get(value)

    def brief(self, sid):
        row = self.rows[sid]
        return {'section_id': row['id'], 'title': row.get('title')}

    def direct_child_ids(self, sid):
        """Prefer parent links; reduce legacy descendant lists to immediate edges."""
        candidates = self.children[sid] - {sid}
        direct = []
        for child in candidates:
            if child in self.parents:
                if self.parents[child] == sid:
                    direct.append(child)
            elif not any(child in self.children[other] for other in candidates if other != child):
                direct.append(child)
        return sorted(direct, key=lambda k: (self.rows[k].get('page_number') or 0, self.rows[k]['id']))

    def ancestor_ids(self, sid):
        path, seen = [], {sid}
        parent = self.parents.get(sid)
        while parent is not None:
            if parent in seen:
                self.problems[sid].add('parent_cycle')
                break
            seen.add(parent)
            path.append(parent)
            parent = self.parents.get(parent)
        path.reverse()
        # Include stored ancestors even if a partial parent chain is available.
        stored = [self.resolve(ref) for ref in self.rows[sid].get('ancestors', [])]
        return list(dict.fromkeys(p for p in [*stored, *path] if p and p != sid))

    def descendant_ids(self, sid):
        """Return every reachable descendant once, excluding ancestors and cycles."""
        seen = {sid, *self.ancestor_ids(sid)}
        selected = set()
        pending = list(self.children[sid])
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            selected.add(current)
            pending.extend(self.children[current])
        return sorted(selected, key=lambda k: (self.rows[k].get('page_number') or 0, self.rows[k]['id']))

    def select(self, sid):
        ancestors = self.ancestor_ids(sid)
        # Stable source order uses page then ID, as block readers do. Position
        # is sibling-local and must never be used as a global ordering key.
        selected, active, pending = set(), set(), [(sid, False)]
        while pending:
            current, leaving = pending.pop()
            if leaving:
                active.discard(current)
                continue
            if current in active:
                self.problems[current].add('descendant_cycle')
                continue
            if current in selected:
                continue
            selected.add(current)
            active.add(current)
            pending.append((current, True))
            pending.extend((child, False) for child in sorted(self.children[current]))
        if selected.intersection(ancestors):
            self.problems[sid].add('hierarchy_cycle')
        selected.update(ancestors)
        ordered = sorted(selected, key=lambda k: (self.rows[k].get('page_number') or 0, self.rows[k]['id']))
        issues = [{'section_id': self.rows[k]['id'], 'reason': reason}
                  for k in ordered for reason in sorted(self.problems[k])]
        boundary = {}
        for name in ('parent_section_id', 'previous_section_id', 'next_section_id'):
            ref = self.resolve(self.rows[sid].get(name))
            boundary[name.removesuffix('_section_id')] = self.brief(ref) if ref and ref != sid else None
        return ordered, ancestors, issues, boundary


def attach_search_ancestors(session, results, include_hierarchy=True):
    """Attach requested navigation for documents already authorized by search."""
    for result in results:
        for key in ('ancestors', 'ancestor_count', 'ancestors_truncated', 'children',
                    'child_count', 'children_truncated', 'descendants', 'descendant_count', 'descendants_truncated'):
            result.pop(key, None)
    if not include_hierarchy:
        return
    cache = {}
    for result in results:
        doc_id = result.get('document_id')
        if not doc_id:
            continue
        if doc_id not in cache:
            cache[doc_id] = load_hierarchy(session, doc_id)
        hierarchy = cache[doc_id]
        sid = str(result['section_id'])
        if sid in hierarchy.rows:
            ancestors = hierarchy.ancestor_ids(sid)
            result['ancestors'] = [hierarchy.brief(p) for p in ancestors]
            result['ancestor_count'] = len(ancestors)
            result['ancestors_truncated'] = False
            descendants = hierarchy.descendant_ids(sid)
            result['descendants'] = [hierarchy.brief(p) for p in descendants]
            result['descendant_count'] = len(descendants)
            result['descendants_truncated'] = False


def combine_content(rows, payloads):
    """One source-ordered stream with exact text and explicit citation markers."""
    sections = {row['id']: row for row in rows}
    # Preserve headings with no direct blocks, too.
    parts = ['[sections ' + json.dumps(
        [{'section_id': row['id'], 'title': row.get('title')} for row in rows],
        ensure_ascii=False) + ']']
    entries = []
    for row in rows:
        payload = payloads.get(row['id'], {})
        for kind, key in (('block', 'blocks'), ('image', 'images')):
            for item in payload.get(key, []):
                page = item.get('page_number')
                if page is None:
                    page = row.get('page_number')
                identity = item['block_id'] if kind == 'block' else item['image_id']
                entries.append((page is None, page or 0, 0 if kind == 'block' else 1,
                                identity, row['id'], kind, item))
    entries.sort(key=lambda entry: entry[:4])
    current = None
    for _, page, _, identity, sid, kind, item in entries:
        if sid != current:
            parts.append('[section ' + json.dumps(
                {'section_id': sid, 'title': sections[sid].get('title')}, ensure_ascii=False) + ']')
            current = sid
        marker = {('block_id' if kind == 'block' else 'image_id'): identity, 'page_number': page}
        parts.append('[' + kind + ' ' + json.dumps(marker) + ']\n' + (item.get('content') or ''))
    return '\n\n'.join(parts)


def paginate_context(result, offset, max_bytes, version=None):
    """Character offsets preserve Unicode; a fingerprint rejects stale cursors."""
    result = dict(result)
    content = result.pop('content', '')
    fingerprint = hashlib.sha256(content.encode('utf-8')).hexdigest()[:24]
    if version and version != fingerprint:
        return {'error': 'Context changed. Restart with content_offset=0 and no context_version.'}
    if offset > len(content):
        return {'error': 'content_offset exceeds the context length'}
    result.update(content_offset=offset, content_length=len(content), context_version=fingerprint)

    def page(end):
        more = end < len(content)
        result.update(content=content[offset:end], has_more=more,
                      context_complete=not more and not result.get('hierarchy_issues'),
                      stop_reason='response_budget' if more else (
                          'unresolved_hierarchy' if result.get('hierarchy_issues') else 'subtree_boundary'))
        result.pop('required_next_tool_call', None)
        result.pop('next_content_offset', None)
        if more:
            result['next_content_offset'] = end
            result['required_next_tool_call'] = {'tool': 'expand_context', 'arguments': {
                'section_id': str(result['target_section_id']), 'workspace_id': result['workspace_id'],
                'content_offset': end, 'context_version': fingerprint}}
        return result

    # Every source character consumes at least one JSON byte. Do not serialize
    # the full remaining suffix when it cannot possibly fit on this page.
    if len(content) - offset <= max_bytes and serialized_bytes(page(len(content))) <= max_bytes:
        return result
    low, high = offset, min(len(content) - 1, offset + max_bytes)
    while low < high:
        mid = (low + high + 1) // 2
        if serialized_bytes(page(mid)) <= max_bytes:
            low = mid
        else:
            high = mid - 1
    page(low)
    if serialized_bytes(result) > max_bytes or low == offset:
        return {'error': 'Context metadata exceeds the response budget; increase SEARCH_EVIDENCE_MAX_BYTES.'}
    return result
