"""Class Elastic search store"""

from typing import Any, Callable, Dict, List, Literal, Optional, Tuple, Union

from elasticsearch._sync.client import Elasticsearch
from langchain_community.vectorstores.elasticsearch import (
    ApproxRetrievalStrategy,
    BaseRetrievalStrategy,
    ElasticsearchStore,
)
from langchain_community.vectorstores.utils import DistanceStrategy
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from src.logger.logging import get_logger

from .search_types import SearchType

logger = get_logger(__name__)


class IdMetadataElasicSearchStore(ElasticsearchStore):
    def _search(
        self,
        query: Optional[str] = None,
        k: int = 4,
        query_vector: Union[List[float], None] = None,
        fetch_k: int = 50,
        fields: Optional[List[str]] = None,
        filter: Optional[List[dict]] = None,
        custom_query: Optional[Callable[[Dict, Union[str, None]], Dict]] = None,
        doc_builder: Optional[Callable[[Dict], Document]] = None,
        **kwargs: Any,
    ) -> List[Tuple[Document, float]]:
        """Return Elasticsearch documents most similar to query, along with scores.

        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.
            query_vector: Embedding to look up documents similar to.
            fetch_k: Number of candidates to fetch from each shard.
                    Defaults to 50.
            fields: List of fields to return from Elasticsearch.
                    Defaults to only returning the text field.
            filter: Array of Elasticsearch filter clauses to apply to the query.
            custom_query: Function to modify the Elasticsearch
                         query body before it is sent to Elasticsearch.

        Returns:
            List of Documents most similar to the query and score for each
        """
        logger.debug(f"Searching for {query} in {self.index_name}")
        if fields is None:
            fields = []

        if "metadata" not in fields:
            fields.append("metadata")

        if self.query_field not in fields:
            fields.append(self.query_field)

        if self.embedding and query is not None:
            query_vector = self.embedding.embed_query(query)
        query_body = self.strategy.query(
            query_vector=query_vector,
            query=query,
            k=k,
            fetch_k=fetch_k,
            vector_query_field=self.vector_query_field,
            text_field=self.query_field,
            filter=filter or [],
            similarity=self.distance_strategy,
        )

        logger.debug(f"Query body: {query_body}")

        if custom_query is not None:
            query_body = custom_query(query_body, query)
            logger.debug(f"Calling custom_query, Query body now: {query_body}")
        # Perform the kNN search on the Elasticsearch index and return the results.
        response = self.client.search(
            index=self.index_name,
            **query_body,
            size=k,
            source=fields,  # type: ignore
        )

        def default_doc_builder(hit: Dict) -> Document:
            document = Document(
                page_content=hit["_source"].get(self.query_field, ""),
                metadata=hit["_source"]["metadata"],
            )
            document.metadata["id"] = hit["_id"]
            return document

        doc_builder = doc_builder or default_doc_builder

        docs_and_scores = []
        for hit in response["hits"]["hits"]:
            for field in fields:
                if field in hit["_source"] and field not in [
                    "metadata",
                    self.query_field,
                ]:
                    if "metadata" not in hit["_source"]:
                        hit["_source"]["metadata"] = {}
                    hit["_source"]["metadata"][field] = hit["_source"][field]

            docs_and_scores.append(
                (
                    doc_builder(hit),
                    hit["_score"],
                )
            )
        logger.debug(f"Found {len(docs_and_scores)} documents")
        logger.debug(f"Documents: {docs_and_scores}")
        return docs_and_scores


class CustomElasticSearchStore(IdMetadataElasicSearchStore):
    def __init__(
        self,
        index_name: str,
        *,
        embedding: Optional[Embeddings] = None,
        es_connection: Optional[Elasticsearch] = None,
        es_url: Optional[str] = None,
        es_cloud_id: Optional[str] = None,
        es_user: Optional[str] = None,
        es_api_key: Optional[str] = None,
        es_password: Optional[str] = None,
        vector_query_field: str = "vector",
        query_field: str = "text",
        distance_strategy: Optional[
            Literal[
                DistanceStrategy.COSINE,
                DistanceStrategy.DOT_PRODUCT,
                DistanceStrategy.EUCLIDEAN_DISTANCE,
            ]
        ] = None,
        strategy: BaseRetrievalStrategy = ApproxRetrievalStrategy(),
        search_type: SearchType = SearchType.VECTOR,
        es_params: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(
            index_name=index_name,
            embedding=embedding,
            es_connection=es_connection,
            es_url=es_url,
            es_cloud_id=es_cloud_id,
            es_user=es_user,
            es_api_key=es_api_key,
            es_password=es_password,
            vector_query_field=vector_query_field,
            query_field=query_field,
            distance_strategy=distance_strategy,
            strategy=strategy,
            es_params=es_params,
        )
        self.search_type = search_type

    def _full_text_search(
        self, query: str, k: int, filter_list: Optional[List[dict]] = None
    ) -> List[Tuple[Document, float]]:
        if filter_list is None:
            filter_list = []
        """Keyword and fuzzy search"""
        search_query = {
            "query": {
                "bool": {
                    "should": [{"match": {"text": query}}],
                    "filter": filter_list,
                }
            },
            "size": k,
        }

        response = self.client.search(index=self.index_name, body=search_query)
        docs_and_scores = []
        for hit in response["hits"]["hits"]:
            doc = Document(page_content=hit["_source"]["text"], metadata=hit["_source"]["metadata"])
            doc.metadata["id"] = hit["_id"]
            docs_and_scores.append((doc, hit["_score"]))
        return docs_and_scores

    def _search(
        self,
        query: Optional[str] = None,
        k: int = 4,
        query_vector: Union[List[float], None] = None,
        fetch_k: int = 50,
        fields: Optional[List[str]] = None,
        filter: Optional[List[dict]] = None,
        custom_query: Optional[Callable[[Dict, Union[str, None]], Dict]] = None,
        doc_builder: Optional[Callable[[Dict], Document]] = None,
        **kwargs: Any,
    ) -> List[Tuple[Document, float]]:
        if self.search_type == SearchType.VECTOR:
            return super()._search(
                query=query,
                k=k,
                query_vector=query_vector,
                fetch_k=fetch_k,
                fields=fields,
                filter=filter,
                custom_query=custom_query,
                doc_builder=doc_builder,
                **kwargs,
            )
        elif self.search_type == SearchType.FULL_TEXT:
            if query is None:
                raise ValueError("Query cannot be None for keyword search")
            return self._full_text_search(query=query, k=k, filter_list=filter)
        else:
            raise ValueError("Invalid search type")

    def drop(self):
        """Drop the index"""
        self.client.indices.delete(index=self.index_name)
