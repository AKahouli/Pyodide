import re

LOCAL_ID_PATTERN = re.compile(r"^[a-z0-9-]{1,64}$")


def runtime_node_id(parent_node_id: str, subgraph_id: str, local_node_id: str) -> str:
    if not LOCAL_ID_PATTERN.fullmatch(local_node_id):
        raise ValueError(f"Invalid generated local node id: {local_node_id}")
    if "::" in subgraph_id or not subgraph_id:
        raise ValueError("Invalid runtime subgraph id")
    return f"{parent_node_id}::dynamic-reasoning::{subgraph_id}::{local_node_id}"
