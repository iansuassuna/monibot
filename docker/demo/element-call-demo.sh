#!/usr/bin/env bash
# Local Element Call demo (presentation mode) on top of the standalone Podman/Docker containers.
#
#   bun run demo:up     # presentation mode
#   bun run demo:down   # back to the default behaviour (as in docker/docker-compose.yml)
#
# Why presentation mode needs extra pieces:
# - lk-jwt-service validates the caller's Matrix OpenID token over the *federation* API, which is
#   HTTPS on port 8448 for server_name `localhost`; Synapse only speaks HTTP on 8008. A Caddy proxy
#   terminates TLS on 8448 with a certificate from its own local CA (`--internal-certs`).
# - TLS verification stays ON: lk-jwt-service trusts the public CAs *plus* that local CA.
# - Under rootless Podman (pasta), `localhost` resolves to ::1 and the connection is reset, so the
#   browser-facing Element Call config points at 127.0.0.1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA="$ROOT/docker/demo/.data"
RUNTIME="${CONTAINER_RUNTIME:-podman}"

TLS_PROXY=monibot-fed-tls
LK_JWT=monibot-lk-jwt
ELEMENT_CALL=monibot-element-call
SYNAPSE=monibot-synapse

# Same pins as docker/docker-compose.yml (versions verified together).
LK_JWT_IMAGE=ghcr.io/element-hq/lk-jwt-service@sha256:2c985ab98de8da3b101c09fb597404dcb2723bb984b1ee20a430a8bb4f6a51a9
ELEMENT_CALL_IMAGE=ghcr.io/element-hq/element-call:v0.28.0
CADDY_IMAGE=docker.io/library/caddy:2.11.9

# Reads one KEY=value from .env without sourcing it (values may contain unquoted spaces).
env_value() {
  local value
  value="$(grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2-)"
  printf '%s' "${value:-$2}"
}

system_ca_bundle() {
  local candidate
  for candidate in \
    /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    /etc/ssl/certs/ca-certificates.crt \
    /etc/ssl/cert.pem; do
    [ -f "$candidate" ] && { printf '%s' "$candidate"; return; }
  done
  echo "No system CA bundle found" >&2
  exit 1
}

remove_container() {
  "$RUNTIME" rm -f "$1" >/dev/null 2>&1 || true
}

wait_for() {
  local description="$1"; shift
  for _ in $(seq 1 30); do
    "$@" >/dev/null 2>&1 && { echo "  ok  $description"; return 0; }
    sleep 1
  done
  echo "  FAIL $description" >&2
  return 1
}

# Whether Synapse's route to the host works, with or without the API running: a refused connection
# means the host answered (nothing on :3001 yet); a stale route after a network change times out.
synapse_reaches_host() {
  "$RUNTIME" exec "$SYNAPSE" python -c "
import socket, sys
s = socket.socket()
s.settimeout(3)
try:
    s.connect(('host.containers.internal', 3001))
except ConnectionRefusedError:
    pass
except OSError:
    sys.exit(1)
" >/dev/null 2>&1
}

synapse_reaches_api() {
  "$RUNTIME" exec "$SYNAPSE" python -c \
    "import urllib.request as u; u.urlopen('http://host.containers.internal:3001/api/health', timeout=3)" \
    >/dev/null 2>&1
}

run_lk_jwt() {
  local key secret
  key="$(env_value LIVEKIT_API_KEY devkey)"
  secret="$(env_value LIVEKIT_API_SECRET secret)"
  remove_container "$LK_JWT"
  "$RUNTIME" run -d --name "$LK_JWT" --network host "$@" \
    -e LIVEKIT_JWT_PORT=8080 \
    -e LIVEKIT_URL=ws://localhost:7880 \
    -e LIVEKIT_KEY="$key" \
    -e LIVEKIT_SECRET="$secret" \
    -e LIVEKIT_FULL_ACCESS_HOMESERVERS=localhost \
    "$LK_JWT_IMAGE" >/dev/null
}

