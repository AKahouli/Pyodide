# Tests pour le projet Whitelabel Codex

Ce répertoire contient tous les tests unitaires et d'intégration pour les modules de classification de fichiers.

## Structure des tests

```
tests/
├── conftest.py                           # Configuration globale et fixtures communes
├── README.md                            # Ce fichier
├── modules/
│   └── indexing/
│       └── files_classification/
│           ├── test_similarity_classification.py      # Tests pour similarity_classification.py
│           ├── test_multimodal_majority_voting.py    # Tests pour multimodal_majority_voting.py
│           └── test_classification_with_llm.py       # Tests pour classification_with_llm.py
```

## Installation des dépendances de test

```bash
pip install -r requirements-test.txt
```

## Exécution des tests

**⚠️ Important : Toutes les commandes doivent être exécutées depuis le répertoire `vectorstores-api/`**

```bash
cd vectorstores-api
```

### Exécuter tous les tests
```bash
python -m pytest tests/
```

### Exécuter tous les tests de classification
```bash
python -m pytest tests/modules/indexing/files_classification/
```

### Exécuter avec couverture de code complète
```bash
python -m pytest tests/modules/indexing/files_classification/ --cov=src/modules/indexing/files_classification --cov-report=term-missing --cov-report=html:htmlcov --cov-report=xml:coverage.xml
```

### Exécuter avec couverture et détails (recommandé)
```bash
python -m pytest tests/modules/indexing/files_classification/ --cov=src/modules/indexing/files_classification --cov-report=html:htmlcov --cov-report=term-missing -v
```

### Exécuter des tests spécifiques

#### Tests d'un fichier spécifique
```bash
python -m pytest tests/modules/indexing/files_classification/test_similarity_classification.py
```

#### Tests d'une classe spécifique
```bash
python -m pytest tests/modules/indexing/files_classification/test_similarity_classification.py::TestDocumentClassifier
```

#### Tests d'une méthode spécifique
```bash
python -m pytest tests/modules/indexing/files_classification/test_similarity_classification.py::TestDocumentClassifier::test_classifier_initialization
```

#### Tests avec pattern (ex: tous les tests de validation)
```bash
python -m pytest tests/ -k "validation"
```

### Commandes utiles pour le debugging

#### Exécuter avec mode verbose et affichage des prints
```bash
python -m pytest tests/ -v -s
```

#### Stopper au premier échec
```bash
python -m pytest tests/ -x
```

#### Exécuter les tests les plus lents en premier
```bash
python -m pytest tests/ --durations=10
```

#### Mode debugging interactif (s'arrête aux échecs)
```bash
python -m pytest tests/ --pdb
```

### Exécuter par marqueurs

#### Tests unitaires seulement
```bash
pytest -m unit
```

#### Tests d'intégration
```bash
pytest -m integration
```

#### Tests lents
```bash
pytest -m slow --runslow
```

#### Tests nécessitant Azure (avec services réels)
```bash
pytest -m azure --azure
```

### Exécution en parallèle
```bash
pytest -n auto
```

### Avec timeout personnalisé
```bash
pytest --timeout=120
```

## Marqueurs disponibles

- `unit`: Tests unitaires rapides
- `integration`: Tests d'intégration
- `slow`: Tests lents (>5s)
- `azure`: Tests nécessitant Azure
- `mock`: Tests utilisant des mocks
- `regression`: Tests de régression
- `smoke`: Tests de fumée

## Configuration

La configuration des tests se trouve dans :
- `pytest.ini` : Configuration principale de pytest
- `conftest.py` : Fixtures communes et configuration partagée

## Fixtures principales

### Données de test

- `sample_document_pages` : Pages de document d'exemple
- `sample_structure_template` : Template de structure hiérarchique
- `sample_chunk_ids` : Liste d'IDs de chunks
- `sample_embeddings` : Embeddings d'exemple

### Services mockés

- `mock_azure_settings` : Configuration Azure mockée
- `mock_embeddings_service` : Service d'embeddings mocké
- `mock_azure_search_client` : Client Azure Search mocké
- `mock_azure_openai_client` : Client Azure OpenAI mocké

### Cas d'erreur

- `classification_error_cases` : Différents cas d'erreur pour les tests

## Couverture de code

Les rapports de couverture sont générés dans :
- Terminal : Rapport en ligne de commande
- `htmlcov/` : Rapport HTML interactif
- `coverage.xml` : Rapport XML pour CI/CD

### Objectifs de couverture

