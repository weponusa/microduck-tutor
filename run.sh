#!/bin/bash
# 启动 MicroDuck 模拟器（纯本地，不联网）
set -e
cd "$(dirname "$0")"
PORT="${1:-5173}"
echo "→ http://127.0.0.1:${PORT}/"
exec python3 -m http.server "${PORT}" --bind 127.0.0.1
