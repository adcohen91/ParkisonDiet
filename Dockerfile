# Stage 1: Build the Vite frontend
FROM node:22-alpine AS frontend-build

WORKDIR /build

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Stage 2: Python backend + static assets
FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install Python dependencies
COPY backend/pyproject.toml backend/uv.lock* ./
RUN uv sync --frozen --no-dev

# Copy application code
COPY backend/ ./backend/
COPY knowledge/ ./knowledge/

# Copy built frontend
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

WORKDIR /app/backend

EXPOSE 3000

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
