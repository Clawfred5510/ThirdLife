#!/bin/bash
# ThirdLife Game Launcher
# Starts the standalone server + cloudflared tunnel and keeps them running

GAME_DIR="/home/z/ThirdLife"
SERVER_DIR="$GAME_DIR/packages/server"
LOG="/tmp/thirdlife.log"

echo "=== ThirdLife Game Launcher ===" > "$LOG"
echo "Starting at $(date)" >> "$LOG"

# Start the game server
cd "$SERVER_DIR"
node dist/standalone.js >> "$LOG" 2>&1 &
SERVER_PID=$!
echo "Game server PID: $SERVER_PID" >> "$LOG"

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s --max-time 1 http://127.0.0.1:8080/ > /dev/null 2>&1; then
    echo "Server ready after ${i}s" >> "$LOG"
    break
  fi
  sleep 1
done

# Start cloudflared tunnel
cloudflared tunnel --url http://127.0.0.1:8080 >> "$LOG" 2>&1 &
CF_PID=$!
echo "Cloudflared PID: $CF_PID" >> "$LOG"

# Wait for tunnel URL
sleep 15
TUNNEL_URL=$(rg -oP 'https://[a-z0-9\-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)
echo "TUNNEL_URL=$TUNNEL_URL"

if [ -n "$TUNNEL_URL" ]; then
  echo "SUCCESS: Game is live at $TUNNEL_URL"
else
  echo "WARNING: Could not get tunnel URL. Server is at http://localhost:8080"
fi

# Keep script alive
echo "Press Ctrl+C to stop"
wait
