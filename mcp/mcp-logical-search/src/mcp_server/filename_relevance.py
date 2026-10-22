"""Filename normalization and text relevance from authorized document metadata."""
import re
import unicodedata


_GENERIC = {
    "pdf", "doc", "docx", "txt", "xlsx", "csv", "file", "document", "report",
    "annual", "quarterly", "policy", "policies", "handbook", "manual", "guide",
    "the", "a", "an", "of", "and", "for", "in", "on", "to", "per", "dated",
    "form", "earnings", "financial", "statements", "statement", "results",
}


def tokens(value):
    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"(?<![^\W_])(?:fy\s*|fiscal\s+year\s+)((?:19|20)\d{2})(?!\d)", r"\1", normalized)
    normalized = re.sub(r"(?<![^\W_])10[-_ ]([kq])(?![^\W_])", r"10\1", normalized)
    return re.findall(r"[^\W_]+", normalized)


def normalized_filename(name):
    return " ".join(tokens(re.sub(r"\.[a-zA-Z0-9]{1,5}$", "", name)))


def filename_search_query(query, documents):
    """Keep filename clues rather than embedding answer-writing instructions."""
    vocabulary = {term for item in documents.values() for term in tokens(normalized_filename(item["file_name"]))}
    terms = [term for term in tokens(query) if term in vocabulary and term not in _GENERIC]
    _, issuers = filename_relevance(query, documents)
    for document_id in sorted(issuers, key=str):
        issuer = re.match(r"^(.+?)[_-](?:19|20)\d{2}(?:\D|$)", documents[document_id]["file_name"])
        terms.extend(tokens(issuer.group(1)))
    # Without exact filename clues, preserve the normalized semantic question
    # so synonym-only matches can still contribute the small semantic signal.
    return " ".join(dict.fromkeys(terms)) if terms else " ".join(tokens(query))


def filename_relevance(query, documents, rrf_k=60):
    """Return tied filename rank scores and confidently matched issuer IDs.

    Issuer recognition is limited to structured issuer_YEAR filenames. Ordinary
    topic words only boost relevance; they never restrict document scope.
    No database write, extra query, filename embedding, or substring match.
    """
    query_tokens = tokens(query)
    query_terms = set(query_tokens) - _GENERIC
    overlaps = {}
    issuers = {}
    for document_id, metadata in documents.items():
        name = metadata["file_name"]
        stem = re.sub(r"\.[a-zA-Z0-9]{1,5}$", "", name)
        matched = query_terms & set(tokens(stem))
        if matched:
            overlaps[document_id] = len(matched)
        issuer = re.match(r"^(.+?)[_-](?:19|20)\d{2}(?:\D|$)", stem)
        if issuer:
            issuer_tokens = tokens(issuer.group(1))
            if issuer_tokens and not any(term in _GENERIC for term in issuer_tokens):
                issuers[document_id] = "".join(issuer_tokens)
    # Support both LOCKHEEDMARTIN and 'Lockheed Martin', with exact boundaries.
    phrases = {"".join(query_tokens[start:end])
               for start in range(len(query_tokens))
               for end in range(start + 1, min(start + 4, len(query_tokens)) + 1)}
    preferred = {document_id for document_id, issuer in issuers.items() if issuer in phrases}
    for document_id in preferred:
        overlaps[document_id] = max(overlaps.get(document_id, 0), 1)
    levels = sorted(set(overlaps.values()), reverse=True)
    ranks = {value: rank for rank, value in enumerate(levels, 1)}
    scores = {document_id: (rrf_k + 1) / (rrf_k + ranks[count])
              for document_id, count in overlaps.items()}
    return scores, preferred
