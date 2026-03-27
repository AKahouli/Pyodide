"""
Web Search Module

Provides web search functionality using the LinkUp API.
Optimized for parallel execution with async/await support.
"""

import asyncio
from typing import Literal, Optional, Dict, List
from typing_extensions import cast
from linkup import LinkupClient
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.tools.web_search")
settings = get_settings()


class WebSearchTool:
    """
    Web search tool using LinkUp API for external web searches.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize WebSearchTool with API key.
        
        Args:
            api_key: LinkUp API key (uses settings if not provided)
        """
        self.api_key = api_key or settings.lINKUP_API_KEY
        self.client = LinkupClient(api_key=self.api_key)
        
    async def perform_web_search(self, query: str) -> Dict:
        """
        Performs a web search using the LinkUp API.

        This function is optimized for parallel execution - call multiple times for different queries.

        Args:
            query: Search query string

        Returns:
            Dict with 'text' (formatted response) and 'sources' (structured list)
        """
        # Yield control to allow parallel execution
        await asyncio.sleep(0)
        return await self.web_search(query)

    async def web_search(self, query: str, search_web: str = "standard") -> Dict:
        """
        Execute web search with specified depth.

        Args:
            query: The search query
            search_web: Search mode ("standard", "deep", or "off")

        Returns:
            Dict with 'text' (formatted response for agent) and 'sources' (structured list)
        """
        try:
            search_mode = Literal["standard", "deep"]

            if search_web != "off":
                search_web = "deep" if search_web == "deep" else "standard"
                depth: search_mode = cast(search_mode, search_web)
            else:
                depth: search_mode = "standard"

            res = await self.client.async_search(
                query=query,
                depth=depth,
                output_type="sourcedAnswer",
            )

            # Format text response for agent (unchanged behavior)
            text_response = self._format_search_response(res)

            # Extract structured sources
            sources = self._extract_sources(res, query)

            # Return both text and sources
            return {
                "text": text_response,
                "sources": sources
            }

        except Exception as e:
            logger.error(f"Web search failed for query '{query}': {str(e)}")
            return {
                "text": f"Web search error: {str(e)}",
                "sources": []
            }

    def _format_search_response(self, response) -> str:
        """
        Format the search response from LinkUp API.

        Args:
            response: LinkUp API response object

        Returns:
            Formatted response string with answer and sources
        """
        full_response = ""

        if hasattr(response, 'answer') and response.answer:
            full_response += response.answer

        if hasattr(response, 'sources') and response.sources:
            full_response += "\n\nSources:\n"
            for source in response.sources:
                full_response += f"🔗 {source}\n"

        return full_response

    def _extract_sources(self, response, query: str) -> List[Dict[str, str]]:
        """
        Extract structured sources from LinkUp API response.

        Args:
            response: LinkUp API response object
            query: The search query used

        Returns:
            List of dicts with 'title' and 'url' keys
        """
        sources = []

        if hasattr(response, 'sources') and response.sources:
            for source in response.sources:
                try:
                    # Check if source is a LinkupSource object with attributes
                    if hasattr(source, 'url') and hasattr(source, 'name'):
                        # Use name and url from LinkupSource object
                        title = source.name if source.name else query
                        url = source.url

                        sources.append({
                            "title": title,
                            "url": url
                        })
                    elif isinstance(source, str):
                        # Fallback: source is a plain URL string
                        from urllib.parse import urlparse
                        parsed = urlparse(source)
                        domain = parsed.netloc.replace('www.', '')
                        title = domain.split('.')[0].capitalize() if domain else query

                        sources.append({
                            "title": title,
                            "url": source
                        })
                    else:
                        logger.warning(f"Unknown source type: {type(source)}")

                except Exception as e:
                    logger.warning(f"Failed to parse source {source}: {e}")
                    # Try to extract what we can
                    if hasattr(source, 'url'):
                        sources.append({
                            "title": query,
                            "url": source.url
                        })

        return sources

    async def search_with_filters(self, query: str, depth: str = "standard", 
                                output_type: str = "sourcedAnswer") -> Dict:
        """
        Perform web search with custom filters.
        
        Args:
            query: Search query
            depth: Search depth ("standard" or "deep")
            output_type: Type of output requested
            
        Returns:
            Dictionary with search results
        """
        try:
            search_mode = Literal["standard", "deep"]
            depth_typed: search_mode = cast(search_mode, depth if depth in ["standard", "deep"] else "standard")
            
            res = await self.client.async_search(
                query=query,
                depth=depth_typed,
                output_type=output_type,
            )
            
            return {
                "answer": getattr(res, 'answer', ''),
                "sources": getattr(res, 'sources', []),
                "query": query,
                "depth": depth,
                "success": True
            }
            
        except Exception as e:
            logger.error(f"Filtered web search failed: {str(e)}")
            return {
                "answer": "",
                "sources": [],
                "query": query,
                "depth": depth,
                "success": False,
                "error": str(e)
            }

    def get_search_capabilities(self) -> Dict:
        """
        Get information about web search capabilities.
        
        Returns:
            Dictionary with capability information
        """
        return {
            "provider": "LinkUp API",
            "supported_depths": ["standard", "deep"],
            "output_types": ["sourcedAnswer"],
            "features": [
                "Real-time web search",
                "Source attribution", 
                "Depth control",
                "Answer synthesis"
            ]
        }

    async def validate_api_key(self) -> bool:
        """
        Validate the API key by performing a test search.
        
        Returns:
            bool: True if API key is valid
        """
        try:
            test_query = "test"
            await self.client.async_search(query=test_query, depth="standard")
            return True
        except Exception as e:
            logger.error(f"API key validation failed: {str(e)}")
            return False


# Legacy function for backward compatibility
async def web_search(query: str, search_web: str = "standard") -> str:
    """
    Legacy web search function for backward compatibility.
    
    Args:
        query: Search query
        search_web: Search depth
        
    Returns:
        Search results
    """
    tool = WebSearchTool()
    return await tool.web_search(query, search_web)


# Factory function for creating web search tools
def create_web_search_tool(api_key: Optional[str] = None) -> WebSearchTool:
    """
    Factory function to create a WebSearchTool instance.
    
    Args:
        api_key: Optional API key
        
    Returns:
        WebSearchTool instance
    """
    return WebSearchTool(api_key=api_key)