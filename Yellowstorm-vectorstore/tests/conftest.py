"""
Configuration globale pour les tests pytest
Ce fichier contient les fixtures communes et la configuration partagée pour tous les tests
"""
import pytest
import os
import sys
import tempfile
import numpy as np
from unittest.mock import Mock, patch
from typing import List, Dict, Any
from dotenv import load_dotenv, dotenv_values

def _create_test_shared_volume_prefix() -> str:
    temp_dir = tempfile.mkdtemp(prefix="vectorstores-tests-")
    try:
        os.chmod(temp_dir, 0o700)
    except OSError:
        pass
    return temp_dir


_ENV_TEST_PATH = os.path.join(os.path.dirname(__file__), ".env.test")
load_dotenv(dotenv_path=_ENV_TEST_PATH, override=False)
_DOTENV_VALUES = dotenv_values(_ENV_TEST_PATH)
_SHARED_VOLUME_PREFIX = _create_test_shared_volume_prefix()
_LOG_CONFIG_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "src", "logger", "uvicorn_disable_logging.json")
)

# Set all environment variables at import time
for key, value in _DOTENV_VALUES.items():
    if value is not None:
        os.environ.setdefault(key, value)
os.environ["LOG_CONFIG_PATH"] = _LOG_CONFIG_PATH
os.environ["SHARED_VOLUME_PREFIX"] = _SHARED_VOLUME_PREFIX

# Ajouter le répertoire racine au path Python pour permettre les imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


@pytest.fixture(scope="session")
def test_data_dir():
    """Répertoire pour les données de test"""
    return os.path.join(os.path.dirname(__file__), "test_data")


@pytest.fixture
def sample_document_pages():
    """Pages de document d'exemple pour les tests de classification"""
    return [
        {
            "page_content": "This is a legal contract between two parties regarding the sale of property.",
            "metadata": {
                "page": 1,
                "source": "contract.pdf",
                "document_name": "contract"
            }
        },
        {
            "page_content": "The terms and conditions are outlined in the following sections.",
            "metadata": {
                "page": 2,
                "source": "contract.pdf",
                "document_name": "contract"
            }
        },
        {
            "page_content": "Both parties agree to comply with all legal requirements.",
            "metadata": {
                "page": 3,
                "source": "contract.pdf",
                "document_name": "contract"
            }
        }
    ]


@pytest.fixture
def sample_structure_template():
    """Template de structure hiérarchique d'exemple"""
    return [
        {
            "directory": "Legal Documents",
            "description": "All legal contracts, agreements, and legal paperwork",
            "sous_directories": [
                {
                    "directory": "Contracts",
                    "description": "Purchase agreements, sales contracts, and binding agreements",
                    "sous_directories": [
                        {
                            "directory": "Real Estate Contracts",
                            "description": "Property purchase and sale agreements",
                            "sous_directories": []
                        },
                        {
                            "directory": "Business Contracts",
                            "description": "Commercial agreements and business deals",
                            "sous_directories": []
                        }
                    ]
                },
                {
                    "directory": "Legal Notices",
                    "description": "Legal notices, summons, and formal communications",
                    "sous_directories": []
                }
            ]
        },
        {
            "directory": "HR Documents",
            "description": "Human resources documents and employee records",
            "sous_directories": [
                {
                    "directory": "Employment Contracts",
                    "description": "Employee contracts and job agreements",
                    "sous_directories": []
                },
                {
                    "directory": "Employee Records",
                    "description": "Personnel files and employee information",
                    "sous_directories": []
                }
            ]
        },
        {
            "directory": "Financial Documents",
            "description": "Financial statements, invoices, and accounting documents",
            "sous_directories": [
                {
                    "directory": "Invoices",
                    "description": "Bills, receipts, and payment documents",
                    "sous_directories": []
                },
                {
                    "directory": "Financial Reports",
                    "description": "Balance sheets, profit & loss statements",
                    "sous_directories": []
                }
            ]
        }
    ]


@pytest.fixture
def sample_chunk_ids():
    """Liste d'IDs de chunks d'exemple"""
    return ["chunk_001", "chunk_002", "chunk_003", "chunk_004", "chunk_005"]


