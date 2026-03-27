from src.logger.logging import get_logger
from src.smart_rag.tools.utilities.neo4j_db import Neo4jDb
from src.config.settings import get_settings
import pandas as pd
from typing import List

logger = get_logger("api.smart_rag.tools.semantic_csrd")
settings = get_settings()


def run_neo4j_query(cypher: str, parameters: dict = None) -> list:
    """
    Execute a Neo4j Cypher query with parameters to prevent injection.

    :param cypher: Cypher query to execute
    :param parameters: Query parameters dictionary
    :return: List of query results
    :raises Exception: If query execution fails
    """
    logger.info("Starting Neo4j query execution")
    try:
        logger.info("Establishing Neo4j database connection")
        with Neo4jDb(settings.NEO4J_HOST, settings.NEO4J_USER, settings.NEO4J_PASSWORD) as db:
            logger.info("Executing Neo4j query")
            result = db.execute_query(cypher, parameters)
            logger.info(f"Neo4j query completed successfully, returned {len(result) if result else 0} results")
            return result
    except Exception as ex:
        logger.exception(f"Error running Neo4j query: {ex}")
        raise


def get_semantic_normes(embedding: str) -> list:
    """
    Search for semantic normes using vector similarity.

    :param embedding: Vector embedding as string representation
    :return: List of matching normes with their exigences
    """
    logger.info("Starting semantic normes search")
    try:
        logger.info("Building semantic normes cypher query")
        cypher = f"""
        WITH """ + embedding + """ AS search_embedding
        CALL db.index.vector.queryNodes('norme_index', 2, search_embedding)
        YIELD node AS topNorme, score

        OPTIONAL MATCH (topNorme)-[:has_exigence]->(exigence:exigence)
        OPTIONAL MATCH (exigence)-[r:refers_to]-(ref:reference)
        OPTIONAL MATCH (exigence)-[:has_ar]->(ar:ar)
        OPTIONAL MATCH (ar)-[:has_alphabetical]->(alpha_ar:alphabetical)
        OPTIONAL MATCH (alpha_ar)-[:has_roman]->(roman_ar:roman)
        OPTIONAL MATCH (exigence)-[:has_numerical]->(num:numerical)
        OPTIONAL MATCH (num)-[:has_alphabetical]->(alpha_num:alphabetical)
        OPTIONAL MATCH (alpha_num)-[:has_roman]->(roman_num:roman)

        WITH topNorme, exigence, ref, r, ar, alpha_ar, roman_ar, num, alpha_num, roman_num

        WITH topNorme, exigence, ref, r, ar, alpha_ar, 
             COLLECT(DISTINCT {roman_label: roman_ar.label, roman_text: roman_ar.text}) AS romans_ar,
             num, alpha_num, 
             COLLECT(DISTINCT {roman_label: roman_num.label, roman_text: roman_num.text}) AS romans_num

        WITH topNorme, exigence,
            COLLECT(DISTINCT {
                reference_title: r.title,
                reference_text: ref.reference_text
            }) AS references,
            COLLECT(DISTINCT {
                ar_label: ar.label,
                alphabetical: {
                    label: alpha_ar.label,
                    romans: romans_ar
                }
            }) AS ar_nodes,
            COLLECT(DISTINCT {
                numerical_label: num.label,
                alphabetical: {
                    label: alpha_num.label,
                    romans: romans_num
                }
            }) AS numerical_nodes

        WITH topNorme, COLLECT(DISTINCT {
            exigence_label: exigence.label,
            exigence_text: exigence.text,
            references: references,
            ar_nodes: ar_nodes,
            numerical_nodes: numerical_nodes
        }) AS exigences

        RETURN 
            topNorme.label AS norme_label,
            exigences
        """
        logger.info("Executing semantic normes query against Neo4j")
        return run_neo4j_query(cypher)
    except Exception as e:
        logger.exception(f"Error in get_semantic_normes: {e}")
        return []


