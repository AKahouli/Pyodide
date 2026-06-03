"""
Common Helpers Module

Provides shared utility functions used across different tools.
"""

import asyncio
import base64
import hashlib
import hmac
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Set
from urllib.parse import quote, urlsplit
import aiofiles
import aiohttp
from azure.storage.filedatalake.aio import DataLakeFileClient as FileClient
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.similarity_search.worker_functions import (
    similarity_search_with_score_task_async,
    hybrid_search_with_score_task_async
)

logger = get_logger("api.smart_rag.tools.common_helpers")
settings = get_settings()


class CommonHelpers:
    """
    Collection of common utility functions used across different tools.
    """

    def __init__(self, file_path: str = "./tmp"):
        """
        Initialize CommonHelpers.

        Args:
            file_path: Base path for file operations
        """
        self.file_path = file_path
        self.api_url = settings.API_URL
        self.azure_connection_string = settings.AZURE_DATALAKE_CONNECTION_STRING
        self.azure_file_system_name = settings.AZURE_DATALAKE_FILE_SYSTEM_NAME
        self.ceph_endpoint = settings.CEPH_ENDPOINT
        self.ceph_region = settings.CEPH_REGION
        self.ceph_bucket_name = settings.CEPH_BUCKET_NAME
        self.ceph_access_key_id = settings.CEPH_ACCESS_KEY_ID
        self.ceph_secret_access_key = settings.CEPH_SECRET_ACCESS_KEY

    def _has_ceph_config(self) -> bool:
        return all([
            self.ceph_endpoint,
            self.ceph_bucket_name,
            self.ceph_access_key_id,
            self.ceph_secret_access_key,
        ])

    def _normalize_ceph_object_key(self, file_path: str) -> str:
        text = (file_path or "").strip()
        bucket = self.ceph_bucket_name or ""
        if text.startswith("s3://"):
            parts = text.removeprefix("s3://").split("/", 1)
            return parts[1] if len(parts) == 2 and parts[0] == bucket else text

        endpoint = (self.ceph_endpoint or "").rstrip("/")
        if endpoint and text.startswith(f"{endpoint}/"):
            path = urlsplit(text).path.lstrip("/")
            prefix = f"{bucket}/"
            return path[len(prefix):] if path.startswith(prefix) else path

        prefix = f"{bucket}/"
        return text[len(prefix):] if text.startswith(prefix) else text

    def _build_ceph_get_headers(self, object_key: str) -> Dict[str, str]:
        endpoint = (self.ceph_endpoint or "").rstrip("/")
        host = urlsplit(endpoint).netloc
        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        canonical_uri = f"/{quote(self.ceph_bucket_name or '', safe='')}/{quote(object_key, safe='/')}"
        canonical_headers = f"host:{host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{amz_date}\n"
        signed_headers = "host;x-amz-content-sha256;x-amz-date"
        canonical_request = "\n".join([
            "GET",
            canonical_uri,
            "",
            canonical_headers,
            signed_headers,
            "UNSIGNED-PAYLOAD",
        ])
        credential_scope = f"{date_stamp}/{self.ceph_region}/s3/aws4_request"
        string_to_sign = "\n".join([
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ])
        signature = hmac.new(
            self._get_signature_key(date_stamp),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "Authorization": (
                "AWS4-HMAC-SHA256 "
                f"Credential={self.ceph_access_key_id}/{credential_scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            ),
            "Host": host,
            "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
            "x-amz-date": amz_date,
        }

    def _get_signature_key(self, date_stamp: str) -> bytes:
        secret = f"AWS4{self.ceph_secret_access_key}".encode("utf-8")
        date_key = hmac.new(secret, date_stamp.encode("utf-8"), hashlib.sha256).digest()
        region_key = hmac.new(date_key, self.ceph_region.encode("utf-8"), hashlib.sha256).digest()
        service_key = hmac.new(region_key, b"s3", hashlib.sha256).digest()
        return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()

    async def async_download_from_ceph_s3(self, file_path: str) -> str:
        """
        Download a file from Ceph S3 asynchronously.
        """
        if not self._has_ceph_config():
            raise RuntimeError("Ceph S3 credentials are not configured")

        object_key = self._normalize_ceph_object_key(file_path)
        endpoint = (self.ceph_endpoint or "").rstrip("/")
        url = f"{endpoint}/{quote(self.ceph_bucket_name or '', safe='')}/{quote(object_key, safe='/')}"
        output_path = os.path.join(self.file_path, os.path.basename(object_key))
        os.makedirs(self.file_path, exist_ok=True)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=self._build_ceph_get_headers(object_key)) as response:
                    response.raise_for_status()
                    async with aiofiles.open(output_path, "wb") as my_file:
                        await my_file.write(await response.read())
            return output_path
        except Exception as e:
            logger.error(f"Failed to download file {file_path} from Ceph S3: {str(e)}")
            raise

    async def async_download_from_storage(self, file_path: str) -> str:
        if self._has_ceph_config():
            return await self.async_download_from_ceph_s3(file_path)
        return await self.async_download_from_azure_datalake(file_path)

    async def async_download_from_azure_datalake(self, file_path: str) -> str:
        """
        Download a file from Azure Data Lake asynchronously.

        Args:
            file_path: The path of the file to download.

        Returns:
            The path of the downloaded file.
            
        Raises:
            Exception: If download fails
        """
        try:
            # Handle file extensions (could be extended as needed)
            ext = os.path.splitext(file_path)[1].lower()
            ignored_extensions = [".pdf", ".json", ".txt"]
            # This was in original but not implemented - keeping for reference

        except Exception as e:
            logger.error(f"Error processing file extension: {file_path}, Error: {str(e)}")

        try:
            async with FileClient.from_connection_string(
                    conn_str=self.azure_connection_string,
                    file_system_name=self.azure_file_system_name,
                    file_path=file_path,
            ) as file:
                output_path = os.path.join(self.file_path, os.path.basename(file_path))
                os.makedirs(self.file_path, exist_ok=True)
                download = await file.download_file()

                # Asynchronously write to the file
                async with aiofiles.open(output_path, "wb") as my_file:
                    await my_file.write(await download.readall())

            return output_path
        except Exception as e:
            logger.error(f"Failed to download file {file_path}: {str(e)}")
            raise

    def create_search_payload(self, query: str, filter_params: Dict,
                            vectorstore: str, top_k: int, search_type: str = "vector_search",
                            user_id: Optional[str] = None) -> Dict:
        """
        Create a standardized search payload.

        Args:
            query: Search query
            filter_params: Filter parameters
            vectorstore: Vectorstore name
            top_k: Number of top results to return
            search_type: Type of search to perform ("vector_search" or "hybrid_search")
            user_id: Optional user ID for search context and logging

        Returns:
            Dictionary containing search payload
        """
        if top_k is None:
            top_k=4
        payload = {
            "query": query,
            "collection_name": vectorstore,
            "top_k": top_k,
            "filter": filter_params,
            "search_type": search_type
        }
        if user_id:
            payload["user_id"] = user_id
        return payload

    def create_text_object(self, item_data: Dict) -> Dict:
        """
        Create a standardized text object from search result.

        Args:
            item_data: Raw search result data

        Returns:
            Standardized text object
        """
        # Extract just the filename from the source path
        source_path = item_data["metadata"]["source"]
        # Handle None source_path (e.g., from BM25 results where source might be missing)
        if source_path and '/' in source_path:
            filename = source_path.split('/')[-1]
        else:
            filename = source_path if source_path else "unknown_source"

        return {
            "type": "text",
            "content": {
                "source": filename,  # Only filename, not full path
                "file_name": item_data["metadata"].get("file_name") or filename,
                "workspace_name": item_data["metadata"].get("workspace_name"),
                "external_id": item_data["metadata"].get("external_id"),
                "brain_id": item_data["metadata"].get("brain_id"),
                "page_content": item_data["page_content"],
                "page": item_data["metadata"].get("page"),
            }
        }

    def create_image_object(self, item_data: Dict) -> Dict:
        """
        Create a standardized image object from search result.
        
        Args:
            item_data: Raw search result data
            
        Returns:
            Standardized image object
        """
        return {
            "type": "image",
            "content": {
                "path": item_data[0]["metadata"].get("image_path", ''),
                "height": item_data[0]["metadata"].get("aspect_ratio", {}).get("height", ''),
                "width": item_data[0]["metadata"].get("aspect_ratio", {}).get("width", ''),
                "page": item_data[0]["metadata"].get("page", ''),
                "file_name": item_data[0]["metadata"].get("file_name")
                or item_data[0]["metadata"].get("source", ''),
                "workspace_name": item_data[0]["metadata"].get("workspace_name", ''),
                "brain_id": item_data[0]["metadata"].get("brain_id", ''),
                "external_id": item_data[0]["metadata"].get("external_id", ''),
            }
        }

    async def process_image_downloads(self, response_json_image: List) -> Tuple[List[str], List[str]]:
        """
        Process image downloads and return paths and filenames.
        
        Args:
            response_json_image: List of image search results
            
        Returns:
            Tuple of (downloaded_image_paths, list_of_filenames)
        """
        download_and_encode_tasks = [
            self.async_download_from_storage(i[0]["metadata"].get("image_path"))
            for i in response_json_image if i[0]["metadata"].get("image_path")
        ]
        downloaded_image_paths = await asyncio.gather(*download_and_encode_tasks)
        
        list_of_filenames = []
        for i in response_json_image:
            image_name = i[0].get("metadata").get('image_path', '').split('/')[-1]
            filename = i[0].get("metadata").get('source', '')
            list_of_filenames.append(f"imagename {image_name} sourced from this {filename}")
        
        return downloaded_image_paths, list_of_filenames

    async def process_downloaded_images(self, downloaded_image_paths: List[str]) -> List[Tuple[str, bytes]]:
        """
        Process downloaded images into base64 encoded format.
        
        Args:
            downloaded_image_paths: List of local image paths
            
        Returns:
            List of (mime_type, image_data) tuples
        """
        raw_imgs = []
        for image_path_local in downloaded_image_paths:
            try:
                async with aiofiles.open(image_path_local, "rb") as f:
                    image_data = await f.read()
                    mime, _ = ("image/jpeg", None)
                    raw_imgs.append((mime, image_data))
            except Exception as e:
                logger.error(f"Failed to process image {image_path_local}: {str(e)}")
                continue
        return raw_imgs

    @staticmethod
    def wrap_images(raw_items: List[Tuple[str, bytes]]) -> List[Dict[str, str]]:
        """
        Wrap raw image data into base64 encoded format.
        
        Args:
            raw_items: Iterable of (mime, bytes) tuples
            
        Returns:
            List of dictionaries with mime and base64 data
        """
        wrapped = []
        for mime, raw in raw_items:
            try:
                b64 = base64.b64encode(raw).decode("ascii")
                wrapped.append({"mime": mime, "data": b64})
            except Exception as e:
                logger.error(f"Failed to encode image: {str(e)}")
                continue
        return wrapped

    @staticmethod
    def filter_ids(filters: Dict, attribute_mapping: Dict) -> Set[str]:
        """
        Filter IDs based on provided filters and attribute mapping.

        Args:
            filters: Dictionary of filters to apply
            attribute_mapping: Mapping of attributes to IDs

        Returns:
            Set of matching IDs
        """
        # If an 'id' filter is provided, use only that filter
        if "id" in filters and filters["id"] is not None:
            values = filters["id"]
            if not isinstance(values, list):
                values = [values]
            matching_ids = set()
            # Look up matching UUIDs based solely on the 'id' attribute
            for value in values:
                if value in attribute_mapping.get("id", {}):
                    matching_ids.update(attribute_mapping["id"][value])
                else:
                    logger.warning(f"Skipping invalid 'id' filter value: {value}")
            return matching_ids

        # Process all filters
        matching_ids = set()
        for attribute, values in filters.items():
            if values is None:
                continue
            if not isinstance(values, list):
                values = [values]

            # Check if attribute exists in mapping
            if attribute not in attribute_mapping:
                logger.warning(f"Skipping unknown filter attribute: '{attribute}' with value(s): {values}")
                continue

            attr_mapping = attribute_mapping[attribute]
            for value in values:
                if value in attr_mapping:
                    matching_ids.update(attr_mapping[value])
                else:
                    logger.warning(f"Skipping invalid value for '{attribute}': '{value}' (not in attribute_mapping)")

        return matching_ids

    async def post_vectorstore(self, token: str, payload: Dict,
                             endpoint: str = "vectorstores/similarity-search-with-score") -> List:
        """
        Post request to vectorstore API with support for different search types.

        Args:
            token: Authentication token (not used for local calls)
            payload: Request payload
            endpoint: API endpoint (not used for local calls)

        Returns:
            API response data (formatted to match external API response)

        Raises:
            Exception: If request fails
        """
        try:
            # Extract parameters from payload
            collection_name = payload.get("collection_name")
            query = payload.get("query")
            top_k = payload.get("top_k", 4)
            filter_dict = payload.get("filter", {})
            search_type = payload.get("search_type", "vector_search")

            user_id = payload.get("user_id", "local_search_user")

            # Call appropriate search function based on search_type
            logger.info(f"Making {search_type} call: collection={collection_name}, query='{query[:50]}...', top_k={top_k}")

            if search_type == "hybrid_search":
                # Use hybrid search (vector + full-text with RRF)
                result = await hybrid_search_with_score_task_async(
                    collection_name=collection_name,
                    query=query,
                    top_k=top_k,
                    filter=filter_dict,
                    rrf_k=60,  # Default RRF parameter
                    user_id=user_id
                )
            else:
                # Default to vector search
                result = await similarity_search_with_score_task_async(
                    collection_name, query, top_k, filter_dict, user_id
                )

            # The result is already in the correct format: [(document_dict, score), ...]
            # The decorator converts Document objects to dict format
            logger.info(f"Search returned {len(result)} results")
            return result

        except Exception as e:
            logger.error(f"Vectorstore search failed: {str(e)}")
            raise

    @staticmethod
    def validate_metadata(item: Dict, required_fields: List[str]) -> bool:
        """
        Validate that an item contains required metadata fields.
        
        Args:
            item: Item to validate
            required_fields: List of required field names
            
        Returns:
            bool: True if all required fields are present
        """
        metadata = item.get("metadata", {}) if isinstance(item, dict) else {}
        return all(field in metadata for field in required_fields)

    @staticmethod
    def extract_filename_from_path(file_path: str) -> str:
        """
        Extract filename from a file path.
        
        Args:
            file_path: Full file path
            
        Returns:
            Filename without path
        """
        return os.path.basename(file_path) if file_path else ""

    @staticmethod
    def ensure_directory_exists(directory_path: str) -> None:
        """
        Ensure that a directory exists, create it if it doesn't.
        
        Args:
            directory_path: Path to directory
        """
        try:
            os.makedirs(directory_path, exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create directory {directory_path}: {str(e)}")
            raise


# Factory function for creating CommonHelpers instance
def create_common_helpers(file_path: str = "./tmp") -> CommonHelpers:
    """
    Factory function to create a CommonHelpers instance.
    
    Args:
        file_path: Base path for file operations
        
    Returns:
        CommonHelpers instance
    """
    return CommonHelpers(file_path=file_path)
