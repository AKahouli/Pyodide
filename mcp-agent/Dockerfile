FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && addgroup --system agentmcp \
    && adduser --system --ingroup agentmcp agentmcp

COPY --chown=agentmcp:agentmcp . ./
USER agentmcp
EXPOSE 8026
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8026/health/ready', timeout=3)"]
CMD ["python", "server.py"]