def get_semantic_requirements(embedding: str) -> list:
    """
    Search for semantic requirements using vector similarity.

    :param embedding: Vector embedding as string representation
    :return: List of matching requirements with their details
    """
    logger.info("Starting semantic requirements search")
    try:
        logger.info("Building semantic requirements cypher query")
        cypher = """
        WITH """ + embedding + """ AS search_embedding
        CALL db.index.vector.queryNodes('exigence_index', 4, search_embedding)
        YIELD node AS topExigence, score

        OPTIONAL MATCH (topExigence)-[r:refers_to]-(ref:reference)

        OPTIONAL MATCH (topExigence)-[:has_ar]->(ar:ar)
        OPTIONAL MATCH (ar)-[:has_alphabetical]->(alpha_ar:alphabetical)
        OPTIONAL MATCH (alpha_ar)-[:has_roman]->(roman_ar:roman)

        OPTIONAL MATCH (topExigence)-[:has_numerical]->(num:numerical)
        OPTIONAL MATCH (num)-[:has_alphabetical]->(alpha_num:alphabetical)
        OPTIONAL MATCH (alpha_num)-[:has_roman]->(roman_num:roman)

        WITH topExigence, 
            COLLECT(DISTINCT {
                ar_label: ar.label,
                alphabetical_label: alpha_ar.label,
                roman_label: roman_ar.label,
                roman_text: roman_ar.text
            }) AS ar_flat,
            COLLECT(DISTINCT {
                numerical_label: num.label,
                alphabetical_label: alpha_num.label,
                roman_label: roman_num.label,
                roman_text: roman_num.text
            }) AS num_flat,
            COLLECT(DISTINCT {
                reference_title: r.title,
                reference_text: ref.reference_text
            }) AS references_flat

        WITH topExigence, 
            ar_flat,
            num_flat,
            references_flat,
            [ar IN ar_flat | {
                ar_label: ar.ar_label,
                alphabetical: {
                    label: ar.alphabetical_label,
                    romans: [r IN ar_flat WHERE r.ar_label = ar.ar_label AND r.alphabetical_label = ar.alphabetical_label | {
                        roman_label: r.roman_label,
                        roman_text: r.roman_text
                    }]
                }
            }] AS ar_nodes,
            [n IN num_flat | {
                numerical_label: n.numerical_label,
                alphabetical: {
                    label: n.alphabetical_label,
                    romans: [r IN num_flat WHERE r.numerical_label = n.numerical_label AND r.alphabetical_label = n.alphabetical_label | {
                        roman_label: r.roman_label,
                        roman_text: r.roman_text
                    }]
                }
            }] AS numerical_nodes

        RETURN 
            topExigence.parent_title AS norme_label,
            references_flat AS references,
            topExigence.label AS exigence_label,
            topExigence.text AS exigence_text,
            ar_nodes,
            numerical_nodes
        """
        logger.info("Executing semantic requirements query against Neo4j")
        return run_neo4j_query(cypher)
    except Exception as e:
        logger.exception(f"Error in get_semantic_requirements: {e}")
        return []


