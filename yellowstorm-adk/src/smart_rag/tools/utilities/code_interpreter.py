"""
Python interpreter tool for executing code in an isolated sandbox.

This module provides a custom Python interpreter that integrates with
the backend sandbox service instead of using MCP microsandbox.
"""

import asyncio
import base64
import json
import requests
import logging
from google.adk.tools.tool_context import ToolContext
from google.genai import types

from src.logger.logging import get_logger
from src.config.settings import get_settings

logger = get_logger("api.smart_rag.python_tool")

# Constants for production safety
MAX_TIMEOUT_SECONDS = 300  # 5 minutes maximum

# Session state keys used to pass per-request params via ADK tool_context.state
_STATE_KEY_SESSION_ID = "_code_interpreter_session_id"
_STATE_KEY_BRAIN_ID = "_code_interpreter_brain_id"
_STATE_KEY_BRAIN_DOCS = "_code_interpreter_brain_docs"
_STATE_KEY_USER_ID = "_code_interpreter_user_id"
_STATE_KEY_GENERATED_FILES = "_code_interpreter_generated_files"


async def python_interpreter(
        code: str,
        timeout_seconds: int = 60,
        tool_context: ToolContext = None,
) -> dict:
    """
    Execute Python 3 code in an isolated sandbox.

    This tool allows you to run Python code securely in an isolated environment.
    Use it for data analysis, calculations, file processing, and visualization.

    Generated files (CSV, images, reports, etc.) are automatically saved and
    made available as downloadable artifacts.

    Args:
        code (str): The Python code to execute
        timeout_seconds (int): Maximum execution time in seconds (default: 60)
        tool_context (ToolContext): ADK tool context for session management

    Returns:
        dict: Dictionary with 'text' (formatted results for agent), 'stdout' (raw output),
              and 'stderr' (raw errors)

    Example:
        ```python
        import pandas as pd

        # Analyze data
        df = pd.read_csv('sales.csv')
        report = df.groupby('region').sum()

        # Save report - automatically becomes downloadable
        report.to_csv('sales_report.csv', index=False)

        print("Report generated successfully!")
        ```
    """
    app_settings = get_settings()
    backend_url = app_settings.CODE_INTERPRETER_BACKEND_URL

    # 1. Validate backend URL is configured
    if not backend_url:
        logger.error("[PYTHON TOOL] CODE_INTERPRETER_BACKEND_URL not configured")
        error_msg = "❌ Error: Code interpreter backend not configured. Please contact administrator."
        return {"text": error_msg, "stdout": "", "stderr": error_msg}

    # 2. Cap timeout at reasonable limit for production safety
    timeout_seconds = min(timeout_seconds, MAX_TIMEOUT_SECONDS)
    if timeout_seconds > MAX_TIMEOUT_SECONDS:
        logger.warning(f"[PYTHON TOOL] Timeout capped from {timeout_seconds}s to {MAX_TIMEOUT_SECONDS}s")

    # Read per-request params from session state
    session_id = None
    brain_id = None
    user_id = None
    file_paths_base64 = None

    if tool_context:
        session_id = tool_context.state.get(_STATE_KEY_SESSION_ID)
        brain_id = tool_context.state.get(_STATE_KEY_BRAIN_ID)
        user_id = tool_context.state.get(_STATE_KEY_USER_ID)
        brain_documents = tool_context.state.get(_STATE_KEY_BRAIN_DOCS)

        if session_id:
            logger.info(f"[PYTHON TOOL] Using session_id from state: {session_id}")
        if brain_id:
            logger.info(f"[PYTHON TOOL] Using brain_id from state: {brain_id}")
        if user_id:
            logger.info(f"[PYTHON TOOL] Using user_id from state: {user_id}")
        if brain_documents:
            file_paths_list = []
            for doc in brain_documents:
                # Use filepath directly as azure_path
                azure_path = doc.get("filepath", "")
                filename = doc.get("filename", "")

                # Only add if we have both azure_path and filename
                if azure_path and filename:
                    file_paths_list.append({
                        "azure_path": azure_path,
                        "filename": filename
                    })

            if file_paths_list:
                file_paths_json = json.dumps(file_paths_list)
                file_paths_base64 = base64.b64encode(file_paths_json.encode('utf-8')).decode('utf-8')
                logger.info(f"[PYTHON TOOL] Sending {len(file_paths_list)} file paths to backend v2")
            else:
                logger.warning("[PYTHON TOOL] No valid file paths to send (missing filepath or filename)")

    try:
        # Run sync request inside async tool
        response = await asyncio.to_thread(
            requests.post,
            f"{backend_url}/tool/python_interpreter_v2",
            json={
                "user_id": user_id,
                "workspace_id": brain_id,
                "session_id": session_id,
                "code": code,
                "timeout_seconds": timeout_seconds,
                "file_paths": file_paths_base64
            },
            timeout=timeout_seconds + 15
        )

        response.raise_for_status()
        result = response.json()

        # Extract raw stdout and stderr for sandbox component
        raw_stdout = result.get("stdout", "")
        raw_stderr = result.get("stderr", "")

        output = []

        # Status
        status = result.get("status", {})
        if status.get("id") == 3:
            output.append("✅ Execution successful\n")
        else:
            output.append(f"❌ Error: {status.get('description', 'Unknown')}\n")

        # Stdout
        if raw_stdout:
            output.append(f"```\n{raw_stdout}\n```\n")

        # Stderr
        if raw_stderr:
            output.append(f"**Errors:**\n```\n{raw_stderr}\n```\n")

        # Process files → ADK Artifacts
        generated_files = result.get("generated_files", [])

        # Store generated files in session state (per-session)
        if generated_files and tool_context:
            existing_files = tool_context.state.get(_STATE_KEY_GENERATED_FILES, [])
            files_added = 0
            files_updated = 0

            for f in generated_files:
                new_file = {
                    "filename": f["name"],
                    "azure_path": f.get("azure_path"),
                    "size": f.get("size", 0),
                    "content_type": f.get("content_type", "application/octet-stream")
                }

                # Check if file already exists (same filename and azure_path)
                file_exists = False
                for idx, existing_file in enumerate(existing_files):
                    if (existing_file.get("filename") == new_file["filename"] and
                        existing_file.get("azure_path") == new_file["azure_path"]):
                        existing_files[idx] = new_file
                        file_exists = True
                        files_updated += 1
                        logger.debug(f"[PYTHON TOOL] Updated existing file: {new_file['filename']}")
                        break

                if not file_exists:
                    existing_files.append(new_file)
                    files_added += 1
                    logger.debug(f"[PYTHON TOOL] Added new file: {new_file['filename']}")

            tool_context.state[_STATE_KEY_GENERATED_FILES] = existing_files
            logger.info(f"[PYTHON TOOL] Files in session state: {files_added} added, {files_updated} updated (total: {len(existing_files)})")
        # Stats
        if result.get("time"):
            output.append(f"\n*Execution time: {result['time']}s*")

        # Return dict with both formatted text and raw data (similar to web_search)
        formatted_text = "\n".join(output)

        return {
            "text": formatted_text,  # Formatted text for the agent
            "stdout": raw_stdout,     # Raw stdout for sandbox component
            "stderr": raw_stderr      # Raw stderr for sandbox component
            # Note: generated_files are stored in session state and extracted by the runner after execution
        }

    except requests.exceptions.Timeout:
        logger.error(f"[PYTHON TOOL] Backend timeout after {timeout_seconds}s")
        error_msg = f"❌ Error: Code execution timed out after {timeout_seconds} seconds"
        return {"text": error_msg, "stdout": "", "stderr": error_msg}
    except requests.exceptions.RequestException as e:
        logger.error(f"[PYTHON TOOL] Backend request error: {e}")
        error_msg = f"❌ Error: Failed to connect to sandbox backend: {str(e)}"
        return {"text": error_msg, "stdout": "", "stderr": error_msg}
    except Exception as e:
        logger.exception(f"[PYTHON TOOL] Unexpected error: {e}")
        error_msg = f"❌ Error: {str(e)}"
        return {"text": error_msg, "stdout": "", "stderr": error_msg}



