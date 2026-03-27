from typing import List, Dict, Any, Optional, Tuple
from src.logger.logging import get_logger
from src.config.settings import get_settings

from dataclasses import dataclass, asdict, is_dataclass
import json

from openai import OpenAI

from src.modules.qdrant_search import ChunkRetrievalService
from src.modules.qdrant_search.filter import dict_to_qdrant_filter
from src.modules.qdrant_search.get_qdrant_collection import get_qdrant_client

logger = get_logger("vectorstores-api.main")
settings = get_settings()

def _get_directory_id_from_category_inline(predicted_category: str, structure_template: List[Dict[str, Any]]) -> Optional[str]:
    """
    Inline implementation to avoid circular import.
    Map predicted category to directory_id from structure template.

    Args:
        predicted_category: The predicted category name (e.g., "Marketing", "Finances")
        structure_template: The structure template containing directory information

    Returns:
        The directory_id if found, None otherwise
    """
    if not predicted_category or not structure_template:
        return None

    # Search through the structure template for matching directory name
    for folder in structure_template:
        if folder.get("directory") == predicted_category:
            return folder.get("id")

    # If no exact match found, try partial matching (in case of hierarchical categories)
    for folder in structure_template:
        folder_name = folder.get("directory", "")
        if predicted_category.startswith(folder_name) or folder_name.startswith(predicted_category):
            return folder.get("id")

    return None

@dataclass
class ChunkClassificationResult:
    """Résultat de classification pour un chunk"""
    chunk_id: str
    predicted_category: str
    confidence_scores: Dict[str, float]
    final_confidence: float
    hierarchy_path: List[str]  # Chemin hiérarchique suivi
    level_confidences: Dict[int, float]  # Confiance à chaque niveau


class DataclassJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if is_dataclass(obj):
            return asdict(obj)
        elif hasattr(obj, "__dict__"):
            return obj.__dict__
        elif hasattr(obj, "_asdict"):  # namedtuples
            return obj._asdict()
        return super().default(obj)


@dataclass
class DocumentClassificationResult:
    """Résultat de classification pour un document complet"""
    document_type: str
    document_id: str
    predicted_category: str
    final_confidence: float
    vote_distribution: Dict[str, int]
    classification_source: str = "llm_only"  # Updated to reflect LLM-only classification

    def to_dict(self):
        """Utilise l'encodeur personnalisé"""
        return json.loads(json.dumps(self, cls=DataclassJSONEncoder))

    def to_json(self):
        """Convertit directement en JSON"""
        return json.dumps(self, cls=DataclassJSONEncoder, ensure_ascii=False)


