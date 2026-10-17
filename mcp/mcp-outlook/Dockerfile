FROM python:3.11-slim

WORKDIR /app

# LibreOffice renders a .docx to PDF so its first page can be extracted exactly:
# a Word file stores no pagination, only a renderer produces pages.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice-writer \
        fonts-liberation \
        fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY graph_helpers.py .
COPY mail_enumeration.py .
COPY mail_export.py .
COPY server.py .

# Create non-root user
RUN useradd -m -u 1002 mcpuser && \
    chown -R mcpuser:mcpuser /app
USER mcpuser

# Expose port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8002/health/live', timeout=5).raise_for_status()"

# Run the server
CMD ["python", "server.py"]
