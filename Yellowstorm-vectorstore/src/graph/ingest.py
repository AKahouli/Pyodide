from src.PathRAG import PathRAG
from src.PathRAG.utils import EmbeddingFunc
from src.graph.custompathrag import llm_model_func, embedding_func
from src.logger.logging import get_logger
from src.graph.graph_helpers import generate_graph_html
import os
from functools import partial

logger = get_logger("api.main")


def generate_pathrag_graph(file_path, graph_directory, embedding_dimension,user_id="unknown"):
    # Create the graph_directory if it doesn't exist
    if not os.path.exists(graph_directory):
        os.makedirs(graph_directory)
    else:
        logger.info(f"Directory already exists: {graph_directory}")

    # Create user-bound versions of the functions
    user_llm_func = partial(llm_model_func, user_id=user_id)
    user_embedding_func = partial(embedding_func, user_id=user_id)

    rag = PathRAG(
        working_dir=graph_directory,
        llm_model_func=user_llm_func,
        embedding_func=EmbeddingFunc(
            embedding_dim=embedding_dimension,
            max_token_size=8192,
            func=user_embedding_func,
        ),
    )

    with open(file_path, encoding="utf-8") as book1:
        rag.insert([book1.read()])
    generate_graph_html(graph_directory+"/graph_chunk_entity_relation.graphml","graph",graph_directory )
    return graph_directory