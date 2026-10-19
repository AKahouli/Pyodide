"""Database-owned search scope; only candidate metadata crosses into Python."""
from sqlalchemy import case, func, literal_column, select
from sqlalchemy.dialects.postgresql import array

from src.db.models import LogicalDocument
from src.mcp_server.filename_relevance import _GENERIC, tokens
from src.modules.language import FASTTEXT_TO_PG_CONFIG, get_pg_ts_config


def normalized_filename_expression(value, *, strip_extension=True):
    """Indexable PostgreSQL normalization for filename keyword discovery.

    PostgreSQL lower() is not Python's full Unicode casefold(); common sharp-s
    and final-sigma folds are explicit. Validate unusual Unicode filenames when
    migrating from the legacy scorer.
    """
    stem = func.regexp_replace(value, r"\.[a-zA-Z0-9]{1,5}$", "") if strip_extension else value
    normalized = func.replace(func.replace(
        func.lower(func.normalize(stem, literal_column("NFKC"))), "ß", "ss"), "ς", "σ")
    normalized = func.regexp_replace(normalized,
        r"(?<![[:alnum:]])(?:fy\s*|fiscal\s+year\s+)((?:19|20)\d{2})(?!\d)", r"\1", "g")
    normalized = func.regexp_replace(normalized,
        r"(?<![[:alnum:]])10[-_ ]([kq])(?![[:alnum:]])", r"10\1", "g")
    return normalized


def filename_tokens_expression(value, *, strip_extension=True):
    return func.array_remove(func.regexp_split_to_array(
        normalized_filename_expression(value, strip_extension=strip_extension), r"[^[:alnum:]]+"), "")


def filename_issuer_expression(value):
    issuer = func.substring(value, r"^(.+?)[_-](?:19|20)\d{2}(?:\D|$)")
    return func.regexp_replace(normalized_filename_expression(issuer, strip_extension=False),
        r"[^[:alnum:]]+", "", "g")


