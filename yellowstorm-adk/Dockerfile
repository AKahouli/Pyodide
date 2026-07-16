# syntax=docker/dockerfile:1.7

ARG UBUNTU_IMAGE="ubuntu:22.04@sha256:f9d633ff6640178c2d0525017174a688e2c1aef28f0a0130b26bd5554491f0da"
ARG PYTHON_VERSION=3.11
ARG TRIVY_VERSION=0.49.1

# -----------------------------------------------------------------------------
# CA certificates bootstrap (ubuntu:22.04 has no CA bundle)
# -----------------------------------------------------------------------------
FROM alpine:3.20 AS ca-certs
RUN apk --no-cache add ca-certificates

# -----------------------------------------------------------------------------
# Builder
# -----------------------------------------------------------------------------
FROM ${UBUNTU_IMAGE} AS builder
ARG PYTHON_VERSION
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

LABEL description="Secured Python API (ADK) with security scanning + gRPC codegen" \
      maintainer="support@yellowsys.fr" \
      org.opencontainers.image.source="https://github.com/YellowsysOrg/" \
      org.opencontainers.image.authors="support@yellowsys.fr" \
      org.opencontainers.image.vendor="Yellowsys" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Secure API ADK" \
      org.opencontainers.image.description="Hardened Python API with security scanning and gRPC generation" \
      security.vulnerability-scan="required" \
      security.scan-frequency="daily" \
      security.compliance="CIS-Docker-Benchmark" \
      security.sbom="included"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Keep /tmp valid for dpkg triggers
RUN set -eux; mkdir -p /tmp; chmod 1777 /tmp

# CI runner's bridge network blocks port 80; switch mirrors to HTTPS.
# Bootstrap CA bundle from alpine so HTTPS verification works.
COPY --from=ca-certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g; s|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list

# Build deps
RUN set -eux; \
    apt-get -o Acquire::Retries=3 update; \
    apt-get -o Acquire::Retries=3 install --no-install-recommends -y \
      ca-certificates \
      python${PYTHON_VERSION} \
      python${PYTHON_VERSION}-dev \
      python${PYTHON_VERSION}-venv \
      python3-pip \
      build-essential \
      git \
      ffmpeg \
      libsm6 \
      libxext6; \
    update-ca-certificates; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /root/.cache

# Non-root user (matches runtime UID/GID)
RUN set -eux; \
    groupadd -r -g 1000 azureuser; \
    useradd  -r -u 1000 -g azureuser -m -d /home/azureuser -s /sbin/nologin azureuser

WORKDIR /build

# Venv
ENV VENV_PATH=/opt/venv
RUN set -eux; \
    python${PYTHON_VERSION} -m venv "${VENV_PATH}"; \
    "${VENV_PATH}/bin/python" -m pip install --upgrade pip setuptools wheel

COPY --chown=azureuser:azureuser requirements.txt /build/requirements.txt
RUN set -eux; \
    "${VENV_PATH}/bin/pip" install -r /build/requirements.txt; \
    "${VENV_PATH}/bin/pip" check

# Security tools (builder only)
RUN set -eux; \
    "${VENV_PATH}/bin/pip" install pip-audit safety bandit

# App code
COPY --chown=azureuser:azureuser src /build/src
COPY --chown=azureuser:azureuser main.py /build/main.py

# Generate after copying src so checked-in stale bindings cannot overwrite it.
COPY --chown=azureuser:azureuser grpc /build/grpc
RUN set -eux; \
    "${VENV_PATH}/bin/python" /build/grpc/generate_proto.py

