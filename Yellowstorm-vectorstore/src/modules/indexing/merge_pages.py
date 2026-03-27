""" Merge pages into a single document """

from typing import Any, List

PAGES_SEPARATOR = "\n"


def get_relevant_metadatas(current_characters_index: int, metadata: dict) -> List[dict]:
    """
    Get relevant metadatas

    Parameters
    ----------
    current_characters_index : int
        Current characters index
    metadata : dict
        Metadata

    Returns
    -------
    List[dict]
        The relevant metadatas
    """
    relevant_metadatas = []
    for key, value in sorted(metadata.items(), key=lambda item: int(item[0])):
        if int(key) > current_characters_index:
            break
        relevant_metadatas.append(value)
        metadata.pop(key)
    return relevant_metadatas


def get_value(values: List[Any]) -> Any:
    if any([isinstance(value, list) for value in values]):
        return list(set([item for sublist in values for item in sublist if sublist is not None]))
    if len(set(values)) == 1:
        return values[0]
    return values[0]
