# syntax=docker/dockerfile:1.7
ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim AS builder
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.txt ./
RUN pip install --upgrade pip setuptools wheel \
 && pip install -r requirements.txt

FROM python:${PYTHON_VERSION}-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/app \
    PORT=8011
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin worky
WORKDIR /opt/app
COPY --from=builder /usr/local/lib/python${PYTHON_VERSION}/site-packages /usr/local/lib/python${PYTHON_VERSION}/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --chown=worky:worky app /opt/app/app
USER worky
EXPOSE 8011
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request, sys; \
import json; r=urllib.request.urlopen('http://127.0.0.1:8011/health', timeout=3); \
body=json.loads(r.read()); sys.exit(0 if body.get('status')=='ok' else 1)"
ENTRYPOINT ["python", "-m", "app.main"]
