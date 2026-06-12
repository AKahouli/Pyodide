from src.logger.logging import get_logger
from src.config.settings import get_settings
from src.graph.graph_helpers import colors2Community
import pandas as pd
from typing import List
import seaborn as sns
import random
import networkx as nx
from pyvis.network import Network
import numpy as np
import uuid
import time
import re2 as re

app_settings = get_settings()
logger = get_logger("api.main")
palette = "hls"

def chunks2df(chunks:List)->pd.DataFrame:
    try:
        chunk_ids = []
        page_contents = []
        titles = []
        metadata = []

        for doc in chunks:
            doc.metadata.pop('creationDate', None)
            doc.metadata.pop('modDate', None)
            if not("file_path" in doc.metadata):
                doc.metadata["file_path"] = doc.metadata["external_id"]

            chunk_ids.append(str(uuid.uuid4()))
            page_contents.append(doc.page_content.strip())
            titles.append(doc.metadata['title'])
            metadata.append(doc.metadata)

        df = pd.DataFrame({
            'chunk_id': chunk_ids,
            'text': page_contents,
            'title': titles,
            'metadata': metadata,
            'count' : 4
        })

        return df
    except Exception as e:
        logger.exception(f"error occured in chunks2df: {e}")

def get_chunks_dataframe(df1: pd.DataFrame, df2: pd.DataFrame) -> pd.DataFrame:
    merged_df = pd.merge(df1, df2[["text", "chunk_id", "metadata", "title"]], on="chunk_id", how="inner")
    merged_df.rename(columns={"text": "chunk"}, inplace=True)
    unique_chunks_df = merged_df.drop_duplicates(subset="chunk_id")
    unique_chunks_df.reset_index(drop=True, inplace=True)
    return unique_chunks_df[["chunk_id", "chunk", "metadata", "title"]]


    
    
    
    
       
def get_titles(df:pd.DataFrame)->pd.DataFrame:
    try:
        df_p1 = df[df['title'] == 'No Title'].copy()
        df_parents = pd.DataFrame(columns=['chunk_id', 'title', 'text', 'parent'])

        for idx, row in df[df['title'] != 'No Title'].iterrows():
            chunk_id = row['chunk_id']
            chunk = row['chunk']
            title = row['title']
            
            pattern = r'(?<=\s{3})(?=[A-Z0-9])'
            split_chunks = re.split(pattern, chunk)
            print(split_chunks)
            for i in range(0, len(split_chunks) - 1, 2):
                p = i + 2 if i == 0 else (i if i == 2 else i - 1)
                new_row = pd.DataFrame({
                    'chunk_id': [chunk_id],
                    'chunk': row['chunk'],
                    'title': [split_chunks[i].strip()],
                    'text': [split_chunks[i+1].strip()],
                    'parent': [f'P{p}']
                })
                df_parents = pd.concat([df_parents, new_row], ignore_index=True)


        df_parents = add_parent_chunk_id(df_p1, df_parents)
        return df_p1, df_parents
    except Exception as e:
        logger.exception(f"error occured in get_titles: {e}")   

def get_parent_id(input_str):
    if not input_str or not isinstance(input_str, str):
        return None

    parent_id = input_str[1:]
    try:
        return int(parent_id)
    except ValueError:
        return None

def add_parent_chunk_id(df_p1, df_parents):
  try:
    for idx, row in df_parents.iterrows():
      if get_parent_id(row["parent"]) == 2:
        df_parents.at[idx, 'parent_chunk_id'] = df_p1["chunk_id"][0]

      parent_id = get_parent_id(row['parent'])
      if parent_id is not None:
          previous_parent_id = parent_id - 1
          previous_parent_str = f'P{previous_parent_id}'
          
          previous_row = df_parents[(df_parents['chunk_id'] == row['chunk_id']) & (df_parents['parent'] == previous_parent_str)]
          if not previous_row.empty:
              df_parents.at[idx, 'parent_chunk_id'] = previous_row.iloc[0]['chunk_id']

    return df_parents

  except Exception as e:
    logger.exception(f"error occured in add_parent_chunk_id: {e}")   
    
