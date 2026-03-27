from typing import List, Dict, Optional, Any
from contextlib import contextmanager
from src.smart_rag.tools.utilities.neo4j_db import Neo4jDb
from src.smart_rag.tools.utilities.semantic_csrd import get_semantic_normes, get_semantic_requirements, \
    get_semantic_exigence_text, filter_extracted_requirements
from openai import OpenAI
from src.config.settings import get_settings
from src.logger.logging import get_logger
import re2

settings = get_settings()
logger = get_logger("api.smart_rag.tools.esg_helpers")

embedding_client = OpenAI(
    base_url=settings.LITELLM_API_BASE_URL,
    api_key=settings.LITELLM_API_SECRET_KEY,
)


@contextmanager
def get_neo4j_connection():
    """
    Context manager for Neo4j database connections.
    Ensures proper connection handling and cleanup.

    :yield: Neo4jDb instance
    :raises Exception: If connection fails
    """
    try:
        with Neo4jDb(settings.NEO4J_HOST, settings.NEO4J_USER, settings.NEO4J_PASSWORD) as db:
            yield db
    except Exception as ex:
        logger.exception(f"Error getting connection to Neo4j: {ex}")
        raise


def execute_neo4j_query(cypher: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Execute a Neo4j query with proper connection management.

    :param cypher: Cypher query to execute
    :param parameters: Optional query parameters
    :return: List of query results
    :raises Exception: If query execution fails
    """
    try:
        with get_neo4j_connection() as db:
            result = db.execute_query(cypher, parameters)
            return result if result else []
    except Exception as ex:
        logger.exception(f"Error executing Neo4j query: {ex}")
        return []


def get_embeddings(query: str) -> List[float]:
    """
    Generate embeddings for a given query using OpenAI API.

    :param query: Text query to embed
    :return: List of embedding values
    :raises Exception: If embedding generation fails
    """
    logger.info("Generating embeddings")
    try:
        embedding = embedding_client.embeddings.create(
            model=settings.EMBEDDING_MODEL,
            input=query,
        )
        logger.info("Embeddings generated successfully")
        return embedding.data[0].embedding
    except Exception as e:
        logger.exception(f"Error generating embeddings: {e}")
        raise


def check_ar(ar: str) -> str:
    logger.info("Validating AR format")
    try:
        pattern = r"^AR \d+\.$"
        if re2.match(pattern, ar):
            logger.info("AR format is already valid")
            return ar

        match = re2.search(r"(\d+)", ar)
        if match:
            corrected_ar = f"AR {match.group(1)}."
            logger.info(f"AR format corrected to: {corrected_ar}")
        else:
            corrected_ar = ""
            logger.info("No valid AR number found, returning empty string")

        return corrected_ar

    except Exception as e:
        logger.exception(f"Error occurred in check_ar: {e}")
        return ""


def get_ar_context(section_context: List[Dict], exigence: List[str], norme_title: str):
    logger.info("Getting AR context")
    try:
        for section in section_context:
            section_exigence = section.get("exigence", "").lower()
            esrs = section.get("esrs", "").lower()
            if section_exigence == exigence[0] and esrs == norme_title.lower().replace("esrs ", ""):
                references = section.get("references", "")
                ar_context = {
                    "ar": section.get("ar", ""),
                    "text": section.get("text", ""),
                    "alphabetical_nodes": section.get("alphabetical_nodes", "")
                }
                return references, ar_context
        # No match found
        return None, None
    except Exception as e:
        logger.exception(f"Error occurred in get_ar_context: {e}")
        return None, None


def get_dp_context(section_context: List[Dict], exigence: List[str], norme_title: str):
    logger.info("Getting DP context")
    try:
        for section in section_context:
            section_exigence = section.get("exigence", "").lower()
            esrs = section.get("esrs", "").lower()
            if exigence and section_exigence == exigence[0] and esrs == norme_title.lower().replace("esrs ", ""):
                references = section.get("references", "")
                dp_context = {
                    "dp": section.get("dp", ""),
                    "text": section.get("text", ""),
                    "alphabetical_nodes": section.get("alphabetical_nodes", "")
                }
                return references, dp_context
    except Exception as e:
        logger.exception(f"Error occurred in get_dp_context: {e}")

    return "", {}


def get_exigence_from_ar(norme_context: List[Dict], ar_context: List[Dict]):
    try:
        norme_title = ""
        norme_extracted_exigences = []
        section_extracted_exigences = []
        for norme in norme_context:
            norme_exigence = norme.get("related_nodes", [])
            norme_title = norme.get("norme_label", "")

            for related_exigence in norme_exigence:
                related_label = related_exigence.get("related_label", "")
                norme_extracted_exigences.append(related_label)

        for section in ar_context:
            section_exigence = section.get("exigence", "").lower()
            section_extracted_exigences.append(section_exigence)

        common_strings = set(norme_extracted_exigences) & set(section_extracted_exigences)
        exigence = list(common_strings)
        references, dp_context = get_ar_context(ar_context, exigence, norme_title)

        return exigence, references, dp_context

    except Exception as e:
        logger.exception(f"Error occurred in get_exigence_from_ar: {e}")
        return [], [], {}


def get_exigence_cible(norme_context: List[Dict], section_context: List[Dict]):
    try:
        norme_title = ""
        norme_extracted_exigences = []
        section_extracted_exigences = []
        for norme in norme_context:
            norme_exigence = norme.get("related_nodes", [])
            norme_title = norme.get("norme_label", "")

            for related_exigence in norme_exigence:
                related_label = related_exigence.get("related_label", "")
                norme_extracted_exigences.append(related_label)

        for section in section_context:
            section_exigence = section.get("exigence", "").lower()
            section_extracted_exigences.append(section_exigence)

        common_strings = set(norme_extracted_exigences) & set(section_extracted_exigences)
        exigence = list(common_strings)
        references, dp_context = get_dp_context(section_context, exigence, norme_title)

        return exigence, references, dp_context
    except Exception as e:
        logger.exception(f"Erreur dans get_exigence_cible: {e}")
        return [], [], {}


def filter_exigence_children(data_point_context: Dict, alphabetical: str, roman: Optional[str] = None) -> Dict:
    """
    Filtre les nœuds 'alphabetical_nodes' en fonction des valeurs 'alphabetical' et 'roman' fournies,
    remplace les anciennes valeurs par les nœuds correspondants et retourne le contexte mis à jour.

    Args:
        data_point_context (Dict): Le dictionnaire contenant les nœuds 'alphabetical_nodes'.
        alphabetical (str): La valeur de 'alphabetical_label' à rechercher.
        roman (Optional[str]): La valeur de 'roman_label' à rechercher (optionnelle).

    Returns:
        Dict: Le contexte mis à jour avec les nœuds correspondants.
    """
    logger.info("Filtering exigence children")
    try:
        alphabeticals = data_point_context.get("alphabetical_nodes", [])
        matched_alphabeticals = []
        for alphabetical_node in alphabeticals:
            if alphabetical_node.get("alphabetical_label", "").lower() == alphabetical.lower():
                if roman:
                    romans = alphabetical_node.get("romans", [])
                    matched_romans = [
                        roman_node for roman_node in romans
                        if roman_node.get("roman_label", "").lower() == roman.lower()
                    ]
                    alphabetical_node["romans"] = matched_romans
                    if matched_romans:
                        matched_alphabeticals.append(alphabetical_node)
                else:
                    matched_alphabeticals.append(alphabetical_node)

        data_point_context["alphabetical_nodes"] = matched_alphabeticals
        return data_point_context

    except Exception as e:
        logger.exception(f"Une erreur est survenue dans filter_exigence_children: {e}")
        return data_point_context.copy() if data_point_context else {}

def detect_pattern_and_extract_args(query: str):
    """
    Analyse la requête pour déterminer le nom de la fonction
    et extraire les arguments : norme, section, alphabetical, roman.

    La requête peut suivre différents formats, par exemple :
    - E1-29
    - E1-29-b
    - E1-29-b-IV
    - E1-AR4
    - E1-AR4-b
    - E1-AR4-b-IV

    Si un segment dépasse 3 caractères (sauf norme/section de type AR4), il est ignoré.
    Returns:
        tuple: (nom_fonction, args)
    """
    logger.info("Detecting pattern and extracting args")
    try:
        cleaned_query = re2.sub(r"\s*-\s*", "-", query.strip().replace("Etape : ", "").replace(" ", "")).replace("ESRS",
                                                                                                                 "")
        parts = cleaned_query.split("-")
        filtered_parts = [part for part in parts[:4] if len(part) <= 3 or re2.match(r"^(E\d+|AR\d+)$", part)]
        if len(filtered_parts) < 2:
            fonction = "semantic_search"
            args = {
                "query": query
            }
            logger.info("Pattern not detected, defaulting to semantic search")
        else:
            norme = filtered_parts[0]
            section = filtered_parts[1]
            alphabetical = filtered_parts[2] if len(filtered_parts) > 2 else None
            roman = filtered_parts[3] if len(filtered_parts) > 3 else None

            if section.upper().startswith("AR"):
                fonction = "ar_patternsearch"
                logger.info(f"Detected AR pattern search for section: {section}")
            else:
                fonction = "num_patternsearch"
                logger.info(f"Detected numerical pattern search for section: {section}")

            args = {
                "norme": norme,
                "section": section,
                "alphabetical": alphabetical,
                "roman": roman
            }

        return fonction, args
    except Exception as e:
        logger.exception(f"Error occurred in detect_pattern_and_extract_args: {e}")


def semantic_search(query: str):
    logger.info("Starting semantic search")
    try:
        embedding = str(get_embeddings(query))
        norme_context = get_semantic_normes(embedding)
        exigences_context = get_semantic_requirements(embedding)
        exigence_text_context = get_semantic_exigence_text(embedding)
        filtred_context = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)
        return filtred_context
    except Exception as e:
        logger.exception(f"Error occurred in semantic_search: {e}")
        "erreur lors de la recuperation du context normatif!"


def ar_patternsearch(norme: str = None, section: str = None, alphabetical: str = None, roman: str = None):
    logger.info("Starting AR pattern search")
    try:
        if norme and section:
            section = check_ar(section)
            normes_context = get_normes(norme)
            section_context = get_ars(section)
            exigences, references_context, data_point_context = get_exigence_from_ar(normes_context, section_context)
            if alphabetical:
                data_point_context = filter_exigence_children(data_point_context, alphabetical, roman)

            extracted_exigences_context = get_exigence(exigences)
            esrs = extracted_exigences_context[0][0]["norme"]
            exigence = f"Exigence title:{extracted_exigences_context[0][0]['exigenceLabel']}"
            result = f"<ESRS>{esrs}</ESRS>\n"
            result += f"<Exigence>{exigence}</Exigence>\n"
            result += f"<DataPoint>{data_point_context}</DataPoint>\n"
            result += f"<References>{references_context}</References>\n"
            return result
    except Exception as e:
        logger.exception(f"Error occurred in ar_patternsearch: {e}")


def num_patternsearch(norme: str = None, section: str = None, alphabetical: str = None, roman: str = None) -> str:
    logger.info("Starting numerical pattern search")
    try:
        if norme and section:
            normes_context = get_normes(norme)
            section_context = get_sections(section)
            exigences, references_context, data_point_context = get_exigence_cible(normes_context, section_context)
            if alphabetical:
                data_point_context = filter_exigence_children(data_point_context, alphabetical, roman)

            extracted_exigences_context = get_exigence(exigences)
            esrs = extracted_exigences_context[0][0]["norme"]
            exigence = f"Exigence title:{extracted_exigences_context[0][0]['exigenceLabel']}"
            result = f"<ESRS>{esrs}</ESRS>\n"
            result += f"<Exigence>{exigence}</Exigence>\n"
            result += f"<DataPoint>{data_point_context}</DataPoint>\n"
            result += f"<References>{references_context}</References>\n"
        return result
    except Exception as e:
        logger.exception(f"Error occurred in num_patternsearch: {e}")


def get_normes(norme: str) -> List:
    logger.info("Executing get_normes query")
    try:
        norme = norme if norme.lower().startswith("esrs") else f"esrs {norme}"
        embedding = str(get_embeddings(norme))
        cypher = """
        WITH """ + embedding + """ AS search_embedding
        CALL db.index.vector.queryNodes('norme_index', 1, search_embedding)
        YIELD node AS topNorme, score

        OPTIONAL MATCH (topNorme)-[:has_exigence]->(relatedNode:exigence)
        OPTIONAL MATCH (relatedNode)-[r:refers_to]->(refersNode:exigence)

        WITH topNorme, score, relatedNode, r, refersNode


        WITH topNorme, score, relatedNode,
            [x IN COLLECT(DISTINCT CASE 
                WHEN refersNode IS NOT NULL 
                THEN {
                    refers_label: refersNode.label,
                    refers_text: refersNode.text,
                    refers_title: r.title
                } 
                ELSE NULL
            END) WHERE x IS NOT NULL] AS refers_to_nodes


        WITH topNorme, score,
            [x IN COLLECT(DISTINCT CASE 
                WHEN relatedNode IS NOT NULL 
                THEN {
                    related_label: relatedNode.label,
                    related_text: relatedNode.text,
                    refers_to_nodes: refers_to_nodes
                } 
                ELSE NULL
            END) WHERE x IS NOT NULL] AS related_nodes

        RETURN 
            topNorme.label AS norme_label, 
            score,
            related_nodes
        ORDER BY score DESC;
        """
        result = execute_neo4j_query(cypher)
        if not result:
            logger.info("No results found")
            return []
        logger.info(f"Query completed, found {len(result)} results")
        return result
    except Exception as e:
        logger.exception(f"Error occurred in get_normes: {e}")
        return []


def get_sections(section: str):
    logger.info("Executing get_sections query")
    try:
        cypher = """
        MATCH (n:numerical)
        WHERE n.label = '""" + section + """'

        OPTIONAL MATCH (n)-[r:refers_to]-(refNode)
        WITH n, COLLECT(DISTINCT {
            reference_title: refNode.label, 
            reference_text: refNode.text, 
            explication: r.title
        }) AS references

        OPTIONAL MATCH (n)-[:has_alphabetical]->(alphaNode:alphabetical)
        OPTIONAL MATCH (alphaNode)-[:has_roman]->(romanNode:roman)
        WITH n, references, alphaNode, COLLECT(DISTINCT {
            roman_label: romanNode.label, 
            roman_text: romanNode.text
        }) AS romans

        WITH n, references, 
            COLLECT(DISTINCT {
                alphabetical_label: alphaNode.label, 
                alphabetical_text: alphaNode.text, 
                romans: romans
            }) AS alphabetical_nodes

        RETURN 
            n.grand_parent AS esrs, 
            n.parent_title AS exigence, 
            n.label AS dp, 
            n.text AS text, 
            references, 
            alphabetical_nodes;
        """
        result = execute_neo4j_query(cypher)
        return result
    except Exception as e:
        logger.exception(f"Error occurred in get_sections: {e}")
        return []


def get_ars(section: str):
    logger.info("Executing get_ars query")
    try:
        cypher = """
        MATCH (n:ar)
        WHERE n.label = '""" + section + """'

        OPTIONAL MATCH (n)-[r:refers_to]-(refNode)
        WITH n, COLLECT(DISTINCT {
            reference_title: refNode.label, 
            reference_text: refNode.text, 
            explication: r.title
        }) AS references

        OPTIONAL MATCH (n)-[:has_alphabetical]->(alphaNode:alphabetical)
        OPTIONAL MATCH (alphaNode)-[:has_roman]->(romanNode:roman)
        WITH n, references, alphaNode, COLLECT(DISTINCT {
            roman_label: romanNode.label, 
            roman_text: romanNode.text
        }) AS romans

        WITH n, references, 
            COLLECT(DISTINCT {
                alphabetical_label: alphaNode.label, 
                alphabetical_text: alphaNode.text, 
                romans: romans
            }) AS alphabetical_nodes

        RETURN 
            n.grand_parent AS esrs, 
            n.parent_title AS exigence, 
            n.label AS ar, 
            n.text AS text,
            references, 
            alphabetical_nodes;
        """
        result = execute_neo4j_query(cypher)
        return result
    except Exception as e:
        logger.exception(f"Error occurred in get_ars: {e}")
        return []


def get_exigence(exigences: List[str]) -> List:
    logger.info("Executing get_exigence query")
    try:
        exigences_data = []

        for exigence in exigences:
            cypher = """
            MATCH (e:exigence) 
            WHERE e.label = '""" + exigence + """'

            OPTIONAL MATCH (e)-[:has_numerical]->(relatedNode:numerical)
            OPTIONAL MATCH (relatedNode)-[:has_alphabetical]->(subRelatedNode:alphabetical)
            OPTIONAL MATCH (subRelatedNode)-[:has_roman]->(subSubRelatedNode:roman)
            OPTIONAL MATCH (e)-[:has_ar]->(relatedAr:ar)
            OPTIONAL MATCH (e)-[r:refers_to]-(refersNode)

            RETURN 
                e.parent_title AS norme,
                e.label AS exigenceLabel, 
                e.text AS exigenceText,

                COLLECT(DISTINCT { data_point: relatedNode.label, content: relatedNode.text }) AS RelatedNodes,
                COLLECT(DISTINCT { alphabetical: subRelatedNode.label, content: subRelatedNode.text }) AS SubRelatedNodes,
                COLLECT(DISTINCT { roman: subSubRelatedNode.label, content: subSubRelatedNode.text }) AS SubSubRelatedNodes,
                COLLECT(DISTINCT { application_requirement: relatedAr.label, text: relatedAr.text }) AS RelatedAr,

                COLLECT(DISTINCT { 
                    reference_title: refersNode.label, 
                    reference_text: refersNode.text, 
                    explication: r.title 
                }) AS RefersToNodes;
            """
            result = execute_neo4j_query(cypher)
            if not result:
                logger.warning(f"No data retrieved for exigence: {exigence}")
                return []

            exigences_data.append(result)

        return exigences_data
    except Exception as e:
        logger.exception(f"Error occurred in get_exigence: {e}")
        return []