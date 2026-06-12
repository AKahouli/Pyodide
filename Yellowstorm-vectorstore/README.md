# Vectorstores API

A standalone FastAPI application for vector store operations, document indexing, and similarity search.

## Features

- Document indexing from Azure Data Lake
- Similarity search with scoring
- Vector document management (query, delete)
- Document processing and relationship extraction
- Celery-based background task processing
- JWT authentication
- Comprehensive error handling and logging

## Quick Start

### 1. Installation

```bash
cd vectorstores-api
pip install -r requirements.txt
```

### 2. Configuration

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Edit `.env` with your actual configuration values:

- Azure Storage credentials
- OpenAI/Azure OpenAI settings
- Redis/Celery configuration
- Authentication secrets

### 3. Start the Services

#### Start Redis (required for Celery)
```bash
redis-server
```

#### Start Celery Worker
```bash
celery -A worker.celery_app worker --loglevel=info
```

#### Start the API Server
```bash
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## API Endpoints

### Authentication
All endpoints require JWT authentication via Bearer token.

### Core Endpoints

- `POST /api/v1/vectorstores/indexDocumentFromAzureDatalake` - Index document from Azure Data Lake
- `POST /api/v1/vectorstores/vectorIds` - Get vector IDs by filter
- `DELETE /api/v1/vectorstores/vectorIds` - Delete documents by vector IDs
- `GET /api/v1/vectorstores/tokensNumber/{indexing_id}` - Get indexing token count
- `GET /api/v1/vectorstores/task/{task_id}` - Get task status
- `POST /api/v1/vectorstores/process_docs` - Process documents and extract relationships

### Health Check
- `GET /health` - API health status

## Project Structure

```
vectorstores-api/
├── main.py                    # FastAPI application entry point
├── worker.py                  # Celery tasks and configuration
├── requirements.txt           # Python dependencies
├── .env.example              # Environment configuration template
├── src/
│   ├── config/               # Configuration management
│   ├── dependencies/         # FastAPI dependencies (auth, etc.)
│   ├── helpers/              # Helper functions and utilities
│   ├── logger/               # Logging configuration
│   ├── middleware/           # FastAPI middleware
│   ├── modules/              # Core modules (Azure Data Lake, etc.)
│   ├── routers/              # API route handlers
│   ├── schema/               # Pydantic models and schemas
│   └── vectorstores_api_client/  # Vector store client operations
└── tests/                    # Test files (to be implemented)
```

## Key Components

### Document Indexing
- Downloads documents from Azure Data Lake
- Processes documents with optional smart chunking
- Supports image extraction and analysis
- Handles various brain types (doc, graph)

### Similarity Search
- Vector similarity search with scoring
- Multi-query support
- Configurable filters and parameters

### Task Management
- Celery-based background processing
- Task status monitoring
- Webhook notifications
- Error handling and retry logic

### Authentication & Security
- JWT-based authentication
- Redis session management
- Comprehensive error handling
- Request validation

## Environment Variables

Key configuration variables (see `.env.example` for complete list):

- `AZURE_STORAGE_ACCOUNT` - Azure Storage account name
- `AZURE_STORAGE_ACCOUNT_KEY` - Azure Storage account key
- `CELERY_BROKER_URL` - Redis URL for Celery broker
- `SECRET_KEY` - JWT secret key
- `OPENAI_API_KEY` - OpenAI API key
- `AZURE_AI_SEARCH_ENDPOINT` - Azure AI Search endpoint

## Development Notes

This is a simplified standalone version extracted from a larger application. Some components are implemented as placeholders and will need to be completed based on your specific vectorstore implementation:

- Vector store client operations (similarity search, indexing, querying)
- Celery task implementations
- Azure Data Lake file processing
- Document chunking and embedding logic

## Error Handling

The API includes comprehensive error handling with structured error responses:

- `VectorstoreValidationError` - Input validation errors
- `VectorstoreIndexingError` - Document indexing errors
- `VectorstoreSearchError` - Search operation errors
- `VectorstoreConnectionError` - Connection-related errors
- `VectorstoreDeletionError` - Document deletion errors
- `VectorstoreWebhookError` - Webhook notification errors
## Celery Workers

### Linux/macOS (Prefork Pool)
Use `prefork` on Linux/macOS for better performance.

### Conversion Worker (New)
Dedicated worker for converting non-PDF documents to PDF format. This worker handles the conversion workflow for files that are not already in PDF format (DOC, DOCX, PPT, etc.).

```shell
celery -A worker.celery_app worker --loglevel=info -P prefork -Q conversion -c 2 -n conversion@%h
```

Redis Index worker:
```shell
celery -A worker.celery_app worker --loglevel=info -P prefork -Q redis-index -c 1 -n redis-index@%h
```

### Windows (Eventlet Pool)
If you run the project on Windows, use the `eventlet` pool instead of `prefork`.

```shell
python -m celery -A worker worker --loglevel=info -P eventlet -Q redis-index -n redis-index@%h
```

```shell
python -m celery -A worker worker --loglevel=info -P eventlet -Q qdrant-index.low-priority,default,conversion@%h
```

```shell
python -m celery -A worker worker --loglevel=info -P eventlet -Q image-indexation -n image-indexation@%h
```

```shell
python -m celery -A worker worker --loglevel=info -P eventlet -Q text-indexation -n text-indexation@%h
```

```shell
python -m celery -A worker flower --loglevel=info --broker=redis://127.0.0.1:6379/0 --port=5555
```

```shell
python -A worker.celery_app worker --loglevel=info -P eventlet -Q logical-indexing -c 5 -n logical-indexing
```



### Search Workers
```shell
celery -A worker.celery_app worker --loglevel=info -P prefork -Q qdrant-index.low-priority -c 5 -n qdrant-index.low-priority@%h
```


```shell
celery -A worker.celery_app worker --loglevel=info -P prefork -Q default -c 3 -n default@%h
```
```shell
#celery -A worker.celery_app worker --loglevel=info -P prefork -Q conformity.default -c 1 -n conformity.default@%h
```

```shell
#celery -A worker.celery_app worker --loglevel=info -P prefork -Q data-processing.batch -c 10 -n data-processing.batch@%h
```
```shell
celery -A worker.celery_app worker --loglevel=info -P prefork -Q image-indexation -c 5 -n image-indexation@%h
 ```
```shell
celery -A worker.celery_app worker --loglevel=info -P prefork -Q text-indexation -c 5 -n text-indexation@%h
```

```shell
#celery -A worker.celery_app worker --loglevel=info -P prefork -Q smart-chunking -c 5 -n smart-chunking@%h
```

```shell
celery -A worker.celery_app flower --loglevel=info
```

```shell
celery -A worker.celery_app worker --loglevel=info -P prefork -Q logical-indexing -c 5 -n logical-indexing
```

## Logging

Structured logging with correlation IDs and multiple output formats (JSON, console) supported via environment variables.

## Contributing

This is a foundational implementation that can be extended based on specific requirements. Key areas for enhancement:

1. Complete vector store client implementations
2. Add comprehensive test coverage
3. Implement actual document processing pipelines
4. Add monitoring and metrics
5. Optimize performance and scalability

