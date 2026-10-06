FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && addgroup --system pyodide \
    && adduser --system --ingroup pyodide pyodide

COPY --chown=pyodide:pyodide . ./
USER pyodide
EXPOSE 8027
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8027/health/ready', timeout=3)"]
CMD ["python", "server.py"]
