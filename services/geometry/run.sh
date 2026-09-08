#!/usr/bin/env bash
# Start the QuoteForge geometry service (turned-profile extraction).
# First run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
set -euo pipefail
cd "$(dirname "$0")"
PORT="${GEOMETRY_PORT:-8000}"
exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$PORT" "$@"
