FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && addgroup --system playbook \
    && adduser --system --ingroup playbook playbook

COPY --chown=playbook:playbook . ./
USER playbook
EXPOSE 8025
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8025/health/ready', timeout=3)"]
CMD ["python", "server.py"]