def construct_network_sm(
    input_brain_id: str,
    graph_output_name: str,
    df_chunks: pd.DataFrame,
    df_nodes: pd.DataFrame,
    df_edges: pd.DataFrame,
) -> nx.Graph:
    try:
        constructed_graph_path = rf"{app_settings.TEMP_FOLDER}/{graph_output_name}.html"
        G_chunk = nx.Graph()
        G_nodes = nx.Graph()
        whole_graph = nx.Graph()
        
        for index, row in df_chunks.iterrows():
            chunk_id = row["chunk_id"]
            metadata = row["metadata"]
            G_chunk.add_node(
                str(row["chunk"])
                .replace("\x92", " ")
                .replace("\x9c", " ")
                .replace("\x96", "")
                .replace("\x85", " ")
                .replace("\x91", " "),
                id_chunk=str(chunk_id),
                brain_id=input_brain_id,
                metadata=str(metadata),
                type="chunk",
            )
        
        
        whole_graph.add_nodes_from(G_chunk.nodes(data=True))  
        for u, v, data in G_chunk.edges(data=True):
            attr = {k: v for k, v in data.items()}
            whole_graph.add_edge(u, v, **attr)
            
            
        for node, attr in df_nodes:
            G_nodes.add_node(
                str(node)
                .replace("\x92", " ")
                .replace("\x9c", " ")
                .replace("\x96", "")
                .replace("\x85", " ")
                .replace("\x91", " "),
                brain_id=input_brain_id,
                type="node",
                **attr,
            )
            
        for index, row in df_edges.iterrows():
            chunk_id = row["chunk_id"]
            G_nodes.add_edge(
                str(row["node_1"])
                .replace("\x92", " ")
                .replace("\x9c", " ")
                .replace("\x96", "")
                .replace("\x85", " ")
                .replace("\x91", " "),
                str(row["node_2"])
                .replace("\x92", " ")
                .replace("\x9c", " ")
                .replace("\x96", "")
                .replace("\x85", " ")
                .replace("\x91", " "),
                title=row["edge"]
                .replace("\x92", " ")
                .replace("\x9c", " ")
                .replace("\x96", "")
                .replace("\x85", " ")
                .replace("\x91", " "),
                weight=row["count"] / 4,
                brain_id=input_brain_id,
                id_chunk=str(chunk_id),
            )

        whole_graph.add_nodes_from(G_nodes.nodes(data=True))  
        for u, v, data in G_nodes.edges(data=True):
            attr = {k: v for k, v in data.items()}
            whole_graph.add_edge(u, v, **attr)
            
        for node1, data1 in whole_graph.nodes(data=True):
            if data1.get('type') == 'chunk':
                for node2, data2 in whole_graph.nodes(data=True):
                    if node1 != node2 and data2.get('type') == 'node' and data1.get('brain_id') == data2.get('brain_id') and data1.get('id_chunk') == data2.get('id_chunk'):
                        whole_graph.add_edge(node1, node2)   
        
        for index, row in df_chunks.iterrows():
            chunk_id = row["chunk_id"]
            metadata = row["metadata"]
            G_nodes.add_node(
                str(row["title"])
                .replace("\x92", " ")
                .replace("\x9c", " ")
                .replace("\x96", "")
                .replace("\x85", " ")
                .replace("\x91", " "),
                chunk=str(row["chunk"])
                .replace("\x92", " ")
                .replace("\x9c", " ")
                .replace("\x96", "")
                .replace("\x85", " ")
                .replace("\x91", " "),
                id_chunk=str(chunk_id),
                brain_id=input_brain_id,
                metadata=str(metadata),
                type="chunk",
            )

        
        for node in G_nodes.nodes(data=True):
            node_id = node[0]
            node_attrs = node[1]
            id_chunk = node_attrs.get("id_chunk")
            node_type = node_attrs.get("type")

            for other_node in G_nodes.nodes(data=True):
                other_node_id = other_node[0]
                other_node_attrs = other_node[1]
                other_id_chunk = other_node_attrs.get("id_chunk")
                other_node_type = other_node_attrs.get("type")  
                if id_chunk == other_id_chunk and ((node_type == "chunk" and other_node_type == "node") or (node_type == "node" and other_node_type == "chunk")):
                    G_nodes.add_edge(node_id, other_node_id, weight=1, brain_id=input_brain_id, id_chunk=str(chunk_id))

        
        
        communities_generator = nx.community.girvan_newman(G_nodes)
        top_level_communities = next(communities_generator)
        next_level_communities = next(communities_generator)
        communities = sorted(map(sorted, next_level_communities))

        colors = colors2Community(communities)
        colors["node"].replace("\x92", " ").replace("\x9c", " ")

        for index, row in colors.iterrows():
            G_nodes.nodes[row["node"]]["group"] = row["group"]
            G_nodes.nodes[row["node"]]["color"] = row["color"]
            G_nodes.nodes[row["node"]]["size"] = G_nodes.degree[row["node"]]

        
        constructed_graphml_path = rf"{app_settings.TEMP_FOLDER}/{graph_output_name}.graphml"
        nx.write_graphml(whole_graph, constructed_graphml_path)
        net = Network(
            notebook=False,
            cdn_resources="remote",
            height="900px",
            width="100%",
            select_menu=True,
            filter_menu=False,
        )
        net.from_nx(G_nodes)
        net.force_atlas_2based(central_gravity=0.015, gravity=-31)
        net.show_buttons(filter_=["physics"])
        net.save_graph(constructed_graph_path)
        return constructed_graph_path, constructed_graphml_path
    except Exception as e:
        logger.exception(f"error occured in construct_network_sm: {e}")
        raise e