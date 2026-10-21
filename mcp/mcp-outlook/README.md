# Outlook/Calendar MCP Server

FastMCP server providing email and calendar tools for Microsoft Outlook via Microsoft Graph API.

## Tools

| Tool | Description |
|------|-------------|
| `list_users` | List or search users in the organization |
| `send_email` | Send an email via Microsoft Outlook, optionally with files attached |
| `search_m365` | Search M365 via the Graph Search API (messages, drive items, chats…) — discovery, one capped page |
| `search_emails` | Enumerate mail deterministically (filter + cursor pagination), unlike `search_m365` |
| `get_conversation` | Every message in one conversation, oldest first |
| `get_email` / `get_emails` | One email in full, or several in a batched call |
| `list_mail_folders` | List Outlook folders, to target a `search_emails` `folder_id` |
| `list_mail_attachments` | Inspect a message's attachments without downloading them |
| `download_mail_attachments` | Download a message's attachments into the run's storage folder |
| `export_emails_table` | Build a full per-mail CSV (body + attachment first page) server-side, as a file |
| `send_file_to_user` | Deliver a downloaded file to the user in the conversation |
| `create_meeting` | Create a calendar meeting/event with optional Teams meeting |

### Searching vs enumerating mail

`search_m365` answers "which mail mentions X" with **one** Microsoft Search page,
capped at 25 hits for the `message` entity and with `from` fixed at 0 — it cannot
page. Use it for discovery (KQL: `from`, `subject`, `attachment`, `received`).

For "all mail matching a filter", use `search_emails` (standard List Messages API).
It returns one page plus an opaque `pagination.nextCursor`; call it again with the
cursor until `hasMore` is false. `page_size` goes up to 1000, so nothing is capped
to 25. `fetch_all_metadata=True` walks every page in one call (bounded by
`max_results`, default 5000) — use it deliberately, not by default.

Group results by `conversationId` and use `get_conversation` to handle a thread as
one unit rather than every message separately.

Set `include_preview=True` to add each item's `bodyPreview` (~255 chars): enough to
summarise "what is this mail about" from the list itself, without a second,
per-id `get_emails` call. Every Graph call retries `429`/`503`/`504` honouring
`Retry-After` (the mailbox throttles concurrent reads), and `get_emails` batches in
small chunks and retries only the reads that were throttled.

### Selectors instead of ids

A Graph message id is a ~150-character opaque string, and a model that re-types one
can silently drop characters — Graph then answers `ErrorInvalidIdMalformed`. To
avoid that, `get_email`, `get_emails`, `list_mail_attachments` and
`download_mail_attachments` accept a **selector** — `sender`, `subject`,
`date_from`, `date_to`, `has_attachments`, `folder_id` — resolved server-side with
the same filters as `search_emails`:

```text
search_emails(sender="john@sony.com", include_preview=True)         # list + previews
get_emails(sender="john@sony.com", page_size=10, cursor=...)        # bodies, page by page
list_mail_attachments(sender="john@sony.com", has_attachments=True) # what exists
download_mail_attachments(sender="john@sony.com", has_attachments=True, match="all")
```

`match="all"` (default on the attachment tools) takes every match up to `limit`;
`match="newest"` takes only the most recent. Raw `message_id` stays accepted when
you already hold one verbatim.

### Complete table: in chat or as a file