class SearchScope:
    """One request's SQL predicates and bounded metadata, never corpus state."""

    def __init__(self, query, *, user_id=None, workspace_id=None, file_name=None, document_id=None):
        from src.mcp_server.db_helpers import _apply_document_filters, _normalize_scope_values
        self.query = query
        self.workspaces = _normalize_scope_values(workspace_id)
        self.workspace_only = bool(self.workspaces) and user_id is None and file_name is None and document_id is None
        self.base = _apply_document_filters(select(LogicalDocument.id),
            user_id=user_id, workspace_id=workspace_id, file_name=file_name, document_id=document_id)
        self.terms = sorted(set(tokens(query)) - _GENERIC)
        query_tokens = tokens(query)
        phrases = sorted({"".join(query_tokens[start:end])
            for start in range(len(query_tokens))
            for end in range(start + 1, min(start + 4, len(query_tokens)) + 1)})
        self.name_tokens = filename_tokens_expression(LogicalDocument.file_name)
        issuer = func.substring(LogicalDocument.file_name, r"^(.+?)[_-](?:19|20)\d{2}(?:\D|$)")
        issuer_tokens = filename_tokens_expression(issuer, strip_extension=False)
        self.issuer_match = (issuer.is_not(None) & filename_issuer_expression(LogicalDocument.file_name).in_(phrases)
            & ~issuer_tokens.op("&&")(array(sorted(_GENERIC))))
        self.keyword_match = self.name_tokens.op("&&")(array(self.terms)) if self.terms else literal_column("false")
        word = func.unnest(self.name_tokens).table_valued("word").render_derived()
        overlap = select(func.count(func.distinct(word.c.word))).where(
            word.c.word.in_(self.terms)).scalar_subquery()
        self.overlap = func.greatest(overlap, case((self.issuer_match, 1), else_=0))
        if len(self.terms) <= 1:
            self.overlap = case((self.keyword_match | self.issuer_match, 1), else_=0)
        self.has_issuers = False
        self.configs = []
        self.single_document = False
        self.metadata = {}
        self.fallback_config = None

    def prepare(self, session):
        self.has_issuers = bool(session.execute(select(self.base.where(self.issuer_match).exists())).scalar())
        # Two rows suffice to preserve the existing single-document quota rule.
        self.single_document = len(session.execute(self.documents().limit(2)).all()) == 1
        rows = session.execute(select(LogicalDocument.fts_config).where(
            LogicalDocument.id.in_(self.documents())).distinct()).all()
        fallback = None
        for config, in rows:
            if not config:
                fallback = fallback or get_pg_ts_config(self.query)
                self.fallback_config = fallback
                config = fallback
            config = str(config).strip().lower()
            config = FASTTEXT_TO_PG_CONFIG.get(config, config)
            if config not in self.configs:
                self.configs.append(config)
        return self

    def documents(self):
        return self.base.where(self.issuer_match) if self.has_issuers else self.base

    def direct_workspace_filter(self, *, lexical=False):
        # Child workspace IDs already expose this exact scope. A lexical pass
        # can skip the language join only when all documents share one config.
        return self.workspace_only and not self.has_issuers and (not lexical or len(self.configs) == 1)

    def groups(self):
        raw_config = func.lower(func.btrim(LogicalDocument.fts_config))
        normalized = case(FASTTEXT_TO_PG_CONFIG, value=raw_config, else_=raw_config)
        groups = []
        for config in self.configs:
            predicate = normalized == config
            # NULL/empty configs use the same detected query language as legacy.
            if config == self.fallback_config:
                predicate = predicate | LogicalDocument.fts_config.is_(None) | (LogicalDocument.fts_config == "")
            groups.append((config, self.documents().where(predicate)))
        return groups

    def get(self, key, default=None):
        return self.metadata.get(key, default)

    def hydrate(self, session, ids):
        from src.mcp_server.db_helpers import get_search_document_metadata
        if ids:
            self.metadata.update(get_search_document_metadata(session,
                document_id=select(LogicalDocument.id).where(
                    LogicalDocument.id.in_(list(ids)), LogicalDocument.id.in_(self.documents()))))

    def scores(self, session, ids, rrf_k):
        matching = self.base.where(self.keyword_match | self.issuer_match)
        # One keyword (e.g. a reporting year) has only one positive rank level.
        # Do not recount millions of matching filenames to discover that fact.
        levels = [(1,)] if len(self.terms) <= 1 else session.execute(select(self.overlap).where(
            LogicalDocument.id.in_(matching)).distinct()).all()
        ranks = {count: rank for rank, count in enumerate(sorted(
            {row[0] for row in levels if row[0]}, reverse=True), 1)}
        rows = session.execute(select(LogicalDocument.id, self.overlap).where(
            LogicalDocument.id.in_(list(ids)), LogicalDocument.id.in_(self.documents()))).all()
        return {key: (rrf_k + 1) / (rrf_k + ranks[count]) for key, count in rows if count}

    def filename_candidates(self, session, limit):
        # Keep the old top-N ordering, including zero-overlap filenames. Positive
        # matches and zero matches are each bounded before their final union.
        from sqlalchemy import union_all
        positive_overlap = literal_column("1") if len(self.terms) <= 1 else self.overlap
        columns = (LogicalDocument.id, LogicalDocument.file_name, positive_overlap.label("overlap"))
        positive = select(*columns).where(LogicalDocument.id.in_(self.documents()),
            self.keyword_match | self.issuer_match).order_by(
                columns[2].desc(), LogicalDocument.file_name.collate("C"), LogicalDocument.id).limit(limit)
        zero = select(LogicalDocument.id, LogicalDocument.file_name, literal_column("0").label("overlap")).where(
            LogicalDocument.id.in_(self.documents()), ~(self.keyword_match | self.issuer_match)).order_by(
                LogicalDocument.file_name.collate("C"), LogicalDocument.id).limit(limit)
        candidates = union_all(positive, zero).subquery()
        rows = session.execute(select(candidates.c.id, candidates.c.file_name).order_by(
            candidates.c.overlap.desc(), candidates.c.file_name.collate("C"), candidates.c.id).limit(limit)).all()
        return {key: {"file_name": name} for key, name in rows}
