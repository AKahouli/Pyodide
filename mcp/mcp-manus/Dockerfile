FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir "mcp[cli]>=1.2,<2" httpx pydantic-settings python-dotenv

COPY sandbox_mcp/ ./sandbox_mcp/
COPY main.py .

EXPOSE 8001

CMD ["python", "main.py"]
