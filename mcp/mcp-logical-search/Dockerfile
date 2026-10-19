FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.1 \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY . .

ARG LANGUAGE_MODEL_URL=https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin
RUN python scripts/provision_language_model.py \
    --url "$LANGUAGE_MODEL_URL" \
    --destination /app/models/lid.176.bin

RUN groupadd --gid 10001 mcp \
    && useradd --uid 10001 --gid mcp --no-create-home --shell /usr/sbin/nologin mcp \
    && mkdir -p /app/logs \
    && chown -R mcp:mcp /app/logs /app/models

USER 10001:10001

EXPOSE 8045

CMD ["python", "run_mcp_server.py"]
