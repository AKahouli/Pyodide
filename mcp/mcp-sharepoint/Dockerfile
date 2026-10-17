FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY graph_helpers.py .
COPY document_tools.py .
COPY server.py .

# Create non-root user
RUN useradd -m -u 1001 mcpuser && \
    chown -R mcpuser:mcpuser /app
USER mcpuser

# Expose port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8001/health/live', timeout=5).raise_for_status()"

# Run the server
CMD ["python", "server.py"]
