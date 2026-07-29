import json
import os
import urllib.request
import urllib.error
from typing import Any, Dict, List


COMMUNITY_GRAPH_URL = os.environ.get("COMMUNITY_GRAPH_URL", "http://localhost:8002")


def search(query: str, workspace_name: str, top_k: int = 5) -> List[Dict[str, Any]]:
    url = f"{COMMUNITY_GRAPH_URL}/api/query"
    payload = json.dumps({
        "query": query,
        "workspace_name": workspace_name,
        "top_k": top_k,
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("results", [])
    except urllib.error.URLError as e:
        return [{"error": str(e)}]
    except Exception as e:
        return [{"error": str(e)}]
