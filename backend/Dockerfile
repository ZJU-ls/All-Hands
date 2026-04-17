# allhands backend image.
# Uses `uv` for fast, lock-coherent installs. Two-stage build keeps runtime slim.

FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

WORKDIR /app

# Install deps first for better cache hits.
COPY pyproject.toml ./
RUN uv sync --no-install-project --no-dev

# Now copy source.
COPY src ./src
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY ruff.toml ./ruff.toml
COPY .importlinter ./.importlinter
RUN uv sync --no-dev

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8000

# On container start: apply migrations (idempotent), then serve.
CMD ["sh", "-c", "alembic upgrade head && uvicorn allhands.main:app --host 0.0.0.0 --port 8000"]
