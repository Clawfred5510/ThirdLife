#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-8080}"

echo "========================================="
echo "  ThirdLife — Build & Standalone Launcher"
echo "========================================="
echo ""

# ── Build all packages ────────────────────────────────────────────────────
echo "📦 Building all packages..."
npm run build
echo "✅ Build complete"
echo ""

# ── Start standalone server ───────────────────────────────────────────────
echo "🚀 Starting standalone server on port $PORT..."
echo ""
PORT="$PORT" npm run standalone
