"""Document tools for M365 Document Connector.

Provides MCP tools for searching, browsing, reading, creating, updating,
renaming, and deleting documents and folders across OneDrive and SharePoint.
"""

import asyncio
from typing import Any, Literal
from urllib.parse import quote

import httpx

from graph_helpers import (
    DRIVE_ITEM_SELECT,
    GRAPH_BASE,
    MAX_DOWNLOAD_BYTES,
    MAX_DOWNLOAD_FILES,
    MAX_INLINE_TEXT_SIZE,
    DownloadError,
    build_item_ref,
    dedupe_relative_path,
    error_response,
    graph_delete,
    graph_get,
    graph_headers,
    graph_patch,
    graph_post,
    graph_put_content,
    is_text_content,
    logger,
    normalize_drive,
    normalize_drive_item,
    normalize_site,
    put_storage_object,
    run_storage_key,
    safe_relative_path,
    stat_storage_object,
    success_response,
    system_workspace_prefix,
)


def register_document_tools(mcp: Any) -> None:

    # ---------------------------------------------------------------------------
    # Discovery
    # ---------------------------------------------------------------------------

    @mcp.tool()
    async def list_accessible_sites(top: int = 100) -> str:
        """List SharePoint sites accessible to the current user.

        Use this to discover available SharePoint sites before searching
        or browsing their document libraries.

        Args:
            top: Maximum number of sites to return (default 100, max 500)
        """
        try:
            params = {
                "$select": "id,displayName,name,webUrl",
                "$top": min(top, 500),
            }
            data, status, _ = await graph_get("/sites", graph_headers(), params)
            if status != 200:
                return error_response("Failed to list sites", status, str(data))
            sites = [normalize_site(s) for s in (data.get("value") or [])]
            return success_response({"count": len(sites), "sites": sites})
        except Exception as e:
            return error_response(str(e))

    @mcp.tool()
    async def list_accessible_drives(
        site_id: str | None = None,
        top: int = 100,
    ) -> str:
        """List drives (OneDrive and SharePoint document libraries) accessible to the user.

        Args:
            site_id: Optional SharePoint site ID to filter drives.
                     If omitted, returns all drives the user can access.
            top: Maximum number of drives to return (default 100, max 500)
        """
        try:
            params = {
                "$select": "id,name,driveType,webUrl,createdDateTime,owner",
                "$top": min(top, 500),
            }
            path = f"/sites/{site_id}/drives" if site_id else "/me/drives"
            data, status, _ = await graph_get(path, graph_headers(), params)
            if status != 200:
                return error_response("Failed to list drives", status, str(data))
            drives = [normalize_drive(d) for d in (data.get("value") or [])]
            return success_response({"count": len(drives), "drives": drives})
        except Exception as e:
            return error_response(str(e))

    # ---------------------------------------------------------------------------
    # Search
    # ---------------------------------------------------------------------------

    @mcp.tool()
    async def search_documents(
        query: str,
        scope: Literal["me", "drive", "all"] = "me",
        drive_id: str | None = None,
        top: int = 25,
    ) -> str:
        """Search for documents by content and metadata across Microsoft 365.

        Returns matching files and folders. Use the returned full item object
        as-is for subsequent read, metadata, or download operations. Avoid
        manually mixing a driveId from one result with an itemId from another
        result.

        Args:
            query: Search query. Supports keywords, file properties, and KQL syntax.
            scope: Search scope:
                   'me'    - user's OneDrive
                   'drive' - a specific drive (requires drive_id)
                   'all'   - cross-service global search
            drive_id: Required when scope is 'drive'.
            top: Maximum number of results (default 25)
        """
        try:
            headers = graph_headers()
            q = quote(query)

            if scope == "drive":
                if not drive_id:
                    return error_response("drive_id is required when scope is 'drive'")
                path = f"/drives/{drive_id}/root/search(q='{q}')"
                params = {"$top": min(top, 500), "$select": DRIVE_ITEM_SELECT}
                data, status, _ = await graph_get(path, headers, params)
                if status != 200:
                    return error_response("Search failed", status, str(data))
                items = [
                    normalize_drive_item(i, drive_id) for i in (data.get("value") or [])
                ]
                return success_response({"count": len(items), "items": items})

            if scope == "me":
                path = f"/me/drive/root/search(q='{q}')"
                params = {"$top": min(top, 500), "$select": DRIVE_ITEM_SELECT}
                data, status, _ = await graph_get(path, headers, params)
                if status != 200:
                    return error_response("Search failed", status, str(data))
                items = [normalize_drive_item(i) for i in (data.get("value") or [])]
                return success_response({"count": len(items), "items": items})

            search_req = {
                "requests": [
                    {
                        "entityTypes": ["driveItem"],
                        "query": {"queryString": query},
                        "from": 0,
                        "size": min(top, 1000),
                    }
                ]
            }
            result, status = await graph_post("/search/query", headers, search_req)
            if status != 200:
                return error_response("Global search failed", status, str(result))
            items: list[dict[str, Any]] = []
            for req_value in result.get("value") or []:
                for hc in req_value.get("hitsContainers") or []:
                    for hit in hc.get("hits") or []:
                        resource = hit.get("resource")
                        if resource:
                            item = normalize_drive_item(resource)
                            summary = hit.get("summary", "")
                            if summary:
                                item["summary"] = summary
                            items.append(item)
            return success_response({"count": len(items), "items": items})
        except Exception as e:
            return error_response(str(e))

    @mcp.tool()
    async def find_items_by_name(
        name: str,
        drive_id: str | None = None,
        top: int = 25,
    ) -> str:
        """Find files or folders by exact name.

        Better than full-text search when you know the file or folder name.
        Searches the user's OneDrive by default, or a specific drive.

        Args:
            name: The file or folder name to search for.
            drive_id: Optional drive ID. If omitted, searches user's OneDrive.
            top: Maximum number of results (default 25)
        """
        try:
            q = quote(f'"{name}"')
            if drive_id:
                path = f"/drives/{drive_id}/root/search(q='{q}')"
            else:
                path = f"/me/drive/root/search(q='{q}')"
            params = {"$top": min(top, 500), "$select": DRIVE_ITEM_SELECT}
            data, status, _ = await graph_get(path, graph_headers(), params)
            if status != 200:
                return error_response("Name search failed", status, str(data))
            items = [
                normalize_drive_item(i, drive_id) for i in (data.get("value") or [])
            ]
            return success_response({"count": len(items), "items": items})
        except Exception as e:
            return error_response(str(e))

    # ---------------------------------------------------------------------------
    # Browse
    # ---------------------------------------------------------------------------

    @mcp.tool()
    async def list_folder_children(
        drive_id: str,
        item_id: str | None = None,
        path: str | None = None,
        top: int = 200,
    ) -> str:
        """List children (files and subfolders) of a folder.

        Use this to browse folder contents. If neither item_id nor path is
        provided, lists the root folder of the drive.

        Args:
            drive_id: The drive ID containing the folder.
            item_id: Optional item ID of the folder (for non-root folders).
            path: Optional path to the folder (e.g. 'Documents/Reports').
                  Alternative to item_id.
            top: Maximum number of items to return (default 200)
        """
        try:
            ref = build_item_ref(drive_id, item_id, path)
            params = {
                "$top": min(top, 500),
                "$select": DRIVE_ITEM_SELECT,
                "$orderby": "name",
            }
            data, status, _ = await graph_get(
                f"{ref}/children", graph_headers(), params
            )
            if status != 200:
                return error_response(
                    "Failed to list folder children", status, str(data)
                )
            raw_items = data.get("value") or []
            folders = [
                normalize_drive_item(i, drive_id) for i in raw_items if "folder" in i
            ]
            files = [
                normalize_drive_item(i, drive_id)
                for i in raw_items
                if "folder" not in i
            ]
            return success_response(
                {
                    "count": len(raw_items),
                    "folders": folders,
                    "files": files,
                    "items": folders + files,
                }
            )
        except Exception as e:
            return error_response(str(e))

    # ---------------------------------------------------------------------------
    # Read
    # ---------------------------------------------------------------------------

    @mcp.tool()
    async def get_item_metadata(
        drive_id: str,
        item_id: str | None = None,
        path: str | None = None,
    ) -> str:
        """Get metadata for a specific file or folder.

        Returns detailed information including size, MIME type, dates,
        parent reference, and a short-lived download URL for binary files when
        Microsoft Graph provides one. Use this to resolve an item before read,
        import, update, or delete operations.

        Prefer this tool when you need to inspect properties such as file type,
        size, timestamps, parent folder, or web URL.

        For text-based files, use `get_document_content` to read the content.
        For binary/Office files, either use the returned `downloadUrl` from this
        tool or call `get_document_content`, which also returns a `downloadUrl`
        when inline text is not available.

        If the user asks to download, open, read, or process the file content,
        prefer `get_document_content` first. That tool is the primary content
        access entry point.

        Args:
            drive_id: The drive ID.
            item_id: The item ID.
            path: Alternative to item_id - the file or folder path.
        """
        try:
            ref = build_item_ref(drive_id, item_id, path)
            # `@microsoft.graph.downloadUrl` is an instance annotation, not a
            # property: a restrictive $select returns the listed properties and
            # drops it. Fetch the whole driveItem so the annotation survives.
            data, status, _ = await graph_get(ref, graph_headers())
            if status != 200:
                return error_response("Item not found", status, str(data))
            item = normalize_drive_item(data, drive_id)
            item["description"] = data.get("description", "")
            parent_ref = data.get("parentReference") or {}
            item["parentPath"] = parent_ref.get("path", "")
            if "folder" not in data:
                download_url = data.get("@microsoft.graph.downloadUrl", "")
                if download_url:
                    item["downloadUrl"] = download_url
            return success_response({"item": item})
        except Exception as e:
            return error_response(str(e))

    @mcp.tool()
    async def get_document_content(
        drive_id: str,
        item_id: str | None = None,
        path: str | None = None,
    ) -> str:
        """Read the content of a document.

        For text-based files (.txt, .md, .json, .csv, .py, etc.):
          Returns the text content inline.

        For binary/Office files (.docx, .xlsx, .pptx, .pdf, images, etc.):
          Returns a short-lived download URL, for inspection only. To make
          the file available to the code interpreter, call download_documents
          with the item instead — it writes into this run's storage folder,
          which is mounted in the sandbox.

        Use this to peek at a single text file's contents inline. It does NOT
        make a file available to later steps — to fetch, retrieve or download
        files for processing, call download_documents instead.

        Args:
            drive_id: The drive ID.
            item_id: The item ID.
            path: Alternative to item_id - the file path.
        """
        try:
            ref = build_item_ref(drive_id, item_id, path)
            # No $select: it would drop the @microsoft.graph.downloadUrl
            # annotation this tool depends on for binary files.
            meta_data, status, _ = await graph_get(ref, graph_headers())
            if status != 200:
                return error_response("Item not found", status, str(meta_data))

            item = normalize_drive_item(meta_data, drive_id)

            if "folder" in meta_data:
                return error_response(
                    "Cannot read content of a folder. Use list_folder_children instead."
                )

            mime_type = item["mimeType"]
            filename = item["name"]
            text_like = is_text_content(mime_type, filename)

            if text_like:
                content, status, ct = await graph_get(
                    f"{ref}/content", graph_headers(), follow_redirects=True
                )
                if status != 200:
                    return error_response("Failed to read file content", status)
                if isinstance(content, bytes):
                    try:
                        text = content.decode("utf-8")
                    except UnicodeDecodeError:
                        text = content.decode("latin-1")
                else:
                    text = str(content)
                if len(text) > MAX_INLINE_TEXT_SIZE:
                    text = text[:MAX_INLINE_TEXT_SIZE]
                    text += f"\n\n... [truncated at {MAX_INLINE_TEXT_SIZE} characters]"
                return success_response(
                    {
                        "contentMode": "inline_text",
                        "item": item,
                        "text": text,
                        "size": len(text),
                    }
                )

            download_url = meta_data.get("@microsoft.graph.downloadUrl", "")
            if not download_url:
                return error_response("No download URL available for this file")
            return success_response(
                {
                    "contentMode": "download_url",
                    "item": item,
                    "downloadUrl": download_url,
                }
            )
        except Exception as e:
            return error_response(str(e))

    # ---------------------------------------------------------------------------
    # Download to run storage
    # ---------------------------------------------------------------------------

    async def _collect_files(
        drive_id: str,
        item_id: str | None,
        path: str | None,
        prefix: str,
        recursive: bool,
        budget: dict,
    ) -> tuple[list[dict], list[dict]]:
        """Every downloadable file under one requested item, with its relative path.

        A file yields itself; a folder is walked. Returns (files, skipped) and
        stops adding once the file-count budget is spent, so a request against a
        huge SharePoint tree degrades into a partial result the caller is told
        about rather than an unbounded walk.
        """
        ref = build_item_ref(drive_id, item_id, path)
        # No $select anywhere in this walk: `@microsoft.graph.downloadUrl` is an
        # instance annotation, and asking for a property list makes Graph drop it
        # -- every file then looks like it has no download URL.
        data, status, _ = await graph_get(ref, graph_headers())
        if status != 200:
            return [], [{"item": item_id or path or drive_id,
                         "reason": f"not found ({status})"}]

        name = data.get("name") or "item"
        if "folder" not in data:
            if budget["files"] <= 0:
                return [], [{"item": safe_relative_path(prefix, name),
                             "reason": f"over the {MAX_DOWNLOAD_FILES}-file limit"}]
            url = data.get("@microsoft.graph.downloadUrl")
            if not url:
                return [], [{"item": name, "reason": "no download URL available"}]
            budget["files"] -= 1
            return [{
                "relative_path": safe_relative_path(prefix, name),
                "download_url": url,
                "content_type": (data.get("file") or {}).get("mimeType") or "application/octet-stream",
                "size": data.get("size") or 0,
                "name": name,
            }], []

        if not recursive and prefix:
            # A nested folder reached with recursion off: report it, do not walk.
            return [], [{"item": safe_relative_path(prefix, name),
                         "reason": "subfolder skipped (recursive=false)"}]

        files: list[dict] = []
        skipped: list[dict] = []
        folder_prefix = safe_relative_path(prefix, name)
        # Follow @odata.nextLink. Without it a folder holding more children than
        # one page is truncated with no entry in `skipped`, so the caller believes
        # it received everything -- silent loss is worse than a reported limit.
        next_path: str | None = f"{ref}/children"
        params: dict[str, Any] | None = {"$top": 200, "$orderby": "name"}
        while next_path:
            page, status, _ = await graph_get(next_path, graph_headers(), params)
            if status != 200:
                skipped.append({"item": folder_prefix,
                                "reason": f"cannot list folder ({status})"})
                break

            for child in page.get("value") or []:
                if budget["files"] <= 0:
                    skipped.append({"item": safe_relative_path(folder_prefix, child.get("name") or "?"),
                                    "reason": f"over the {MAX_DOWNLOAD_FILES}-file limit"})
                    continue
                if "folder" in child:
                    if not recursive:
                        skipped.append({"item": safe_relative_path(folder_prefix, child.get("name") or "?"),
                                        "reason": "subfolder skipped (recursive=false)"})
                        continue
                    sub_files, sub_skipped = await _collect_files(
                        drive_id, child.get("id"), None, folder_prefix, recursive, budget
                    )
                    files.extend(sub_files)
                    skipped.extend(sub_skipped)
                    continue
                url = child.get("@microsoft.graph.downloadUrl")
                child_name = child.get("name") or "file"
                if not url:
                    skipped.append({"item": safe_relative_path(folder_prefix, child_name),
                                    "reason": "no download URL available"})
                    continue
                budget["files"] -= 1
                files.append({
                    "relative_path": safe_relative_path(folder_prefix, child_name),
                    "download_url": url,
                    "content_type": (child.get("file") or {}).get("mimeType") or "application/octet-stream",
                    "size": child.get("size") or 0,
                    "name": child_name,
                })

            link = str(page.get("@odata.nextLink") or "")
            next_path = link[len(GRAPH_BASE):] if link.startswith(GRAPH_BASE) else None
            params = None  # the nextLink already carries the paging state
            if budget["files"] <= 0:
                if next_path:
                    skipped.append({
                        "item": folder_prefix,
                        "reason": f"stopped at the {MAX_DOWNLOAD_FILES}-file limit; "
                                  "remaining items were not listed",
                    })
                break
        return files, skipped

    @mcp.tool()
    async def download_documents(
        items: list[dict],
        recursive: bool = True,
    ) -> str:
        """Download SharePoint/OneDrive files so they can be opened and processed.

        Use this whenever files need to be fetched, retrieved, read, parsed,
        analysed, or processed by the code interpreter. It is the only tool that
        puts real file bytes somewhere later steps can reach them. Searching and
        listing return metadata only — knowing a file's name is not the same as
        having it, and nothing downstream can open a file until it is downloaded.

        Pass a FOLDER to take everything inside it in a single call: subfolders
        are walked and their structure is preserved, so files with the same name
        in different subfolders do not collide. There is no need to list a
        folder's children first.

        Files land in this run's storage folder, which is mounted in the sandbox,
        so each one is readable at /mnt/workspace/system_<run>/<relative path>
        with no further step.

        Args:
            items: What to download — files, folders, or a mix. Each entry needs
                a drive id and either an item id or a path; the full item object
                returned by search_documents, find_items_by_name, or
                list_folder_children works as-is. Accepts driveId/itemId or
                drive_id/item_id. Do not mix a driveId from one result with an
                itemId from another.
            recursive: Walk subfolders of any folder given (default true). Set
                false to take only a folder's immediate files.

        Downloading does not show the file to the user. To hand one over, call
        send_file_to_user with the `storage_key` returned here.

        Returns:
            JSON with one entry per downloaded file (`filename`, `storage_key`,
            `sandbox_path`, `size`), plus anything skipped and why.

        Examples:
            - download_documents([{"driveId": "b!x…", "itemId": "01ABC…"}])
            - download_documents(items_from_search, recursive=False)
        """
        try:
            folder = system_workspace_prefix()
            if not folder:
                # No run folder means no mounted destination — writing anywhere
                # else silently produces a file the sandbox can never read.
                return error_response(
                    "cannot resolve this run's storage folder (missing X-user-id "
                    "or x-conversation-id/x-execution-id on this request)"
                )
            if not items:
                return error_response("items is required: pass the documents to download")

            budget = {"files": MAX_DOWNLOAD_FILES}
            planned: list[dict] = []
            skipped: list[dict] = []
            for entry in items:
                if not isinstance(entry, dict):
                    skipped.append({"item": str(entry), "reason": "not an item object"})
                    continue
                drive_id = str(entry.get("driveId") or entry.get("drive_id") or "").strip()
                item_id = str(entry.get("itemId") or entry.get("item_id") or "").strip() or None
                item_path = str(entry.get("path") or "").strip() or None
                if not drive_id or not (item_id or item_path):
                    skipped.append({"item": entry.get("name") or str(entry)[:60],
                                    "reason": "needs a driveId plus an itemId or path"})
                    continue
                found, missed = await _collect_files(
                    drive_id, item_id, item_path, "", recursive, budget
                )
                planned.extend(found)
                skipped.extend(missed)

            downloaded: list[dict] = []
            taken: set[str] = set()
            total_bytes = 0
            async with httpx.AsyncClient() as client:
                for file in planned:
                    if total_bytes + (file["size"] or 0) > MAX_DOWNLOAD_BYTES:
                        skipped.append({"item": file["relative_path"],
                                        "reason": f"over the {MAX_DOWNLOAD_BYTES // 1024 // 1024}MB total limit"})
                        continue
                    # The download URL is pre-authorized and short-lived; sending
                    # the bearer token with it makes Graph reject the request.
                    got = await client.get(file["download_url"], timeout=300.0)
                    if got.status_code != 200:
                        skipped.append({"item": file["relative_path"],
                                        "reason": f"download failed ({got.status_code})"})
                        continue
                    raw = got.content
                    relative_path = dedupe_relative_path(file["relative_path"], taken)
                    taken.add(relative_path)
                    storage_key = f"{folder}/{relative_path}"
                    await asyncio.to_thread(
                        put_storage_object, storage_key, raw, file["content_type"]
                    )
                    total_bytes += len(raw)
                    downloaded.append({
                        "filename": file["name"],
                        "storage_key": storage_key,
                        "sandbox_path": f"/mnt/workspace/{folder.split('/')[-1]}/{relative_path}",
                        "size": len(raw),
                        "content_type": file["content_type"],
                    })

            logger.info(
                "download_documents: folder=%s downloaded=%d bytes=%d skipped=%d",
                folder, len(downloaded), total_bytes, len(skipped),
            )
            result: dict[str, Any] = {
                "folder": folder,
                "count": len(downloaded),
                "files": downloaded,
            }
            if skipped:
                result["skipped"] = skipped
            return success_response(result)
        except DownloadError as e:
            return error_response(str(e))
        except Exception as e:
            logger.exception("download_documents: failed: %s", e)
            return error_response(str(e))

    @mcp.tool()
    async def send_file_to_user(ceph_path: str) -> str:
        """Deliver a file to the user, who then sees and downloads it in the chat.

        Files this connector touches are invisible to the user until this tool
        is called for them — sending is a separate act from fetching. Call it
        once per file, only for the files the user actually asked for.

        The file must already be in this run's storage, and `download_documents`
        is what puts it there. A search result is not enough: an item id, a web
        URL or a filename cannot be sent, so download first, then send the
        `storage_key` that came back for each file.

        Args:
            ceph_path: The `storage_key` `download_documents` returned for the
                file, e.g. "42/system_abc/Rapports/q3.pdf". The `sandbox_path`
                it returned for the same file works too.

        Returns:
            JSON confirming the delivery, carrying the `ceph_path` of the file
            that was sent.

        Examples:
            - send_file_to_user("42/system_abc/Rapports/q3.pdf")
        """
        try:
            folder = system_workspace_prefix()
            if not folder:
                return error_response(
                    "cannot resolve this run's storage folder (missing X-user-id "
                    "or x-conversation-id/x-execution-id on this request)"
                )
            key = run_storage_key(ceph_path, folder)
            if not key:
                return error_response(
                    f"'{ceph_path}' is not a file from this run — pass the "
                    "storage_key download_documents returned for it"
                )
            stored = await asyncio.to_thread(stat_storage_object, key)
            if stored is None:
                return error_response(
                    f"nothing stored at '{key}' — download the file with "
                    "download_documents before sending it"
                )
            filename = key.rsplit("/", 1)[-1]
            logger.info(
                "send_file_to_user: key=%r size=%s", key, stored["size"]
            )
            # `ceph_path` at the top level is what makes the file appear in the
            # conversation: the agent runtime keys its file detection on that
            # field, and reads `path` for the name it shows.
            return success_response({
                "ceph_path": key,
                "path": key,
                "filename": filename,
                "size": stored["size"],
                "message": f"{filename} was sent to the user.",
            })
        except DownloadError as e:
            return error_response(str(e))
        except Exception as e:
            logger.exception("send_file_to_user: failed: %s", e)
            return error_response(str(e))

    # ---------------------------------------------------------------------------
    # Write
    # ---------------------------------------------------------------------------

    @mcp.tool()
    async def create_folder(
        drive_id: str,
        name: str,
        parent_id: str | None = None,
        parent_path: str | None = None,
    ) -> str:
        """Create a new folder in a drive.

        Args:
            drive_id: The drive ID where the folder will be created.
            name: Name of the new folder.
            parent_id: Optional parent folder item ID. Defaults to root.
            parent_path: Optional parent folder path. Alternative to parent_id.
        """
        try:
            ref = build_item_ref(drive_id, parent_id, parent_path)
            body: dict[str, Any] = {
                "name": name,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "rename",
            }
            data, status = await graph_post(f"{ref}/children", graph_headers(), body)
            if status not in (200, 201):
                return error_response("Failed to create folder", status, str(data))
            item = normalize_drive_item(data, drive_id)
            return success_response({"item": item, "created": True})
        except Exception as e:
            return error_response(str(e))

    @mcp.tool()
    async def create_document(
        drive_id: str,
        filename: str,
        content: str,
        parent_id: str | None = None,
        parent_path: str | None = None,
    ) -> str:
        """Create a new document with text content in a drive.

        Creates a new file with the provided text content. Text only — this
        tool cannot write binary or Office file formats.

        Args:
            drive_id: The drive ID where the document will be created.
            filename: Name for the new file (e.g. 'report.md', 'data.csv').
            content: Text content to write into the file.
            parent_id: Optional parent folder item ID. Defaults to root.
            parent_path: Optional parent folder path. Alternative to parent_id.
        """
        try:
            parent_ref = build_item_ref(drive_id, parent_id, parent_path)
            encoded_name = quote(filename)
            upload_path = f"{parent_ref}:/{encoded_name}:/content"
            encoded = content.encode("utf-8")
            data, status = await graph_put_content(
                upload_path,
                graph_headers(),
                encoded,
                content_type="text/plain",
            )
            if status not in (200, 201):
                return error_response("Failed to create document", status, str(data))
            item = (
                normalize_drive_item(data, drive_id)
                if data
                else {
                    "driveId": drive_id,
                    "itemId": "",
                    "name": filename,
                    "mimeType": "text/plain",
                    "isFolder": False,
                    "size": len(encoded),
                }
            )
            return success_response({"item": item, "created": True})
        except Exception as e:
            return error_response(str(e))

    @mcp.tool()
    async def update_document_content(
        drive_id: str,
        item_id: str,
        content: str,
    ) -> str:
        """Update the content of an existing text document.

        Replaces the entire file content with the provided text. Text only —
        this tool cannot write binary or Office file formats.

        Args:
            drive_id: The drive ID containing the document.
            item_id: The item ID of the document to update.
            content: New text content for the document.
        """
        try:
            path = f"/drives/{drive_id}/items/{item_id}/content"
            encoded = content.encode("utf-8")
            data, status = await graph_put_content(
                path, graph_headers(), encoded, "text/plain"
            )
            if status not in (200, 201):
                return error_response("Failed to update document", status, str(data))
            item = (
                normalize_drive_item(data, drive_id)
                if data
                else {
                    "driveId": drive_id,
                    "itemId": item_id,
                    "isFolder": False,
                    "size": len(encoded),
                }
            )
            return success_response({"item": item, "updated": True})
        except Exception as e:
            return error_response(str(e))

    @mcp.tool()
    async def rename_item(
        drive_id: str,
        item_id: str,
        new_name: str,
    ) -> str:
        """Rename a file or folder.

        Args:
            drive_id: The drive ID.
            item_id: The item ID of the file or folder to rename.
            new_name: The new name for the item.
        """
        try:
            path = f"/drives/{drive_id}/items/{item_id}"
            data, status = await graph_patch(path, graph_headers(), {"name": new_name})
            if status != 200:
                return error_response("Failed to rename item", status, str(data))
            item = (
                normalize_drive_item(data, drive_id)
                if data
                else {
                    "driveId": drive_id,
                    "itemId": item_id,
                    "name": new_name,
                    "isFolder": False,
                }
            )
            return success_response({"item": item, "renamed": True})
        except Exception as e:
            return error_response(str(e))

    @mcp.tool()
    async def delete_item(
        drive_id: str,
        item_id: str,
    ) -> str:
        """Delete a file or folder (moves to recycle bin).

        Args:
            drive_id: The drive ID.
            item_id: The item ID of the file or folder to delete.
        """
        try:
            path = f"/drives/{drive_id}/items/{item_id}"
            status = await graph_delete(path, graph_headers())
            if status == 204:
                return success_response({"deleted": True, "itemId": item_id})
            return error_response("Failed to delete item", status)
        except Exception as e:
            return error_response(str(e))