@pytest.fixture
def sample_embeddings():
    """Embeddings d'exemple pour les tests"""
    return {
        "Legal Documents": np.random.rand(1536),
        "Legal Documents/Contracts": np.random.rand(1536),
        "Legal Documents/Contracts/Real Estate Contracts": np.random.rand(1536),
        "HR Documents": np.random.rand(1536),
        "HR Documents/Employment Contracts": np.random.rand(1536),
        "Financial Documents": np.random.rand(1536),
        "Financial Documents/Invoices": np.random.rand(1536)
    }


@pytest.fixture
def mock_azure_settings():
    """Configuration Azure mockée pour les tests"""
    mock_settings = Mock()
    mock_settings.AZURE_AI_SEARCH_ENDPOINT = "https://test-search.search.windows.net"
    mock_settings.AZURE_AI_SEARCH_KEY = "test_search_key"
    mock_settings.AZURE_OPENAI_ENDPOINT = "https://test-openai.openai.azure.com"
    mock_settings.AZURE_OPENAI_API_KEY = "test_openai_key"
    mock_settings.AZURE_OPENAI_API_VERSION = "2024-02-15-preview"
    mock_settings.AZURE_OPENAI_DEPLOYMENT_NAME = "gpt-4"
    mock_settings.AZURE_OCR_ENDPOINT = "https://test-ocr.cognitiveservices.azure.com"
    mock_settings.AZURE_AI_FOUNDRY_API_KEY = "test_foundry_key"
    mock_settings.PDF_API_URL = "https://test-pdf-api.com"
    return mock_settings


@pytest.fixture
def mock_embeddings_service():
    """Service d'embeddings mocké"""
    mock_service = Mock()
    mock_service.embed_query.return_value = np.random.rand(1536)
    mock_service.encode.return_value = np.random.rand(1536)
    return mock_service


@pytest.fixture
def mock_azure_search_client():
    """Client Azure Search mocké"""
    mock_client = Mock()

    # Mock des résultats de recherche
    mock_search_results = [
        {
            "id": "chunk_001",
            "brain_id": "chunk_001",
            "content": "This is a legal document about property sale agreements.",
            "content_vector": np.random.rand(1536).tolist(),
            "title": "Property Sale Agreement",
            "metadata": {"type": "legal", "page": 1},
            "@search.score": 0.85
        },
        {
            "id": "chunk_002",
            "brain_id": "chunk_002",
            "content": "Human resources policy document regarding employee benefits.",
            "content_vector": np.random.rand(1536).tolist(),
            "title": "HR Policy",
            "metadata": {"type": "hr", "page": 1},
            "@search.score": 0.78
        },
        {
            "id": "chunk_003",
            "brain_id": "chunk_003",
            "content": "Invoice for services rendered in the amount of $1,500.00.",
            "content_vector": np.random.rand(1536).tolist(),
            "title": "Service Invoice",
            "metadata": {"type": "financial", "page": 1},
            "@search.score": 0.92
        }
    ]

    mock_client.search.return_value = mock_search_results
    return mock_client


@pytest.fixture
def mock_azure_openai_client():
    """Client Azure OpenAI mocké"""
    mock_client = Mock()

    # Mock de la réponse de completion
    mock_completion = Mock()
    mock_completion.choices = [Mock()]
    mock_completion.choices[0].message = Mock()
    mock_completion.choices[0].message.content = '{"predicted_category": "Legal Documents/Contracts", "confidence_niveau": "eleve", "justification": "Document contains legal contract language and terms."}'

    mock_client.chat.completions.create.return_value = mock_completion
    return mock_client


