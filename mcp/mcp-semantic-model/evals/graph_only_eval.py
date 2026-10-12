"""Graph-only evaluation of mail_model through the mcp-semantic-model server.

Every answer is built from graph exploration (get_related_records, traverse_records, connect_records,
query_records with linked_to / filters). find_records is used for one thing only: to resolve the
record a question names (a dossier reference or a person) and it must put that record FIRST, so no
ranking, vector or text-search judgement is needed to get the answer. The script fails if a
check does not hold, or if any tool outside the allowed set is called.

    SEMANTIC_MODEL_MCP_INGRESS_TOKEN=... python graph_only_eval.py --user <user id> [--url http://localhost:8027/mcp]

The token is read from the environment, or from ../.env when absent. It is never printed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

MODEL = "61ce5cd7-68e6-4ade-a5e8-cf42e3d108a8"
GRAPH_TOOLS = {"get_related_records", "traverse_records", "connect_records", "query_records", "describe_model"}
ENTRY_TOOL = "find_records"
DOSSIER = re.compile(r"\[(AV-2026-\d+)\]")


def token() -> str:
    if os.environ.get("SEMANTIC_MODEL_MCP_INGRESS_TOKEN"):
        return os.environ["SEMANTIC_MODEL_MCP_INGRESS_TOKEN"]
    for line in (Path(__file__).parent.parent / ".env").read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("SEMANTIC_MODEL_MCP_INGRESS_TOKEN="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("SEMANTIC_MODEL_MCP_INGRESS_TOKEN is not configured")


class Run:
    def __init__(self, session: ClientSession) -> None:
        self.session = session
        self.calls: list[str] = []
        self.results: list[tuple[str, bool, str]] = []

    async def tool(self, name: str, **args):  # type: ignore[no-untyped-def]
        self.calls.append(name)
        res = await self.session.call_tool(name, {"model_id": MODEL, **args})
        body = json.loads("".join(getattr(part, "text", "") for part in res.content))
        assert body.get("ok"), f"{name} failed: {body.get('error')}"
        return body["data"]

    async def resolve(self, query: str, concept: str, starts: str) -> str:
        """The record a question names: find_records must return it first."""
        data = await self.tool(ENTRY_TOOL, query=query, concepts=[concept], limit=5)
        top = data["records"][0]
        assert top["name"].startswith(starts), f"rank 1 for {query!r} is {top['name']!r}, wanted {starts!r}"
        return top["entityId"]

    def check(self, case: str, ok: bool, detail: str) -> None:
        self.results.append((case, bool(ok), detail))
        report(("PASS " if ok else "FAIL ") + case + "  " + detail)


def report(line: str) -> None:
    sys.stdout.write(line + chr(10))
    sys.stdout.flush()


def opener_prefix(number: str) -> str:
    return f"[AV-2026-{number}]"


async def opener(run: Run, number: str) -> str:
    return await run.resolve(f"AV-2026-{number} Etape 01 Position et preuves", "Message e-mail", opener_prefix(number))


def names(data, concept: str) -> list[str]:  # type: ignore[no-untyped-def]
    return sorted(r["name"] for r in data["records"] if r["concept"] == concept)


async def main(url: str, user: str) -> int:
    headers = {"Authorization": "Bearer " + token(), "X-YellowStorm-User-Id": user}
    async with streamablehttp_client(url, headers=headers) as (r, w, _):
        async with ClientSession(r, w) as session:
            await session.initialize()
            run = Run(session)
            await cases(run)
    unexpected = sorted(set(run.calls) - GRAPH_TOOLS - {ENTRY_TOOL})
    run.check("only-graph-tools", not unexpected, f"tools used: {sorted(set(run.calls))}")
    failed = [c for c, ok, _ in run.results if not ok]
    report(f"\n{len(run.results) - len(failed)}/{len(run.results)} checks passed; find_records calls "
           f"{run.calls.count(ENTRY_TOOL)} (entry resolution), graph calls {len(run.calls) - run.calls.count(ENTRY_TOOL)}")
    return 1 if failed else 0


async def cases(run: Run) -> None:
    m0135 = await opener(run, "0135")
    run.check("MG-01 reference ranks first", True, "AV-2026-0135 opening mail is rank 1")

    # A reference alone: every record returned carries it (the order among them is the thread's).
    data = await run.tool(ENTRY_TOOL, query="AV-2026-0135", concepts=["Message e-mail"], limit=5)
    run.check("MG-01b reference alone", all("[AV-2026-0135]" in x["name"] for x in data["records"]), "5 of 5 carry it")

    d = await run.tool("get_related_records", record_ids=[m0135], relations=["a pour participant"],
                       then_relations=["désigne"], concepts=["Correspondant"])
    run.check("MG-02 participants", names(d, "Correspondant") == ["Karim Benali", "Nora Dupont", "Theo Dubois"], str(names(d, "Correspondant")))

    d = await run.tool("get_related_records", record_ids=[m0135])
    counts = {(c["concept"]): c["count"] for c in d["linkCounts"]}
    run.check("MG-03 links", counts == {"Pièce jointe": 1, "Fait": 1, "Participation": 3}, str(counts))

    d = await run.tool("query_records", concept="Pièce jointe", linked_to=[{"relation": "contient", "record_ids": [m0135]}],
                       fields=["nom_fichier", "taille"])
    v = d["records"][0]["values"]
    run.check("MG-04 attachment", d["total"] == 1 and v["nom_fichier"] == "AV-2026-0135-PJ-01.pdf" and str(v["taille"]) == "51590", str(v))

    d = await run.tool("query_records", concept="Message e-mail", filters=[{"field": "corps", "op": "contains", "value": "pénalit"}], limit=0)
    run.check("MG-05 penalties in bodies", d["total"] == 300, str(d["total"]))

    d = await run.tool("query_records", concept="Message e-mail", group_by=["domaine_expediteur"], aggregates=["count"], limit=20)
    sizes = sorted((g["count"] for g in d["groups"]), reverse=True)
    run.check("MG-06 per domain", sizes == [8500, 4000, 2500, 2000, 2000, 1500, 1500, 1500, 1500], str(sizes))

    d = await run.tool("query_records", concept="Message e-mail", group_by=[{"field": "date_reception", "bucket": "month"}], aggregates=["count"], limit=20)
    run.check("MG-07 per month", [g["count"] for g in d["groups"]] == [4793, 4857, 4485, 3888, 3720, 3257], str([g["count"] for g in d["groups"]]))

    d = await run.tool("query_records", concept="Fait", filters=[{"field": "statut", "op": "eq", "value": "contesté"}],
                       group_by=["type_fait"], aggregates=["count"], limit=20)
    run.check("MG-09 contested facts", d["total"] == 37 or sum(g["count"] for g in d["groups"]) == 37, str(sorted(g["count"] for g in d["groups"])))

    d = await run.tool("traverse_records", start={"concept": "Fait", "filters": [{"field": "statut", "op": "eq", "value": "contesté"},
                       {"field": "description", "op": "contains", "value": "EUR"}]}, steps=["est énoncé dans"], fields=["objet"], limit=20)
    got = sorted(DOSSIER.search(x["name"]).group(1) for x in d["records"])
    run.check("MG-10 contested amounts to mails", got == ["AV-2026-0061", "AV-2026-0145", "AV-2026-0175", "AV-2026-0191"], str(got))

    d = await run.tool("query_records", concept="Fait", filters=[{"field": "description", "op": "contains", "value": "pénalit"}], fields=["description"], limit=20)
    run.check("MG-11 penalty facts", d["total"] == 3, str([x["name"][:40] for x in d["records"]]))

    d = await run.tool("traverse_records", start={"concept": "Fait", "filters": [{"field": "description", "op": "contains", "value": "réserve la garantie"}]},
                       steps=["est énoncé dans"], fields=["objet"], limit=20)
    got = sorted(DOSSIER.search(x["name"]).group(1) for x in d["records"])
    want = sorted(f"AV-2026-{n}" for n in ("0056", "0217", "0039", "0244", "0159", "0027", "0115", "0203"))
    run.check("MG-12 guarantee reserves", got == want, str(got))

    karim = await run.resolve("Karim Benali", "Correspondant", "Karim Benali")
    theo = await run.resolve("Theo Dubois", "Correspondant", "Theo Dubois")
    nora = await run.resolve("Nora Dupont", "Correspondant", "Nora Dupont")

    d = await run.tool("traverse_records", start={"concept": "Correspondant", "record_ids": [karim]},
                       steps=["a participé via", "participe à"], fields=["objet"], limit=20)
    got = sorted(DOSSIER.search(x["name"]).group(1) for x in d["records"])
    run.check("MG-13 Karim's dossiers", got == ["AV-2026-0001", "AV-2026-0135", "AV-2026-0267"], str(got))

    d = await run.tool("traverse_records", start={"concept": "Correspondant", "record_ids": [karim]},
                       steps=["a participé via", "participe à", "a pour participant", "désigne"], fields=["nom_affiche"], limit=30)
    want = ["Amel Caron", "Emma Petit", "Lina Chevalier", "Maxime Vidal", "Nadia Caron", "Nora Dupont", "Theo Dubois"]
    run.check("MG-14 co-participants", sorted(x["name"] for x in d["records"]) == want and karim not in [x["entityId"] for x in d["records"]], str(len(d["records"])))

    d = await run.tool("connect_records", from_record_id=theo, to_record_id=karim, max_links=4, max_paths=5)
    steps = d["paths"][0]["steps"] if d["paths"] else []
    run.check("MG-15 Theo to Karim", d["status"] == "connected" and len(steps) == 4 and steps[2]["from"] == m0135, f"{d['status']} {len(steps)} links via opening mail")

    d = await run.tool("connect_records", from_record_id=karim, to_record_id=nora, max_links=6, max_paths=10)
    run.check("MG-16 Karim to Nora", d["status"] == "connected" and len(d["paths"]) >= 1 and len(d["paths"][0]["steps"]) == 4, f"{len(d['paths'])} path(s)")

    d = await run.tool("query_records", concept="Message e-mail", filters=[{"field": "objet", "op": "starts_with", "value": "[AV-2026-0135]"}],
                       order_by=[{"field": "date_reception", "direction": "asc"}], fields=["date_reception", "nom_expediteur"], limit=10)
    senders = [x["values"]["nom_expediteur"] for x in d["records"]]
    run.check("MG-17 thread order", senders[:4] == ["Theo Dubois", "Amel Caron", "Maxime Vidal", "Inaya Martin"] and d["total"] == 83, f"total {d['total']}")

    d = await run.tool("traverse_records", start={"concept": "Message e-mail", "filters": [{"field": "objet", "op": "contains", "value": "Etape 01 - Position et preuves"}]},
                       steps=["contient"], group_by=[{"field": "domaine_expediteur", "step": 0}], limit=20)
    groups = sorted((g["count"] for g in d["groups"]), reverse=True)
    run.check("MG-18 attachments per domain", d["total"] == 300 and groups[:4] == [102, 48, 30, 24], str(groups))

    mails = {}
    for amount, dossier in (("22400 EUR", "AV-2026-0061"), ("27800 EUR", "AV-2026-0191")):
        d = await run.tool("traverse_records", start={"concept": "Fait", "filters": [{"field": "statut", "op": "eq", "value": "contesté"},
                           {"field": "description", "op": "contains", "value": amount}]}, steps=["est énoncé dans"], fields=["objet"], limit=5)
        found = [x for x in d["records"] if dossier in x["name"]]
        mails[dossier] = found[0]["entityId"] if found else None
        run.check(f"MG-19a {dossier}", bool(found), f"contested fact of {amount} stated in a mail of the dossier")
    d = await run.tool("connect_records", from_record_id=mails["AV-2026-0061"], to_record_id=mails["AV-2026-0191"], max_links=6, max_paths=5)
    run.check("MG-19b not connected", d["status"] == "not_connected" and d["completeness"]["complete"], d["status"])

    guarantee = await run.tool("traverse_records", start={"concept": "Fait", "filters": [{"field": "description", "op": "contains", "value": "réserve la garantie"}]},
                               steps=["est énoncé dans"], fields=["objet"], limit=20)
    ids = [x["entityId"] for x in guarantee["records"]]
    stated = await run.tool("get_related_records", record_ids=ids, relations=["énonce"], fields=["*"], max_records=100)
    eur = [x for x in stated["records"] if x["concept"] == "Fait" and "EUR" in json.dumps(x, ensure_ascii=False)]
    run.check("MG-20 guarantee and amount", len(ids) == 8 and not eur, f"{len(ids)} mails, {len(eur)} with an EUR fact")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True)
    parser.add_argument("--url", default="http://localhost:8027/mcp")
    arguments = parser.parse_args()
    sys.exit(asyncio.run(main(arguments.url, arguments.user)))
