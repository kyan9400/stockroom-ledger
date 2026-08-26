FROM node:24-alpine AS web-builder

WORKDIR /build
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.13-slim AS api-builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /build
COPY backend/pyproject.toml ./
COPY backend/src ./src
RUN python -m pip wheel --wheel-dir /wheels .

FROM python:3.13-slim AS runner

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STOCKROOM_DATABASE=/data/stockroom.db
WORKDIR /app

RUN apt-get update \
    && apt-get upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1001 stockroom \
    && useradd --uid 1001 --gid stockroom --create-home stockroom \
    && mkdir -p /data \
    && chown stockroom:stockroom /data
COPY --from=api-builder /wheels /wheels
RUN python -m pip install --no-cache-dir /wheels/* \
    && python -m pip uninstall --yes pip setuptools \
    && rm -rf /wheels
COPY --from=api-builder /build/src /app/backend/src
COPY --from=web-builder /build/dist /app/frontend/dist

USER stockroom
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"

ENV PYTHONPATH=/app/backend/src
CMD ["uvicorn", "stockroom.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]