@pytest.fixture
def sample_classification_results():
    """Résultats de classification d'exemple"""
    return {
        "img": {
            "ids": ["img_chunk_1", "img_chunk_2"],
            "n_tokens": 1000,
            "classifications": [
                Mock(
                    chunk_id="img_chunk_1",
                    predicted_category="Legal Documents/Contracts",
                    final_confidence=0.85,
                    hierarchy_path=["Legal Documents", "Contracts"]
                ),
                Mock(
                    chunk_id="img_chunk_2",
                    predicted_category="HR Documents",
                    final_confidence=0.72,
                    hierarchy_path=["HR Documents"]
                )
            ]
        },
        "text": {
            "ids": ["text_chunk_1", "text_chunk_2", "text_chunk_3"],
            "n_tokens": 2500,
            "classifications": [
                Mock(
                    chunk_id="text_chunk_1",
                    predicted_category="Legal Documents/Contracts",
                    final_confidence=0.90,
                    hierarchy_path=["Legal Documents", "Contracts"]
                ),
                Mock(
                    chunk_id="text_chunk_2",
                    predicted_category="Legal Documents/Contracts",
                    final_confidence=0.88,
                    hierarchy_path=["Legal Documents", "Contracts"]
                ),
                Mock(
                    chunk_id="text_chunk_3",
                    predicted_category="Financial Documents",
                    final_confidence=0.65,
                    hierarchy_path=["Financial Documents"]
                )
            ]
        }
    }


@pytest.fixture
def sample_excel_document_pages():
    """Pages de document Excel d'exemple"""
    return [
        {
            "page_content": "Employee Name,Position,Department,Salary\nJohn Doe,Manager,Sales,75000\nJane Smith,Developer,IT,65000\nBob Johnson,Analyst,Finance,55000",
            "metadata": {
                "sheet": "Employee_Data",
                "source": "employees.xlsx",
                "document_name": "employees"
            }
        }
    ]


@pytest.fixture
def sample_image_document_pages():
    """Pages de document image d'exemple"""
    return [
        {
            "page_content": "<page number=1> Contract Agreement between Party A and Party B for the purchase of real estate property. </page>",
            "metadata": {
                "page": 1,
                "source": "scanned_contract.pdf",
                "document_name": "scanned_contract"
            }
        }
    ]


@pytest.fixture(autouse=True)
def setup_test_environment(monkeypatch):
    """Configuration automatique de l'environnement de test"""
    env_vars = {k: v for k, v in _DOTENV_VALUES.items() if v is not None}
    env_vars["LOG_CONFIG_PATH"] = _LOG_CONFIG_PATH
    env_vars["SHARED_VOLUME_PREFIX"] = _SHARED_VOLUME_PREFIX

    for key, value in env_vars.items():
        monkeypatch.setenv(key, value)


@pytest.fixture
def classification_error_cases():
    """Cas d'erreur pour les tests de classification"""
    return {
        "empty_pages": [],
        "none_pages": None,
        "empty_file_path": "",
        "none_file_path": None,
        "empty_template": [],
        "none_template": None,
        "invalid_pages_type": "not_a_list",
        "invalid_template_type": "not_a_list"
    }


@pytest.fixture
def mock_logger():
    """Logger mocké pour les tests"""
    return Mock()


# Marqueurs personnalisés pour organiser les tests
def pytest_configure(config):
    """Configuration personnalisée pour pytest"""
    config.addinivalue_line(
        "markers", "unit: marque les tests unitaires"
    )
    config.addinivalue_line(
        "markers", "integration: marque les tests d'intégration"
    )
    config.addinivalue_line(
        "markers", "slow: marque les tests lents"
    )
    config.addinivalue_line(
        "markers", "azure: marque les tests nécessitant Azure"
    )


@pytest.fixture(scope="session")
def test_config():
    """Configuration globale pour les tests"""
    return {
        "test_timeout": 30,  # secondes
        "max_retries": 3,
        "test_data_size": "small",  # small, medium, large
        "mock_external_services": True
    }


# Hooks pytest pour personnaliser le comportement des tests
def pytest_runtest_setup(item):
    """Setup exécuté avant chaque test"""
    # Vérifier les marqueurs et ignorer certains tests si nécessaire
    if "slow" in item.keywords and not item.config.getoption("--runslow", default=False):
        pytest.skip("test lent ignoré, utiliser --runslow pour l'exécuter")


def pytest_addoption(parser):
    """Ajouter des options de ligne de commande personnalisées"""
    parser.addoption(
        "--runslow",
        action="store_true",
        default=False,
        help="exécuter les tests marqués comme lents"
    )
    parser.addoption(
        "--azure",
        action="store_true",
        default=False,
        help="exécuter les tests nécessitant Azure"
    )
