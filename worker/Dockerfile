FROM python:3.11-slim

# Install compilation utilities for psutil
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy daemon script
COPY daemon.py .

# Environment Defaults
ENV BACKEND_URL=http://localhost:8000
ENV REGISTRATION_TOKEN=clusterdash-worker-secret-token
ENV HEARTBEAT_INTERVAL=5
ENV NODE_ROLE=worker
ENV CONFIG_PATH=/app/.worker_config.json

# Run daemon
CMD ["python", "daemon.py"]
