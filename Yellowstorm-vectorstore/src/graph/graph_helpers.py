import secrets
import shutil
import uuid
import numpy as np
import pandas as pd
import seaborn as sns

from src.config.settings import get_settings
from src.logger.logging import get_logger

app_settings = get_settings()
logger = get_logger("api.main")
palette = "hls"





import networkx as nx
from pyvis.network import Network
import os

def generate_graph_html(graphml_path: str, graph_output_name: str, temp_folder: str) -> str:
    """
    Constructs an interactive HTML visualization from a GraphML file.
    This version cleans node IDs and sets them as both the internal ID and label,
    ensuring the search/select menu works properly.

    :param graphml_path: Path to the input GraphML file.
    :param graph_output_name: Desired name for the output HTML file (without extension).
    :param temp_folder: Directory to save the output HTML file.
    :return: Full path to the generated HTML file.
    """
    try:
        G = nx.read_graphml(graphml_path)

        constructed_graph_path = os.path.join(temp_folder, f"{graph_output_name}.html")

        net = Network(
            notebook=False,
            cdn_resources="remote",
            height="900px",
            width="100%",
            select_menu=True,
            filter_menu=False
        )

        id_mapping = {}
        for node_id, node_data in G.nodes(data=True):
            clean_id = node_id.replace('&quot;', '"').strip('"')
            id_mapping[node_id] = clean_id
            net.add_node(clean_id, label=clean_id, **node_data)

        for source, target, edge_data in G.edges(data=True):
            new_source = id_mapping.get(source, source)
            new_target = id_mapping.get(target, target)
            net.add_edge(new_source, new_target, **edge_data)

        net.force_atlas_2based(central_gravity=0.015, gravity=-31)
        net.show_buttons(filter_=["physics"])

        net.save_graph(constructed_graph_path)

        return constructed_graph_path

    except Exception as e:
        logger.exception(f"Error occurred while constructing HTML from GraphML: {e}")
        raise e

def get_chunks_dataframe(df1: pd.DataFrame, df2: pd.DataFrame) -> pd.DataFrame:
    merged_df = pd.merge(df1, df2[["text", "chunk_id", "metadata", "title"]], on="chunk_id", how="inner")
    merged_df.rename(columns={"text": "chunk"}, inplace=True)
    unique_chunks_df = merged_df.drop_duplicates(subset="chunk_id")
    unique_chunks_df.reset_index(drop=True, inplace=True)
    return unique_chunks_df[["chunk_id", "chunk", "metadata"]]


def documents2Dataframe(documents) -> pd.DataFrame:
    logger.info(f"Starting chunking documents to dataframe")
    rows = []
    for chunk in documents:
        chunk.metadata.pop('creationDate', None)
        chunk.metadata.pop('modDate', None)
        if "file_path" in chunk.metadata:
            chunk.metadata["file_path"] = chunk.metadata["file_path"].split("\\")[-1]
        else:
            chunk.metadata["file_path"] = chunk.metadata["source"].split("\\")[-1]

        row = {
            "text": chunk.page_content,
            **chunk.metadata,
            "chunk_id": uuid.uuid4().hex,
            "metadata": chunk.metadata
        }
        rows = rows + [row]

    df = pd.DataFrame(rows)
    df["text"] = (
        df["text"]
        .replace("\x92", " ")
        .replace("\x9c", " ")
        .replace("\x96", "")
        .replace("\x85", " ")
        .replace("\x91", " ")
    )
    logger.info(f"Chunking documents to dataframe done")
    return df





def graph2Df(nodes_list) -> pd.DataFrame:
    try:
        graph_dataframe = pd.DataFrame(nodes_list).replace(" ", np.nan)
        graph_dataframe = graph_dataframe.dropna(subset=["node_1", "node_2"])
        graph_dataframe["node_1"] = graph_dataframe["node_1"].apply(lambda x: x.lower())
        graph_dataframe["node_2"] = graph_dataframe["node_2"].apply(lambda x: x.lower())
        return graph_dataframe
    except Exception as e:
        logger.exception(f"error occured in graph2Df: {e}")


## Now add these colors to communities and make another dataframe
def colors2Community(communities) -> pd.DataFrame:
    p = sns.color_palette(palette, len(communities)).as_hex()
    indexes = list(range(len(p)))
    shuffled_p = []
    while indexes:
        # Use secrets for cryptographically secure random selection
        idx = secrets.randbelow(len(indexes))
        selected_idx = indexes.pop(idx)
        shuffled_p.append(p[selected_idx])
    p = shuffled_p
    rows = []
    group = 0
    for community in communities:
        color = p.pop()
        group += 1
        for node in community:
            rows += [{"node": node, "color": color, "group": group}]
    df_colors = pd.DataFrame(rows)
    return df_colors


def contextual_proximity(df: pd.DataFrame) -> pd.DataFrame:
    logger.info(f"Starting calculating contextual proximity")
    dfg_long = pd.melt(
        df, id_vars=["chunk_id"], value_vars=["node_1", "node_2"], value_name="node"
    )
    dfg_long = dfg_long.drop(columns=["variable"])
    dfg_wide = pd.merge(dfg_long, dfg_long, on="chunk_id", suffixes=("_1", "_2"))
    self_loops_drop = dfg_wide[dfg_wide["node_1"] == dfg_wide["node_2"]].index
    dfg2 = dfg_wide.drop(index=self_loops_drop).reset_index(drop=True)
    dfg2 = (
        dfg2.groupby(["node_1", "node_2"])
        .agg({"chunk_id": [",".join, "count"]})
        .reset_index()
    )
    dfg2.columns = ["node_1", "node_2", "chunk_id", "count"]
    dfg2.replace("", np.nan, inplace=True)
    dfg2.dropna(subset=["node_1", "node_2"], inplace=True)
    dfg2 = dfg2[dfg2["count"] != 1]
    dfg2["edge"] = "contextual proximity"
    logger.info(f"Calculating contextual proximity done")
    return dfg2


def get_file_name_from_url(file_url):
    file_name_with_extension = os.path.basename(file_url)
    file_name_without_extension = os.path.splitext(file_name_with_extension)[0]
    return file_name_without_extension


def empty_directory(directory_path):
    if not os.path.isdir(directory_path):
        print(f"{directory_path} n'est pas un répertoire valide.")
        return

    for file_name in os.listdir(directory_path):
        file_path = os.path.join(directory_path, file_name)
        try:
            if os.path.isfile(file_path):
                os.remove(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
            print(f"{file_path} a été supprimé.")
        except Exception as e:
            logger.exception(f"Erreur lors de la suppression de {file_path}: {e}")