- **Minimum** : 80%
- **Cible** : 90%
- **Idéal** : 95%+

## Tests par module

### test_similarity_classification.py

Tests pour le module de classification par similarité :
- **TestChunkClassificationResult** : Tests des résultats de classification de chunks
- **TestDocumentClassificationResult** : Tests des résultats de classification de documents
- **TestDataclassJSONEncoder** : Tests de l'encodeur JSON personnalisé
- **TestDocumentClassifier** : Tests de la classe principale de classification
- **TestDocumentClassifierIntegration** : Tests d'intégration

**Couverture** : Classes, méthodes, gestion d'erreurs, cas limites

### test_multimodal_majority_voting.py

Tests pour le module de vote majoritaire multimodal :
- **TestVotingWeights** : Tests des constantes de poids
- **TestDefaultConfig** : Tests de la configuration par défaut
- **TestChunkVote** : Tests de la dataclass ChunkVote
- **TestDocumentClassificationResult** : Tests des résultats de classification
- **TestDocumentMajorityVoter** : Tests du voteur majoritaire
- **TestGlobalMajorityVoteWithWeights** : Tests de la fonction globale
- **TestDocumentMajorityVoterEdgeCases** : Tests des cas limites

**Couverture** : Vote majoritaire, pondération, gestion des erreurs

### test_classification_with_llm.py

Tests pour le module de classification avec LLM :
- **TestClassificationConstants** : Tests des constantes
- **TestDocumentClassificationError** : Tests de l'exception personnalisée
- **TestClassifyDocument** : Tests de la fonction principale
- **TestClassifyDocumentHelperFunctions** : Tests des fonctions helper
- **TestClassifyDocumentEdgeCases** : Tests des cas limites

**Couverture** : Intégration LLM, validation, gestion d'erreurs, types de documents

## Mocking et fixtures

### Stratégie de mocking

1. **Services externes** : Azure Search, Azure OpenAI sont toujours mockés
2. **Fonctions système** : Accès fichiers, réseau sont mockés
3. **Randomness** : Embeddings et données aléatoires sont contrôlés
4. **Time** : Timestamps peuvent être figés avec `freezegun`

### Bonnes pratiques

1. **Isoler les tests** : Chaque test doit être indépendant
2. **Données réalistes** : Utiliser des données représentatives
3. **Edge cases** : Tester les cas limites et d'erreur
4. **Performance** : Tests unitaires < 1s, intégration < 10s
5. **Lisibilité** : Noms de tests explicites et documentation

## Debugging

### Exécuter avec plus de détails
```bash
pytest -vv -s
```

### Stopper au premier échec
```bash
pytest -x
```

### Mode debugging interactif
```bash
pytest --pdb
```

### Profiling des tests
```bash
pytest --profile --profile-svg
```

## CI/CD

Les tests sont configurés pour s'exécuter automatiquement dans les pipelines CI/CD avec :
- Exécution sur plusieurs versions de Python
- Rapports de couverture
- Artefacts de tests
- Notifications d'échec

### Variables d'environnement requises

Pour les tests avec services réels (marqueur `azure`) :
```bash
export AZURE_AI_SEARCH_ENDPOINT="..."
export AZURE_AI_SEARCH_KEY="..."
export AZURE_OPENAI_ENDPOINT="..."
export AZURE_OPENAI_API_KEY="..."
```

## Ajout de nouveaux tests

### Création d'un nouveau fichier de test

1. Créer le fichier avec préfixe `test_`
2. Importer les modules nécessaires
3. Utiliser les fixtures du `conftest.py`
4. Ajouter les marqueurs appropriés
5. Documenter les tests complexes

### Structure recommandée

```python
"""
Tests unitaires pour le module example.py
"""
import pytest
from unittest.mock import Mock, patch

from src.modules.example import ExampleClass


class TestExampleClass:
    """Tests pour la classe ExampleClass"""

    def test_example_method_success(self):
        """Test le cas de succès de example_method"""
        # Arrange
        instance = ExampleClass()

        # Act
        result = instance.example_method("input")

        # Assert
        assert result == "expected_output"

    def test_example_method_error(self):
        """Test la gestion d'erreur de example_method"""
        with pytest.raises(ValueError, match="Expected error message"):
            ExampleClass().example_method("invalid_input")
```

## Maintenance

- Réviser régulièrement les tests obsolètes
- Maintenir la couverture de code au niveau cible
- Mettre à jour les mocks selon les évolutions des APIs
- Optimiser les tests lents
- Documenter les nouveaux patterns de test