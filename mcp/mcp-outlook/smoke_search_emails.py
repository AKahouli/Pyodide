"""Live smoke test for `search_emails` — needs a real Microsoft Graph token.

    set M365_ACCESS_TOKEN=<bearer>
    python smoke_search_emails.py ssnousi@yellowsys.fr
    python smoke_search_emails.py --domain yellowsys.fr

Pages through `search_emails` with the cursor and prints how many messages come
back, which is the number the old `search_m365` could never get past 25. Read-only:
it only lists mail.
"""
import asyncio
import json
import logging
import sys

import server


logger = logging.getLogger(__name__)


async def page_through(**filters) -> int:
    result = json.loads(await server.search_emails(**filters))
    if result.get("status") != "success":
        logger.error("ERROR: %s", result)
        return 0
    pagination = result["pagination"]
    total = len(result["items"])
    cursor = pagination.get("nextCursor")
    pages = 1
    logger.info(f"page 1: returned={pagination['returned']} hasMore={pagination['hasMore']}")
    while cursor and pages < 50:
        nxt = json.loads(await server.search_emails(cursor=cursor))
        pages += 1
        total += len(nxt.get("items", []))
        pagination = nxt["pagination"]
        logger.info(f"page {pages}: returned={pagination['returned']} hasMore={pagination['hasMore']}")
        cursor = pagination.get("nextCursor")
    logger.info(f"TOTAL {total} messages over {pages} page(s)")
    return total


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s", force=True)
    args = sys.argv[1:]
    if not args:
        logger.info(__doc__)
        return
    if args[0] == "--domain":
        await page_through(sender_domain=args[1])
    else:
        await page_through(sender=args[0])


if __name__ == "__main__":
    asyncio.run(main())
