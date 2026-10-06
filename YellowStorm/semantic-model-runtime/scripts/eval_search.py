"""Measure how accurately and completely the search tools answer, on a model's real data.

Self-checking: every question is built from the stored records, and its expected
answer is computed directly in SQL from the same rows, never from the search
itself. Read-only: it calls the search routes in-process (no job is admitted)
and only reads the database.

Checks, per concept (a sample of records each):
  find_by_name     find_records(record name)              -> the record is ranked first
  find_with_typo   find_records(name with one letter off) -> the record is in the top 5
  find_by_words    find_records(6 words from a long text) -> the record is in the top 5
  links            get_related_records(record, one step)  -> exactly its stored linked records,
                                                             and linkCounts = the stored count
  linked_to        query_records(linked concept, linked_to record) -> total = stored count
  count_by_value   query_records(field eq a stored value)  -> total = stored count
  did_you_mean     query_records(field eq a misspelled value) -> nothing, and didYouMean has the value

  conda run -n meta python scripts/eval_search.py <model-id> [production|draft] [--sample N] [--json out.json]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.graph_search_routes import router as search_router  # noqa: E402
from app.graph_search.traversal import init_age_connection  # noqa: E402
from app.graph_search.typed_values import fold  # noqa: E402
from app.persistence import population_store as store  # noqa: E402

AGE_SETTINGS = {"search_path": 'ag_catalog, "$user", public'}
ACTOR = "search-eval"


def _misspell(text: str, rng: random.Random) -> str | None:
    """One letter swapped with its neighbour, inside a word of 5 letters or more."""
    words = [match for match in re.finditer(r"[^\W\d_]{5,}", text)]
    if not words:
        return None
    word = rng.choice(words)
    at = rng.randrange(word.start() + 1, word.end() - 2)
    return text[:at] + text[at + 1] + text[at] + text[at + 2:]


def _words(text: str) -> list[str]:
    return re.findall(r"[^\W_]{3,}", text)


def _plain(word: str) -> bool:
    """A word a person would type: letters only, not a token, an id or a piece of a link."""
    return word.isalpha() and len(word) <= 20


def _window(text: str, rng: random.Random, unique_in: list[str], size: int = 6) -> str | None:
    """Six plain words in a row, past the first third of the text, found in no other record
    (a disclaimer or a quoted header shared by many e-mails has no single right answer)."""
    words = _words(text)
    if len(words) < size * 3:
        return None
    starts = list(range(len(words) // 3, len(words) - size))
    rng.shuffle(starts)
    for start in starts[:40]:
        window = words[start:start + size]
        if not all(_plain(word) for word in window):
            continue
        phrase = fold(" ".join(window))
        if sum(phrase in other for other in unique_in) == 1:
            return " ".join(window)
    return None


class Eval:
    def __init__(self, client: httpx.AsyncClient, model_id: str, environment: str) -> None:
        self.client, self.model_id, self.environment = client, model_id, environment
        self.results: dict[str, list[dict[str, Any]]] = defaultdict(list)

    def record(self, check: str, ok: bool, **detail: Any) -> None:
        self.results[check].append({"ok": ok, **detail})

    async def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = await self.client.post(f"/v1/semantic-model-search/{path}", json={
            "actorUserId": ACTOR, "modelId": self.model_id, "environment": self.environment, **body})
        response.raise_for_status()
        return response.json()

    async def find(self, query: str, concept_key: str) -> list[str]:
        found = await self.post("query", {"query": query, "concepts": [concept_key], "limit": 5})
        return [seed["entityId"] for seed in found.get("seeds", [])]

    def summary(self) -> dict[str, dict[str, Any]]:
        return {check: {"passed": sum(item["ok"] for item in items), "total": len(items),
                        "rate": round(sum(item["ok"] for item in items) / len(items), 3) if items else None,
                        "failures": [item for item in items if not item["ok"]][:10]}
                for check, items in self.results.items()}


async def run(model_id: str, environment: str, sample: int, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    pool = await asyncpg.create_pool(os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=4)
    age = await asyncpg.create_pool(os.environ["SEMANTIC_AGEGRAPH_DATABASE_URL"], min_size=1, max_size=2,
                                    server_settings=AGE_SETTINGS, init=init_age_connection)
    app = FastAPI()
    app.include_router(search_router)
    app.state.population_pool, app.state.age_pool = pool, age  # no job service: nothing is admitted
    try:
        binding = await store.get_active_binding(pool, model_id, environment)
        if binding is None:
            raise SystemExit(f"model {model_id} has no {environment} data")
        revision = binding["data_revision_id"]
        rows = await pool.fetch(
            "SELECT id, concept_id, label, identity_key, attributes FROM semantic_population.entities "
            "WHERE data_revision_id = $1", revision)
        links = await pool.fetch(
            "SELECT relation_id, source_entity_id, target_entity_id FROM semantic_population.relationships "
            "WHERE data_revision_id = $1 AND state = 'accepted'", revision)
        from app.population.compiler import compile_specification
        compiled = compile_specification(await store.get_revision_specification(pool, revision))
        concepts = compiled["concepts"]
        relations = compiled["relations"]
        by_concept: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            attributes = row["attributes"]
            attributes = json.loads(attributes) if isinstance(attributes, str) else dict(attributes or {})
            by_concept[row["concept_id"]].append({"id": row["id"], "label": row["label"] or "", "values": attributes})
        linked: dict[tuple[str, str, str], set[str]] = defaultdict(set)  # (record, relation, direction) -> ids
        for link in links:
            linked[(link["source_entity_id"], link["relation_id"], "outgoing")].add(link["target_entity_id"])
            linked[(link["target_entity_id"], link["relation_id"], "incoming")].add(link["source_entity_id"])
        concept_of = {row["id"]: row["concept_id"] for row in rows}

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime",
                                     timeout=60) as client:
            ev = Eval(client, model_id, environment)
            for concept_id, records in by_concept.items():
                key = concepts.get(concept_id, {}).get("key") or concept_id
                picked = rng.sample(records, min(sample, len(records)))
                names = defaultdict(list)
                for record in records:
                    names[fold(record["label"])].append(record["id"])
                record_concept = concept_id
                # Every record's long texts as plain folded words, to keep only phrases one record holds.
                corpus = [fold(" ".join(_words(" ".join(value for value in other["values"].values()
                                                         if isinstance(value, str)))))
                          for other in records]
                for record in picked:
                    label = record["label"]
                    # A name several records share cannot pick one record: not a fair question.
                    if label and len(names[fold(label)]) == 1:
                        top = await ev.find(label, key)
                        ev.record("find_by_name", bool(top) and top[0] == record["id"], concept=key, query=label,
                                  got=top[:3], want=record["id"])
                        typo = _misspell(label, rng)
                        if typo:
                            top = await ev.find(typo, key)
                            ev.record("find_with_typo", record["id"] in top, concept=key, query=typo, want=record["id"])
                    texts = [value for value in record["values"].values() if isinstance(value, str) and len(value) > 400]
                    if texts:
                        words = _window(max(texts, key=len), rng, corpus)
                        if words:
                            top = await ev.find(words, key)
                            ev.record("find_by_words", record["id"] in top, concept=key, query=words, want=record["id"])
                    # One step along every relationship: exactly the stored links, and the exact counts.
                    expected = {other for (source, _, _), others in linked.items() if source == record["id"]
                                for other in others}
                    if expected:
                        walked = await ev.post("expand", {"seedEntityIds": [record["id"]], "maxNodes": 100,
                                                          "steps": [{"direction": "both"}]})
                        got = {node["entityId"] for node in walked["nodes"] if node["inclusionReason"] == "relationship"}
                        counted = sum(count["count"] for count in walked.get("linkCounts", []))
                        stored = sum(len(others) for (source, _, _), others in linked.items() if source == record["id"])
                        ev.record("links", got == expected and counted == stored, concept=key, record=record["id"],
                                  missing=sorted(expected - got)[:5], extra=sorted(got - expected)[:5],
                                  linkCounts=counted, stored=stored)
                    # The linked records of one relationship, through query_records(linked_to).
                    for (source, relation_id, direction), others in linked.items():
                        if source != record["id"]:
                            continue
                        other_concept = concept_of.get(next(iter(others)))
                        if other_concept == record_concept:
                            continue  # a link between records of one concept reads the same both ways: ambiguous
                        other_key = concepts.get(other_concept, {}).get("key") or other_concept
                        relation_key = relations.get(relation_id, {}).get("key") or relation_id
                        # From the other side the link reads backwards: name it by key, let the runtime orient it.
                        answer = await ev.post("records-query", {
                            "concept": other_key, "limit": 0,
                            "linkedTo": [{"relation": relation_key, "recordIds": [record["id"]]}]})
                        ev.record("linked_to", answer.get("total") == len(others), concept=other_key,
                                  relation=relation_key, record=record["id"], got=answer.get("total"),
                                  want=len(others), status=answer.get("status"))
                # Counts by value, and a misspelled value: low-cardinality text fields only.
                fields = defaultdict(lambda: defaultdict(int))
                for record in records:
                    for field, value in record["values"].items():
                        if isinstance(value, str) and 0 < len(value) <= 60:
                            fields[field][value] += 1
                for field, counts in fields.items():
                    if not 1 < len(counts) <= 30:
                        continue
                    value = rng.choice(sorted(counts))
                    want = sum(n for stored, n in counts.items() if fold(stored) == fold(value))
                    answer = await ev.post("records-query", {"concept": key, "limit": 0, "filters": [
                        {"field": field, "op": "eq", "value": value}]})
                    ev.record("count_by_value", answer.get("total") == want, concept=key, field=field, value=value,
                              got=answer.get("total"), want=want)
                    typo = _misspell(value, rng)
                    if typo and fold(typo) not in {fold(stored) for stored in counts}:
                        answer = await ev.post("records-query", {"concept": key, "limit": 0, "filters": [
                            {"field": field, "op": "eq", "value": typo}]})
                        suggested = [item for check in (answer.get("diagnostics") or {}).get("checks", [])
                                     for item in check.get("didYouMean", [])]
                        ev.record("did_you_mean", answer.get("total") == 0 and value in suggested, concept=key,
                                  field=field, query=typo, want=value, got=suggested[:5])
            return {"modelId": model_id, "environment": environment, "dataRevisionId": revision,
                    "graph": binding["projection_ref"], "records": len(rows), "links": len(links),
                    "checks": ev.summary()}
    finally:
        await pool.close()
        await age.close()


def main() -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("model_id")
    parser.add_argument("environment", nargs="?", default="production", choices=("production", "draft"))
    parser.add_argument("--sample", type=int, default=20, help="records per concept (default 20)")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--json", help="write the full report there")
    args = parser.parse_args()
    report = asyncio.run(run(args.model_id, args.environment, args.sample, args.seed))
    print(f"{report['modelId']} ({report['environment']}, {report['records']} records, {report['links']} links, "
          f"graph {report['graph']})")
    for check, result in report["checks"].items():
        print(f"  {check:<15} {result['passed']:>4}/{result['total']:<4} {result['rate']}")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