def get_semantic_exigence_text(embedding: str) -> list:
    """
    Search for semantic exigence text using vector similarity.

    :param embedding: Vector embedding as string representation
    :return: List of matching exigence text with their details
    """
    logger.info("Starting semantic exigence text search")
    try:
        logger.info("Building semantic exigence text cypher query")
        cypher = """
        WITH """ + embedding + """ AS search_embedding
        CALL db.index.vector.queryNodes('text_index', 5, search_embedding)
        YIELD node AS topExigence, score

        OPTIONAL MATCH (topExigence)-[r:refers_to]-(ref:reference)

        OPTIONAL MATCH (topExigence)-[:has_ar]->(ar:ar)
        OPTIONAL MATCH (ar)-[:has_alphabetical]->(alpha_ar:alphabetical)
        OPTIONAL MATCH (alpha_ar)-[:has_roman]->(roman_ar:roman)

        OPTIONAL MATCH (topExigence)-[:has_numerical]->(num:numerical)
        OPTIONAL MATCH (num)-[:has_alphabetical]->(alpha_num:alphabetical)
        OPTIONAL MATCH (alpha_num)-[:has_roman]->(roman_num:roman)

        WITH topExigence, 
             COLLECT(DISTINCT {
                ar_label: ar.label,
                alphabetical_label: alpha_ar.label,
                roman_label: roman_ar.label,
                roman_text: roman_ar.text
             }) AS ar_flat,
             COLLECT(DISTINCT {
                numerical_label: num.label,
                alphabetical_label: alpha_num.label,
                roman_label: roman_num.label,
                roman_text: roman_num.text
             }) AS num_flat,
             COLLECT(DISTINCT {
                reference_title: r.title,
                reference_text: ref.reference_text
            }) AS references_flat

        WITH topExigence,
            references_flat,
             [ar IN ar_flat | {
                ar_label: ar.ar_label,
                alphabetical: {
                    label: ar.alphabetical_label,
                    romans: [r IN ar_flat WHERE r.ar_label = ar.ar_label AND r.alphabetical_label = ar.alphabetical_label | {
                        roman_label: r.roman_label,
                        roman_text: r.roman_text
                    }]
                }
             }] AS ar_nodes,
             [n IN num_flat | {
                numerical_label: n.numerical_label,
                alphabetical: {
                    label: n.alphabetical_label,
                    romans: [r IN num_flat WHERE r.numerical_label = n.numerical_label AND r.alphabetical_label = n.alphabetical_label | {
                        roman_label: r.roman_label,
                        roman_text: r.roman_text
                    }]
                }
             }] AS numerical_nodes

        RETURN 
            topExigence.parent_title AS norme_label,
            references_flat AS references,
            topExigence.label AS exigence_label,
            topExigence.text AS exigence_text,
            ar_nodes,
            numerical_nodes
        """
        logger.info("Executing semantic exigence text query against Neo4j")
        return run_neo4j_query(cypher)
    except Exception as e:
        logger.exception(f"Error in get_semantic_exigence_text: {e}")
        return []


def filter_extracted_requirements(norme_context: List, exigences_context: List, exigence_text_context: List) -> str:
    """
    Filter and deduplicate extracted requirements from multiple context sources.

    :param norme_context: List of norme contexts
    :param exigences_context: List of exigence contexts
    :param exigence_text_context: List of exigence text contexts
    :return: String representation of filtered and grouped requirements by norme
    """
    logger.info("Starting requirements filtering and processing")
    try:
        logger.info("Processing requirement contexts")
        df_norme = pd.DataFrame(norme_context)
        df_norme.fillna("", inplace=True)

        df_exploded = df_norme.explode('exigences')

        df_norme_flat = pd.concat([
            df_exploded[['norme_label']],
            df_exploded['exigences'].apply(pd.Series)
        ], axis=1)
        df_norme_flat.fillna("", inplace=True)

        df_exigence = pd.DataFrame(exigences_context)
        df_exigence.fillna("", inplace=True)

        df_text = pd.DataFrame(exigence_text_context)
        df_text.fillna("", inplace=True)

        df_concat = pd.concat([df_norme_flat, df_exigence, df_text], ignore_index=True)
        df_processed = df_concat.astype(str)
        df_unique = df_processed.drop_duplicates()

        result = {
            norme: group.drop(columns="norme_label").to_dict(orient="records")
            for norme, group in df_unique.groupby("norme_label")
        }
        logger.info(
            f"Requirements filtering completed successfully, processed {len(result) if result else 0} norme groups")
        return str(result)
    except Exception as e:
        logger.exception(f"Error occurred in filter_extracted_requirements: {e}")
        return ""