A per-mail table with the *full* body and attachment first pages is ~60 KB / ~15k
tokens for fifty mails — it fits one answer, but a model will not assemble it from
dozens of separate tool results. `export_emails_table` builds it **server-side**
(the bodies never enter the model's reasoning) for any selector — a sender address,
a whole domain (`sender_domain`), a recipient, a subject or a date range — and can
deliver it two ways:

- `delivery="inline"` (or `"both"`) returns the table as Markdown, to paste into the
  answer **verbatim**. A short table comes back as `markdown`; a long one comes back
  as `markdown_parts`, a list of chunks (the platform truncates any single string at
  20k chars), to output in order as one table.
- `delivery="file"` (or `"both"`) writes a UTF-8 CSV into the run folder and
  returns `storage_key` for `send_file_to_user`.

Either way the columns are fixed: *Réception (UTC), Expéditeur, Objet, Contenu
intégral, Résumé du mail, Pièce jointe, Contenu de la première page de la pièce
jointe*, and only the first page of an attachment is extracted. A PDF has real
pages, so its page 1 is read directly. A Word file stores no pagination at all —
pages only exist once a renderer lays the document out — so the `.docx` is rendered
to PDF with LibreOffice (installed in the image) and page 1 is read from that. If
LibreOffice is unavailable the cell says the page could not be rendered rather than
showing the leading text as if it were the page.

### Run storage folder

`download_mail_attachments` writes to `<user_id>/system_<run_id>` in Ceph, where
`run_id` is `x-conversation-id` or, for a playbook run, `x-execution-id`. That is
the same folder the sandbox MCP uses, so when the caller also mounts it (the ADK
appends it to `x-workspace-paths`) a downloaded file is readable in the sandbox at
`/mnt/workspace/system_<run_id>/<filename>` with no extra step.

The code sandbox snapshots that folder when it is created, so pass every message
id to one `download_mail_attachments(message_ids=[...])` call **before** creating
the sandbox — a file written afterwards is not visible inside it.

`send_file_to_user` accepts either of those two names for a file, and only under
this run's folder — a file has to be downloaded by this run before it can be sent.

Any other connector MCP that downloads files must use the same folder — see
[RUN_STORAGE_CONTRACT.md](RUN_STORAGE_CONTRACT.md) for the rule and how to
implement it.

## Setup

```bash
cd outlook-mcp
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

This repository keeps the upstream Graph tools and adapts only their runtime
boundary. MCP ingress is two-credential and authenticated before dispatch
(ADR-0017): the `Authorization` bearer is the backend-signed actor assertion
(`MCP_AUTH_MODE=JWT`, audience `mcp-outlook`, or the explicit
development/private `BEARER` mode with `MCP_INGRESS_TOKEN`), and the configured
provider-token header carries the acting user's delegated Microsoft Graph token.
Graph calls use only that per-request token; there is no environment token, so
mail and calendar operations run with the user's own permissions. The
`streamable-http` transport runs stateless, so no session retains either
credential. Configure least-privilege Graph permissions and do not expose the
listener directly.

| Environment Variable | Description |
|---------------------|-------------|
| `M365_TOKEN_HEADER` | Header carrying the acting user's delegated Graph token (default `x-m365-access-token`) |
| `CEPH_S3_ENDPOINT` / `CEPH_S3_BUCKET` / `CEPH_S3_ACCESS_KEY_ID` / `CEPH_S3_SECRET_ACCESS_KEY` | Storage, required for `storage_key` attachments and `download_mail_attachments` |
| `OUTLOOK_MCP_TRANSPORT` | Transport type: `streamable-http` (default), `sse`, `http` |
| `OUTLOOK_MCP_PORT` / `PORT` | Server port (default: 8002) |
| `ALLOWED_ORIGINS` | CORS origins (default: `*`) |

## Running

```bash
python server.py
```

or, from the `package.json` convenience script:

```bash
npm start
```

## Testing with the MCP Inspector

Start the server (streamable HTTP, default port 8002 or `OUTLOOK_MCP_PORT`), then
point the [Inspector](https://github.com/modelcontextprotocol/inspector) at it:

```bash
npm start                                   # terminal A
npx @modelcontextprotocol/inspector         # terminal B
```

In the Inspector UI: **Transport = Streamable HTTP**, **URL =
`http://localhost:8002/mcp`**. Send the backend actor assertion as
`Authorization: Bearer <assertion>` and the acting user's Graph token as
`x-m365-access-token: <graph-token>`. Then call `search_emails` and page a
mailbox past the 25 results the Search tool was capped at. No Node runtime is
required by the server — `npm start` just runs `python server.py`.

## Required Permissions

Configure these delegated permissions in your Azure AD app:

- `Mail.ReadWrite` - Send and read emails
- `Mail.Send` - Send emails
- `Calendars.ReadWrite` - Create and manage calendar events
- `User.Read.All` - Search and list users

## Examples

### Send Email
```python
send_email(
    to_recipients=["user@example.com"],
    subject="Meeting Notes",
    body="<p>Here are the notes from our meeting...</p>"
)
```

### Create Meeting with Teams
```python
create_meeting(
    subject="Team Sync",
    start_datetime="2024-01-25T14:00:00",
    end_datetime="2024-01-25T15:00:00",
    attendees=["user@example.com"],
    timezone="UTC",
    is_online_meeting=True
)
```