class DocumentClassifier:
    def __init__(
        self, index_name: str, directories: List[Dict], external_id: str, username: str, prompt: Optional[str] = None
    ):
        """
        Initialise le classificateur de documents LLM-only

        Args:
            index_name: Nom de l'index Qdrant
            directories: Liste des structures hiérarchiques de répertoires pour la validation
            external_id: ID externe du document
            username: Username for authentication and tracking
            prompt: Optional custom classification prompt with {structure_template} and {content} placeholders
        """
        self.index_name = index_name
        self.directories = directories or []
        self.username = username

        self.qdrant_client = get_qdrant_client()

        # Store the structure template for category validation
        self.structure_template = self.directories
        self.external_id = external_id
        self.type = "txt"
        self.custom_prompt = prompt  # Store custom prompt

        # Initialize chunk retrieval service for external_id based classification
        self.chunk_retrieval_service = ChunkRetrievalService(index_name, username)

        logger.info(f"LLM-only classifier initialized with {len(directories) if directories else 0} categories")

    def classify_document_by_external_id(
        self,
        include_images: bool = False,
        chunk_filter: Optional[Dict[str, Any]] = None,
        sheet_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Classify document by directly retrieving chunks using external_id.

        Args:
            include_images: Whether to include image chunks in classification
            chunk_filter: Optional filters for specific chunks
            sheet_name: Optional sheet name to filter chunks by (for spreadsheet documents)

        Returns:
            Dict[str, Any]: Classification result

        Raises:
            ValueError: If no chunks found for external_id
            RuntimeError: If classification fails
        """
        try:
            logger.info(f"Starting classification for external_id: {self.external_id}")
            logger.info(f"Include images: {include_images}")

            # Step 1: Direct chunk retrieval by external_id
            chunks_data = self.chunk_retrieval_service.get_chunks_content_by_external_id(
                self.external_id, include_images, chunk_filter, sheet_name
            )

            if not chunks_data:
                raise ValueError(f"No chunks found for external_id: {self.external_id}")

            logger.info(f"Retrieved {len(chunks_data)} chunks for classification")

            # Step 2: Classification using existing logic
            return self._classify_chunks_data(chunks_data)

        except Exception as e:
            logger.error(f"Error classifying document by external_id {self.external_id}: {str(e)}")
            raise

    def _classify_chunks_data(self, chunks_data: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        """
        Classify chunks using retrieved data.

        Args:
            chunks_data: Dict of chunk_id -> {"content": "...", "metadata": {...}}

        Returns:
            Dict[str, Any]: Classification result
        """
        if not chunks_data:
            raise ValueError("No chunks data provided for classification")

        logger.info(f"Classification de {len(chunks_data)} chunks...")
        self.type = "txt"  # Default to text, can be modified based on metadata

        try:
            # LLM-only classification approach
            logger.info("Using LLM-only classification approach...")

            chunk_ids = list(chunks_data.keys())

            # Direct LLM classification using all chunks
            llm_result = self._classify_document_with_llm(chunk_ids, chunks_data)

            if llm_result and llm_result.get("predicted_category", "unknown") != "unknown":
                # Process the LLM result
                predicted_category = llm_result["predicted_category"]
                confidence = llm_result.get("confidence", 0.0)
                is_new_category = llm_result.get("is_new_category", False)
                matched_existing_id = llm_result.get("matched_existing_id")
                reasoning = llm_result.get("reasoning", "No reasoning provided")

                logger.info(f"LLM Classification: {predicted_category} (confidence: {confidence:.3f})")
                logger.info(f"New Category: {is_new_category}, Category ID: {matched_existing_id}")
                logger.info(f"Reasoning: {reasoning}")

                # Create result with new fields
                result = self._create_llm_only_result(chunk_ids, predicted_category, confidence, llm_result)
                # Ensure the result has the new fields
                result.update({
                    "is_new_category": is_new_category,
                    "category_id": matched_existing_id,
                    "classification_source": "llm_new" if is_new_category else "llm_existing",
                    "reasoning": reasoning
                })

                return result
            else:
                # LLM classification failed
                logger.warning("LLM classification failed")
                result = self._create_llm_only_result(chunk_ids, "unknown", 0.0, llm_result)
                result.update({
                    "is_new_category": False,
                    "category_id": None,
                    "classification_source": "llm_error"
                })
                return result

        except Exception as e:
            logger.exception(f"Erreur lors de la classification: {str(e)}")
            raise RuntimeError(f"Classification failed: {str(e)}") from e

    def classify_chunks_with_qdrant(self, all_ids: List[str], include_images: bool) -> Dict:
        """
        Classifie les chunks en utilisant uniquement LLM

        Args:
            all_ids: Liste des IDs des chunks à classifier
            include_images: Si True, traite les images, sinon le texte

        Returns:
            Dict: Résultat de la classification du document

        Raises:
            ValueError: Si all_ids est vide
            RuntimeError: Si la classification échoue
        """

        if not all_ids:
            raise ValueError("La liste des IDs ne peut pas être vide")

        logger.info(f"LLM-only classification of {len(all_ids)} chunks...")
        self.type = "img" if include_images else "txt"

        try:
            # 1. Récupérer les données des chunks depuis Qdrant
            logger.info("Retrieving chunks from Qdrant...")
            chunks_data = self._retrieve_chunks_from_search(all_ids)

            if not chunks_data:
                logger.warning("No chunks found in index")
                return self._create_llm_only_result(all_ids, "No chunks found in search index")

            # 2. LLM-only classification direct
            logger.info("Using LLM-only classification approach")
            chunk_ids = list(chunks_data.keys())
            llm_result = self._classify_document_with_llm(chunk_ids, chunks_data)

            if llm_result and llm_result.get("predicted_category", "Unclassified") != "Unclassified":
                # Process the LLM result
                predicted_category = llm_result["predicted_category"]
                confidence = llm_result.get("confidence", 0.0)
                is_new_category = llm_result.get("is_new_category", False)
                matched_existing_id = llm_result.get("matched_existing_id")
                reasoning = llm_result.get("reasoning", "No reasoning provided")

                logger.info(f"LLM Classification: {predicted_category} (confidence: {confidence:.3f})")
                logger.info(f"New Category: {is_new_category}, Category ID: {matched_existing_id}")
                logger.info(f"Reasoning: {reasoning}")

                # Create result with new fields
                result = self._create_llm_only_result(chunk_ids, predicted_category, confidence, llm_result)
                # Ensure the base result has the new fields
                result.update({
                    "is_new_category": is_new_category,
                    "category_id": matched_existing_id,
                    "classification_source": "llm_new" if is_new_category else "llm_existing",
                    "reasoning": reasoning
                })

                return result
            else:
                # LLM classification failed
                logger.warning("LLM classification failed or returned unclassified")
                result = self._create_llm_only_result(chunk_ids, "Unclassified", 0.0, llm_result)
                # Ensure the base result has the new fields
                result.update({
                    "is_new_category": False,
                    "category_id": None,
                    "classification_source": "llm_existing"
                })
                return result

        except (ValueError, RuntimeError) as e:
            logger.exception(f"Validation error in classify_chunks_with_qdrant: {str(e)}")
            raise
        except Exception as e:
            logger.exception(f"Unexpected error in classify_chunks_with_qdrant: {str(e)}")
            raise RuntimeError(f"Classification failed: {str(e)}") from e

    def extract_paths(self, structure: List, parent: str = "") -> List[str]:
        """
        Extrait les chemins complets à partir de la structure hiérarchique

        Args:
            structure: Structure hiérarchique des répertoires
            parent: Chemin parent (par défaut vide)

        Returns:
            List[str]: Liste des chemins complets
        """
        paths = []
        for item in structure:
            current_path = f"{parent}/{item['directory']}" if parent else item['directory']
            paths.append(current_path)
            if item.get("sous_directories"):
                paths.extend(self.extract_paths(item["sous_directories"], current_path))
        return paths

    def _get_directories_at_level(self, level: int) -> List[str]:
        """Récupère tous les répertoires à un niveau donné, en ignorant les indicateurs."""
        try:
            directories_at_level = []

            def traverse(nodes, current_level):
                for node in nodes:
                    # Vérifier si on est au bon niveau
                    if current_level == level:
                        directories_at_level.append(node["directory"])
                    # Descendre dans les sous répertoires
                    traverse(node.get("sous_directories", []), current_level + 1)

            traverse(self.structure_template, 0)
            return directories_at_level

        except (KeyError, AttributeError) as e:
            logger.exception(f"Erreur de structure dans _get_directories_at_level: {e}")
            return []
        except Exception as e:
            logger.exception(f"Erreur inattendue dans _get_directories_at_level: {e}")
            return []

    def _get_parent_directory(self, directory: str) -> Optional[str]:
        """Récupère le répertoire parent d'un répertoire donné"""
        parts = directory.split("/")
        if len(parts) <= 1:
            return None
        return "/".join(parts[:-1])

    def _create_default_result(self, document_id: str, chunk_results: List[ChunkClassificationResult]) -> Dict:
        """
        Crée un résultat par défaut en cas d'erreur

        Args:
            document_id: ID du document
            chunk_results: Liste des résultats de chunks

        Returns:
            Dict: Résultat par défaut
        """
        return DocumentClassificationResult(
            document_type=self.type,
            document_id=document_id or "unknown",
            predicted_category="unknown",
            final_confidence=0.0,
            vote_distribution={}
        ).to_dict()

    def majority_vote_with_weights(
        self, chunk_results: List[ChunkClassificationResult], document_id: str = None
    ) -> Dict:
        """
        Applique le majority voting global avec pondération hiérarchique

        Args:
            chunk_results: Résultats de classification des chunks
            document_id: ID du document (optionnel)

        Returns:
            Dict: Résultat final de la classification
        """
        if not chunk_results:
            return self._create_default_result(document_id, [])

        try:
            vote_weights = {}
            hierarchy_analysis = {}

            # 1. Compter les votes pondérés
            for chunk in chunk_results:
                category = chunk.predicted_category
                if category not in vote_weights:
                    vote_weights[category] = 0.0
                vote_weights[category] += chunk.final_confidence

                # Stocker l'analyse hiérarchique par chunk
                hierarchy_analysis[chunk.chunk_id] = {
                    "hierarchy_path": chunk.hierarchy_path,
                    "level_confidences": chunk.level_confidences,
                }

            # 2. Trouver la catégorie avec le vote majoritaire pondéré
            if not vote_weights:
                return self._create_default_result(document_id, chunk_results)

            best_category = max(vote_weights, key=vote_weights.get)
            total_weight = sum(vote_weights.values())
            final_confidence = vote_weights[best_category] / total_weight if total_weight > 0 else 0.0
            classification_source = "llm_only"

            # 3. Retourner le résultat complet
            predicted_category_display = best_category

            return DocumentClassificationResult(
                document_type=self.type,
                document_id=document_id or "unknown",
                predicted_category=predicted_category_display or best_category,
                final_confidence=final_confidence,
                vote_distribution=vote_weights,
                classification_source=classification_source,
            ).to_dict()
        except Exception as e:
            logger.exception(f"Erreur dans majority_vote_with_weights: {str(e)}")
            return self._create_default_result(document_id, chunk_results)

    def _retrieve_chunks_from_search(self, chunk_ids: List[str]) -> Dict[str, Dict]:
        """Récupère les chunks depuis Qdrant sans batch."""

        chunks_data = {}

        try:
            # Build the filter dict - filter by specific IDs
            filter_dict = {
                "ids_classification": chunk_ids,  # all IDs at once with OR logic
            }

            # Convert dict → Qdrant filter object
            qdrant_filter = dict_to_qdrant_filter(filter_dict)
            logger.info(f"Searching for chunks with filter: {qdrant_filter}")
            logger.info(f"Looking for chunk IDs: {chunk_ids}")

            # Execute the scroll to retrieve points
            results, _ = self.qdrant_client.scroll(
                collection_name=self.index_name,
                scroll_filter=qdrant_filter,
                limit=1000,  # Set a reasonable limit
                with_payload=True,
            )

            # Log search results for debugging
            logger.info(f"Qdrant returned {len(results)} results")

            # Process results
            for result in results:
                doc_id = str(result.id)
                payload = result.payload

                chunks_data[doc_id] = {
                    "content": payload.get("content", ""),
                    "content_vector": payload.get("content_vector", []),
                    "title": payload.get("title", ""),
                    "metadata": payload.get("metadata", {}),
                    "score": None,  # Qdrant scroll doesn't return scores
                }
                logger.info(f"Found chunk: {doc_id} with content preview: {payload.get('content', '')[:100]}...")

        except Exception as e:
            logger.exception(f"Erreur lors de la récupération des chunks: {e}")
            raise RuntimeError(f"Échec de la récupération des chunks: {str(e)}") from e

        return chunks_data

    def _classify_document_with_llm(self, chunk_ids: List[str], chunks_data: Dict[str, Dict] = None) -> Dict[str, Any]:
        """
        Classifie un document en utilisant un LLM.
        Récupère les 3 premiers chunks du document pour la classification.

        Args:
            chunk_ids: Liste des IDs des chunks du document
            chunks_data: Données des chunks déjà récupérées (optionnel)

        Returns:
            Dict[str, Any]: Résultat de la classification LLM
        """
        try:
            logger.info("Début de la classification LLM")

            # Utiliser les chunks_data fournis ou les récupérer si non disponibles
            if chunks_data:
                logger.info("Utilisation des chunks_data existants pour la classification LLM")
                # Filtrer pour ne garder que les 3 premiers chunks
                first_chunks_ids = chunk_ids[:3]
                available_chunks_data = {
                    chunk_id: chunk_data for chunk_id, chunk_data in chunks_data.items()
                    if chunk_id in first_chunks_ids
                }
            else:
                logger.info("Récupération des chunks depuis Qdrant pour la classification LLM")
                # Récupérer les 3 premiers chunks du document
                first_chunks_ids = chunk_ids[:3]
                available_chunks_data = self._retrieve_chunks_from_search(first_chunks_ids)

            if not available_chunks_data:
                logger.warning("Aucun chunk trouvé pour la classification LLM")
                return {
                    "predicted_category": "Autres",
                    "confidence": 0.0,
                    "reasoning": "No document content available for LLM classification"
                }

            # Combiner le contenu des chunks
            combined_content = ""
            chunk_ids_in_order = []

            # Tenter de trier les chunks par page puis par ordre
            sorted_chunks = []
            for chunk_id in first_chunks_ids:
                if chunk_id in available_chunks_data:
                    chunk_data = available_chunks_data[chunk_id]
                    metadata = chunk_data.get("metadata", {})

                    # Handle metadata if it's a JSON string
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except json.JSONDecodeError:
                            metadata = {}

                    page = metadata.get("page", 999)
                    chunk_order = metadata.get("chunk_order", 999)
                    sorted_chunks.append((page, chunk_order, chunk_id, chunk_data))

            # Trier par page puis par chunk_order
            sorted_chunks.sort(key=lambda x: (x[0], x[1]))

            # Extraire le contenu dans l'ordre
            for page, chunk_order, chunk_id, chunk_data in sorted_chunks:
                content = chunk_data.get("content", "").strip()
                if content:
                    combined_content += content + "\n\n"
                    chunk_ids_in_order.append(chunk_id)

            if not combined_content.strip():
                logger.warning("Contenu vide après combinaison des chunks")
                return {
                    "predicted_category": "Autres",
                    "confidence": 0.0,
                    "reasoning": "Document content is empty"
                }

            # Limiter le contenu pour éviter les tokens excessifs
            max_content_length = 4000  # caractères environ
            if len(combined_content) > max_content_length:
                combined_content = combined_content[:max_content_length] + "..."
                logger.info(f"Contenu tronqué à {max_content_length} caractères pour la classification LLM")

            # Appeler la fonction de classification LLM
            llm_result = self._classify_document_topic_llm(combined_content)

            logger.info(f"Classification LLM réussie: {llm_result.get('predicted_category', 'Unknown')} "
                       f"(confiance: {llm_result.get('confidence', 'unknown')})")

            return llm_result

        except Exception as e:
            logger.exception(f"Erreur lors de la classification LLM: {str(e)}")
            return {
                "predicted_category": "Autres",
                "confidence": 0.0,
                "reasoning": f"LLM classification failed: {str(e)}"
            }

    def _classify_document_topic_llm(self, content: str) -> Dict[str, Any]:
        """
        Classifie un document en utilisant OpenAI's Structured Output.

        Args:
            content: Contenu du document à classifier

        Returns:
            Dict[str, Any]: Résultat de la classification avec predicted_category, is_new_category,
                          confidence (0-1), reasoning, matched_existing_id
        """
        client = OpenAI(
            api_key=settings.LITELLM_API_KEY,
            base_url=settings.LITELLM_BASE_URL
        )

        # Build category hierarchy for the prompt
        category_list = self._build_category_list_for_prompt()

        # Use custom prompt if provided, otherwise use default
        if self.custom_prompt:
            # Replace placeholders with actual values
            prompt_with_placeholders = self.custom_prompt.replace("{structure_template}", category_list)

            if "{content}" in prompt_with_placeholders:
                # User provided a single prompt with {content} placeholder
                user_prompt = prompt_with_placeholders.replace("{content}", content)
                system_prompt = "You are a document classifier. Follow the user's instructions precisely."
            else:
                # User provided system prompt only
                system_prompt = prompt_with_placeholders
                user_prompt = f"""Classify the document based on the text below:

--- BEGIN DOCUMENT CHUNK ---
{content}
--- END DOCUMENT CHUNK ---
"""
        else:
            # Use the default hardcoded prompt
            system_prompt = f"""
You are an expert document classifier. You will receive partial chunks from the beginning
of a document. Your task is to classify it into the most appropriate category.

AVAILABLE CATEGORIES (with IDs):
{category_list}

Instructions:
1. First, check if the document fits any of the EXACT categories listed above
2. If it matches an existing category, use the EXACT name from the list and set:
   - is_new_category: false
   - matched_existing_id: [the ID of the matched category]
3. If NO existing category fits well, create a new, descriptive category name and set:
   - is_new_category: true
   - matched_existing_id: null
4. Always provide a confidence score between 0.0 and 1.0
5. Explain your reasoning clearly

Guidelines for new categories:
- predicted_category should only contain the name of the new category , nothing else .
- Use title case for category names
- Create categories that would be useful for future document organization
"""

            user_prompt = f"""
Classify the document topic based on the text below:

--- BEGIN DOCUMENT CHUNK ---
{content}
--- END DOCUMENT CHUNK ---
"""

        # JSON schema for structured LLM output
        schema = {
            "type": "object",
            "properties": {
                "predicted_category": {
                    "type": "string",
                    "description": "The exact category name from the provided list OR a new category name if none match"
                },
                "is_new_category": {
                    "type": "boolean",
                    "description": "True if this is a new category not in the provided list"
                },
                "confidence": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Confidence score from 0.0 to 1.0"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Explanation for the classification choice"
                },
                "matched_existing_id": {
                    "type": "string",
                    "description": "The ID of the matched category if existing, null if new category"
                }
            },
            "required": ["predicted_category", "is_new_category", "confidence", "reasoning", "matched_existing_id"],
            "additionalProperties": False
        }

        response = client.chat.completions.create(
            model=settings.LLM_CLASSIFICATION_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "classification_result",
                    "schema": schema,
                    "strict": True,
                },
            },
            )
        try:
            message = response.choices[0].message.content
            result = json.loads(message)
        except Exception:
            logger.warning("Failed to parse JSON, returning raw message")
            result = {"raw": message}

        return result

    def _build_category_list_for_prompt(self) -> str:
        """
        Build a formatted list of categories with their IDs for the LLM prompt

        Returns:
            str: Formatted string of categories with IDs
        """
        if not self.structure_template:
            return "No predefined categories available - you may create new categories"

        category_lines = []

        def traverse_categories(categories, level=0):
            for cat in categories:
                indent = "  " * level
                cat_id = cat.get("id", "unknown")
                cat_name = cat.get("directory", "Unknown")
                category_lines.append(f"{indent}- {cat_name} (ID: {cat_id})")

                # Recursively add subdirectories
                subdirs = cat.get("sous_directories", [])
                if subdirs:
                    traverse_categories(subdirs, level + 1)

        traverse_categories(self.structure_template)
        return "\n".join(category_lines)

    def _create_llm_only_result(self, chunk_ids: List[str], category: str, confidence: float = 0.0, llm_result: Dict = None) -> Dict:
        """
        Crée un résultat de classification pour le mode LLM-only avec le même format que DocumentClassificationResult

        Args:
            chunk_ids: Liste des IDs des chunks traités
            category: Catégorie prédite par le LLM ou catégorie d'erreur
            confidence: Confiance associée (0.0 pour les erreurs)
            llm_result: Résultat brut du LLM (optionnel)

        Returns:
            Dict: Dictionnaire au même format que DocumentClassificationResult.to_dict()
        """
        try:
            # Créer des ChunkClassificationResult vides pour compatibilité
            chunk_votes = []
            for chunk_id in chunk_ids:
                chunk_result = ChunkClassificationResult(
                    chunk_id=chunk_id,
                    predicted_category=category,
                    confidence_scores={category: confidence},
                    final_confidence=confidence,
                    hierarchy_path=[],
                    level_confidences={},
                )
                chunk_votes.append(chunk_result)

            # Créer l'analyse hiérarchique vide pour compatibilité
            hierarchy_analysis = {}
            for chunk_id in chunk_ids:
                hierarchy_analysis[chunk_id] = {
                    "hierarchy_path": [],
                    "level_confidences": {},
                }

            # Distribution des votes pour compatibilité
            vote_distribution = {category: len(chunk_ids)}

            # Utiliser les informations du LLM si disponibles
            if llm_result and confidence > 0.0:
                predicted_category = llm_result.get("predicted_category", category)
                reasoning = llm_result.get("reasoning", "")
                if reasoning:
                    logger.info(f"Classification LLM reasoning: {reasoning}")
            else:
                predicted_category = category

            # Créer le résultat final
            result = DocumentClassificationResult(
                document_type=self.type,
                document_id=self.external_id,
                predicted_category=predicted_category,
                final_confidence=confidence,
                vote_distribution=vote_distribution,
                classification_source="llm_only",
            ).to_dict()

            logger.info(f"LLM-only classification result: {predicted_category} (confidence: {confidence:.3f})")
            return result

        except Exception as e:
            logger.exception(f"Erreur lors de la création du résultat LLM-only: {e}")
            # Retourner un résultat par défaut en cas d'erreur
            return {
                "document_type": self.type,
                "document_id": self.external_id,
                "predicted_category": "Error",
                "final_confidence": 0.0,
                "vote_distribution": {},
            }