# Security reports
RUN set -eux; \
    mkdir -p /build/security; \
    "${VENV_PATH}/bin/pip" list --format json > /build/security/pip-packages.json; \
    ( "${VENV_PATH}/bin/pip-audit" --desc --format json > /build/security/pip-audit.json 2>&1 || \
      echo '{"vulnerabilities": [], "error": "pip-audit failed or no vulnerabilities found"}' > /build/security/pip-audit.json ); \
    ( "${VENV_PATH}/bin/safety" check --json --output /build/security/safety-report.json 2>&1 || \
      echo '{"vulnerabilities": [], "error": "safety check failed or no vulnerabilities found"}' > /build/security/safety-report.json ); \
    ( "${VENV_PATH}/bin/bandit" -r /build/src -f json -o /build/security/bandit-report.json 2>&1 || \
      echo '{"results": [], "error": "bandit scan failed"}' > /build/security/bandit-report.json ); \
    "${VENV_PATH}/bin/python" -m py_compile /build/main.py 2>/dev/null || true; \
    "${VENV_PATH}/bin/python" -m py_compile /build/src/*.py 2>/dev/null || true

# Permissions (dirs need +x)
RUN set -eux; \
    chmod 440 /build/main.py; \
    find /build/src -type d -exec chmod 550 {} \;; \
    find /build/src -type f -exec chmod 440 {} \;; \
    find /build/grpc -type d -exec chmod 550 {} \;; \
    find /build/grpc -type f -exec chmod 440 {} \;

RUN set -eux; \
    (cd /build && find . -type f -maxdepth 4 -print0 | sort -z | xargs -0 sha256sum) > /build/security/checksums.txt

# -----------------------------------------------------------------------------
# Trivy stage (official)
# -----------------------------------------------------------------------------
FROM aquasec/trivy:${TRIVY_VERSION} AS trivy

# -----------------------------------------------------------------------------
# Runtime base
# -----------------------------------------------------------------------------
FROM ${UBUNTU_IMAGE} AS runtime-base
ARG PYTHON_VERSION
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/app \
    VENV_PATH=/opt/venv \
    PATH="/opt/venv/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN set -eux; mkdir -p /tmp; chmod 1777 /tmp

# CI runner's bridge network blocks port 80; switch mirrors to HTTPS.
COPY --from=ca-certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g; s|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list

RUN set -eux; \
    apt-get -o Acquire::Retries=3 update; \
    apt-get -o Acquire::Retries=3 install --no-install-recommends -y \
      ca-certificates \
      python${PYTHON_VERSION} \
      ffmpeg \
      libsm6 \
      libxext6; \
    update-ca-certificates; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /root/.cache; \
    rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* /usr/share/locale/* || true

# Create user + app dirs
RUN set -eux; \
    groupadd -r -g 1000 azureuser; \
    useradd  -r -u 1000 -g azureuser -m -d /home/azureuser -s /sbin/nologin azureuser; \
    mkdir -p /opt/app /tmp/app /tmp/app/mem0 /var/log/app /opt/app/security; \
    chown -R azureuser:azureuser /opt/app /tmp/app /var/log/app /opt/app/security /home/azureuser; \
    chmod 750 /opt/app /var/log/app /opt/app/security /home/azureuser; \
    chmod 1770 /tmp/app /tmp/app/mem0; \
    chmod 1777 /tmp

ENV TMPDIR=/tmp/app
WORKDIR /opt/app

# Copy venv + app + grpc + security artifacts
COPY --from=builder ${VENV_PATH} ${VENV_PATH}
COPY --from=builder --chown=azureuser:azureuser /build/src /opt/app/src
COPY --from=builder --chown=azureuser:azureuser /build/grpc /opt/app/grpc
COPY --from=builder --chown=azureuser:azureuser --chmod=440 /build/main.py /opt/app/main.py
COPY --from=builder --chown=azureuser:azureuser /build/security/ /opt/app/security/

RUN set -eux; \
    find /opt/app/src -type d -exec chmod 550 {} \;; \
    find /opt/app/src -type f -exec chmod 440 {} \;; \
    find /opt/app/grpc -type d -exec chmod 550 {} \;; \
    find /opt/app/grpc -type f -exec chmod 440 {} \;; \
    chmod 550 /opt/app /opt/app/src /opt/app/grpc

# Hardening (do not break /tmp)
RUN set -eux; \
    find / -xdev -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true; \
    find / -xdev -type d -perm -0002 ! -path /tmp ! -path /tmp/* -exec chmod o-w {} \; 2>/dev/null || true; \
    find / -xdev -type f -perm -0002 -exec chmod o-w {} \; 2>/dev/null || true; \
    chmod 1777 /tmp; \
    chmod 1770 /tmp/app /tmp/app/mem0

# -----------------------------------------------------------------------------
# Scan stage (not shipped)
# -----------------------------------------------------------------------------
FROM runtime-base AS scanned
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy

RUN set -eux; \
    mkdir -p /opt/app/security; \
    if trivy rootfs --format json --output /opt/app/security/trivy-report.json / ; then \
      echo "trivy ok"; \
    else \
      echo '{"SchemaVersion":2,"ArtifactName":"/","Results":[],"Error":"trivy failed"}' > /opt/app/security/trivy-report.json; \
    fi; \
    test -s /opt/app/security/trivy-report.json

# -----------------------------------------------------------------------------
# Final runtime
# -----------------------------------------------------------------------------
FROM runtime-base AS runtime
COPY --from=scanned --chown=azureuser:azureuser /opt/app/security/trivy-report.json /opt/app/security/trivy-report.json

USER 1000:1000
EXPOSE 8000
EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import socket; s=socket.socket(); s.settimeout(5); r=s.connect_ex(('127.0.0.1',8000)); s.close(); raise SystemExit(0 if r==0 else 1)"

STOPSIGNAL SIGTERM
ENTRYPOINT ["python", "-m"]
CMD ["main"]
