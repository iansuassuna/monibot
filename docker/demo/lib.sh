# Helpers shared by the local demo scripts. Sourced, never executed.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA="$ROOT/docker/demo/.data"
RUNTIME="${CONTAINER_RUNTIME:-podman}"
SYNAPSE=monibot-synapse

# Reads one KEY=value from .env without sourcing it (values may contain unquoted spaces).
env_value() {
  local value
  value="$(grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2-)"
  printf '%s' "${value:-$2}"
}

wait_for() {
  local description="$1"; shift
  for _ in $(seq 1 "${WAIT_SECONDS:-30}"); do
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

appservice_state() {
  "$RUNTIME" exec "$SYNAPSE" python -c "
import sqlite3
c = sqlite3.connect('/data/homeserver.db')
row = c.execute(\"select state from application_services_state where as_id = 'monibot'\").fetchone()
print(row[0] if row else 'up')
" 2>/dev/null
}

appservice_is_up() { [ "$(appservice_state)" = "up" ]; }

# Makes Synapse deliver the call memberships it is holding for the API. Two cases:
# - its retry loop is sleeping in exponential backoff (up to 8.5 min): the appservice ping forces
#   a retry now;
# - Synapse restarted with transactions queued: no retry loop exists until a new event arrives,
#   so the bot creates and leaves a room.
wake_appservice() {
  local token room
  token="$(env_value MATRIX_AS_TOKEN '')"
  [ -n "$token" ] || return 1
  curl -fsS -m 20 -o /dev/null -X POST -H "Authorization: Bearer $token" \
    -H 'content-type: application/json' -d '{}' \
    http://127.0.0.1:8008/_matrix/client/v1/appservice/monibot/ping || true
  WAIT_SECONDS=5 wait_for "Synapse retried after a ping" appservice_is_up >/dev/null 2>&1 && return 0
  room="$(curl -fsS -m 10 -X POST -H "Authorization: Bearer $token" -H 'content-type: application/json' \
    -d '{"name":"monibot-appservice-wake-up","preset":"private_chat"}' \
    'http://127.0.0.1:8008/_matrix/client/v3/createRoom?user_id=@monibot:localhost' \
    | python3 -c 'import sys, json; print(json.load(sys.stdin)["room_id"])')" || return 1
  curl -fsS -m 10 -o /dev/null -X POST -H "Authorization: Bearer $token" -H 'content-type: application/json' \
    -d '{}' "http://127.0.0.1:8008/_matrix/client/v3/rooms/$room/leave?user_id=@monibot:localhost"
}
