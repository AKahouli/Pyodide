"""Document tools for M365 Document Connector.

Provides MCP tools for searching, browsing, reading, creating, updating,
renaming, and deleting documents and folders across OneDrive and SharePoint.
"""

from typing import Any, Literal
from urllib.parse import quote

from graph_helpers import (
    DRIVE_ITEM_SELECT,
    MAX_INLINE_TEXT_SIZE,
    build_item_ref,
    error_response,
    graph_delete,
    graph_get,
    graph_headers,
    graph_patch,
    graph_post,
    graph_put_content,
    is_text_content,
    normalize_drive,
    normalize_drive_item,
    normalize_site,
    success_response,
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
        as-is for subsequent read, metadata, or workspace import operations.
        Avoid manually mixing a driveId from one result with an itemId from
        another result.

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
            params = {
                "$select": (
                    DRIVE_ITEM_SELECT
                    + ",description,createdBy,lastModifiedBy,@microsoft.graph.downloadUrl"
                )
            }
            data, status, _ = await graph_get(ref, graph_headers(), params)
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
          Returns a short-lived download URL. Use the platform transfer
          tools to import the file into the current workspace for
          processing with the code interpreter.

        Prefer `get_document_content` when you want either inline text for text
        files or a fallback `downloadUrl` for binary files in one step.

        Use this tool first when the user asks to open a file, read it,
        download it, inspect its actual contents, or prepare it for workspace
        import and downstream processing.

        Args:
            drive_id: The drive ID.
            item_id: The item ID.
            path: Alternative to item_id - the file path.
        """
        try:
            ref = build_item_ref(drive_id, item_id, path)
            meta_select = DRIVE_ITEM_SELECT + ",@microsoft.graph.downloadUrl"
            meta_data, status, _ = await graph_get(
                ref, graph_headers(), {"$select": meta_select}
            )
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

        Creates a new file with the provided text content. For binary files,
        use the platform transfer tools to export from the workspace.

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

        Replaces the entire file content with the provided text.
        For binary/Office files, use the platform transfer tools instead.

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
