#!/usr/bin/env bash
# 다른 사람이 인터넷으로 들어올 수 있게: 게임 서버 + Cloudflare 임시 터널(계정 불필요)을 띄우고 공개 주소를 출력한다.
# 사용: npm run share   (Ctrl+C 로 둘 다 종료)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8080}"
CF="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"
if [ ! -x "$CF" ]; then
  echo "cloudflared 내려받는 중..."
  mkdir -p "$HOME/.local/bin"
  curl -fsSL -o "$HOME/.local/bin/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$HOME/.local/bin/cloudflared"; CF="$HOME/.local/bin/cloudflared"
fi
node tools/build.js
# 터널이 프록시이므로 접속자 IP는 X-Forwarded-For 로 판단 (IP당 접속 제한이 정상 동작)
TRUST_PROXY=1 PORT="$PORT" node server/server.js &
SRV=$!
LOG="$(mktemp)"
"$CF" tunnel --url "http://localhost:$PORT" --no-autoupdate >"$LOG" 2>&1 &
TUN=$!
trap 'kill $SRV $TUN 2>/dev/null; rm -f "$LOG"' EXIT INT TERM
for _ in $(seq 1 40); do
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break; sleep 0.5
done
if [ -z "${URL:-}" ]; then echo "터널 주소를 받지 못했어요. 로그:"; cat "$LOG"; exit 1; fi
echo
echo "========================================"
echo " 이 주소를 친구에게 보내세요:"
echo "   $URL"
echo " (주소가 연결되기까지 10~30초 걸릴 수 있어요. 끄려면 Ctrl+C)"
echo "========================================"
wait $SRV