run_element_call() {
  remove_container "$ELEMENT_CALL"
  "$RUNTIME" run -d --name "$ELEMENT_CALL" -p 127.0.0.1:8090:8080 \
    -v "$1:/app/config.json:ro,Z" "$ELEMENT_CALL_IMAGE" >/dev/null
}

up() {
  "$RUNTIME" container exists "$SYNAPSE" 2>/dev/null || "$RUNTIME" inspect "$SYNAPSE" >/dev/null 2>&1 || {
    echo "Container $SYNAPSE not found: start Synapse first (see README)." >&2
    exit 1
  }
  mkdir -p "$DATA/caddy"

  echo "Federation TLS proxy (Caddy, local CA) on :8448 -> Synapse :8008"
  remove_container "$TLS_PROXY"
  "$RUNTIME" run -d --name "$TLS_PROXY" --network host -v "$DATA/caddy:/data:Z" "$CADDY_IMAGE" \
    caddy reverse-proxy --from https://localhost:8448 --to 127.0.0.1:8008 \
    --internal-certs --disable-redirects >/dev/null
  local caddy_root="$DATA/caddy/caddy/pki/authorities/local/root.crt"
  wait_for "Caddy local CA created" test -s "$caddy_root"
  cat "$(system_ca_bundle)" "$caddy_root" > "$DATA/ca-bundle.pem"
  wait_for "federation API over verified TLS" \
    curl -fsS -m 3 --cacert "$caddy_root" https://localhost:8448/_matrix/federation/v1/version

  echo "lk-jwt-service trusting public CAs + the Caddy CA (verification on)"
  run_lk_jwt -v "$DATA/ca-bundle.pem:/etc/ssl/certs/demo-ca-bundle.pem:ro,Z" \
    -e SSL_CERT_FILE=/etc/ssl/certs/demo-ca-bundle.pem
  wait_for "lk-jwt-service healthy on :8080" curl -fsS -m 3 http://127.0.0.1:8080/healthz

  echo "Element Call on :8090 (homeserver and focus via 127.0.0.1)"
  sed 's|http://localhost:|http://127.0.0.1:|g' "$ROOT/docker/element-call/config.json" \
    > "$DATA/element-call-config.json"
  run_element_call "$DATA/element-call-config.json"
  wait_for "Element Call serving" curl -fsS -m 3 http://127.0.0.1:8090/config.json

  # Rootless Podman maps host.containers.internal to the host address of when the container
  # started; after a network change (other Wi-Fi) Synapse silently stops delivering call
  # memberships to the API. Restarting Synapse refreshes the mapping. Checked even before the API
  # runs, so `demo:up && dev:full` cannot leave a stale route behind.
  if ! synapse_reaches_host; then
    echo "  ..  Synapse cannot reach the host (network changed?): restarting Synapse"
    "$RUNTIME" restart "$SYNAPSE" >/dev/null
    wait_for "Synapse back on :8008" curl -fsS -m 3 http://127.0.0.1:8008/_matrix/client/versions
  fi
  wait_for "Synapse reaches the host (appservice path)" synapse_reaches_host
  if curl -fsS -m 3 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    wait_for "Synapse reaches the MoniBot API on :3001" synapse_reaches_api
  else
    echo "  ..  MoniBot API not running yet: start it with \`bun run dev:full\`"
  fi

  echo
  "$RUNTIME" ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo
  echo "Presentation mode ready: http://localhost:8090"
}

down() {
  echo "Removing the federation TLS proxy"
  remove_container "$TLS_PROXY"
  echo "lk-jwt-service back to the image's default trust store (as in docker-compose.yml)"
  run_lk_jwt
  echo "Element Call back to docker/element-call/config.json"
  run_element_call "$ROOT/docker/element-call/config.json"
  rm -f "$DATA/ca-bundle.pem" "$DATA/element-call-config.json"
  echo
  "$RUNTIME" ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo
  echo "Default behaviour restored. The Caddy CA stays in docker/demo/.data/caddy for the next demo:up."
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "Usage: $0 up|down" >&2; exit 2 ;;
esac
