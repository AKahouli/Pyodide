"""Entrypoint for the semantic-model-runtime service: ``python main.py``.

Loads the service's own ``.env`` (self-sufficient — no back/.env dependency),
validates the integration variables, then serves ``app.main:app`` via uvicorn.
Optional: ``python main.py --port 8010`` (default 8010).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_PORT = 8010


def main() -> None:
    load_dotenv(Path(__file__).resolve().parent / ".env")

    if not os.environ.get("YELLOWSTORM_INTERNAL_SERVICE_TOKEN"):
        raise SystemExit("YELLOWSTORM_INTERNAL_SERVICE_TOKEN is missing or empty in .env")
    if not os.environ.get("YELLOWSTORM_BACKEND_URL"):
        raise SystemExit("YELLOWSTORM_BACKEND_URL is missing or empty in .env")
    if not os.environ.get("SEMANTIC_RUNTIME_SERVICE_KEY"):
        # The API fails closed without it: every protected route returns 401.
        print("warning: SEMANTIC_RUNTIME_SERVICE_KEY is not set; protected routes will reject all callers")

    import uvicorn

    port = DEFAULT_PORT
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])

    uvicorn.run("app.main:app", host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
