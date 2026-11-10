#!/usr/bin/env bash
# Brings the local prototype up for a presentation, from a cold machine, and proves it is ready.
#
#   bun run present     # containers → warm models → Element Call demo → apps → checks → follow logs
#
# Ctrl+C stops the apps (web, API, agent worker); the containers keep running.
#
# Every step exists because of a failure seen in rehearsal (S5, 2026-11-10):
# - nothing restarts after a reboot (rootless Podman has no restart service enabled);
# - without a warm-up the first answer pays ~20 s of model loading;
# - the warm-up must use the real options, or Ollama/speaches load a second copy;
# - after a network change Synapse silently stops delivering call memberships (demo:up fixes it),
#   and undelivered call memberships wait in Synapse's backoff (or, after a Synapse restart, for
#   a new event) before they are retried;
# - Turborepo's strict env mode drops variables set on the command line.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CONTAINERS=(monibot-pg monibot-ollama monibot-speaches monibot-livekit monibot-synapse)
# Versions verified together with Element Call v0.28.0 (docker/docker-compose.yml).
SYNAPSE_VERSION=1.163.0
LIVEKIT_VERSION=1.13.10
API=http://127.0.0.1:3001
APP_LOG="$DATA/present.log"

STARTED_AT=$SECONDS
step_started=$SECONDS
step() {
  echo
  echo "▸ $1"
  step_started=$SECONDS
}
step_done() { echo "  ($((SECONDS - step_started)) s)"; }
fail() {
  echo "  FAIL $1" >&2
  exit 1
}

preflight() {
  step "Pre-checks"
  [ -f "$ROOT/.env" ] || fail ".env not found: cp .env.example .env and fill in the secrets"
  if curl -fsS -m 2 "$API/api/health" >/dev/null 2>&1 \
    || curl -fsS -m 2 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
    fail "the web or API is already running (stop \`bun run dev\` / \`dev:full\` first)"
  fi
  if [ "$(env_value OLLAMA_EMBED_NUM_GPU '')" != "0" ]; then
    echo "  !!  OLLAMA_EMBED_NUM_GPU is not 0: on a small GPU every question evicts the LLM"
    echo "      (answers take 20-30 s). Set OLLAMA_EMBED_NUM_GPU=0 in .env unless the GPU holds both."
  else
    echo "  ok  embedding model stays on the CPU (OLLAMA_EMBED_NUM_GPU=0)"
  fi
  if [ "$(env_value LOG_LEVEL info)" = "debug" ]; then
    echo "  ..  .env has LOG_LEVEL=debug (logs transcripts): this run uses info"
  fi
  step_done
}

start_containers() {
  step "Containers"
  local name
  for name in "${CONTAINERS[@]}"; do
    "$RUNTIME" container exists "$name" 2>/dev/null \
      || fail "container $name does not exist: create it as in README → Quick start"
  done
  "$RUNTIME" start "${CONTAINERS[@]}" >/dev/null
  WAIT_SECONDS=60 wait_for "Postgres" "$RUNTIME" exec monibot-pg pg_isready -U monibot -d monibot
  WAIT_SECONDS=60 wait_for "Ollama" curl -fsS -m 2 http://127.0.0.1:11434/api/version
  WAIT_SECONDS=120 wait_for "speaches (STT/TTS)" curl -fsS -m 2 http://127.0.0.1:8000/health
  WAIT_SECONDS=60 wait_for "LiveKit :7880" curl -fsS -m 2 http://127.0.0.1:7880
  WAIT_SECONDS=60 wait_for "Synapse :8008" curl -fsS -m 2 http://127.0.0.1:8008/_matrix/client/versions

  local livekit synapse
  livekit="$("$RUNTIME" exec monibot-livekit /livekit-server --version 2>/dev/null | awk '{print $NF}')"
  synapse="$("$RUNTIME" exec "$SYNAPSE" python -c \
    'import synapse; print(synapse.__version__)' 2>/dev/null)"
  [ "$livekit" = "$LIVEKIT_VERSION" ] && echo "  ok  LiveKit $livekit" \
    || echo "  !!  LiveKit ${livekit:-unknown}, tested with $LIVEKIT_VERSION (Element Call may not show the agent)"
  [ "$synapse" = "$SYNAPSE_VERSION" ] && echo "  ok  Synapse $synapse" \
    || echo "  !!  Synapse ${synapse:-unknown}, tested with $SYNAPSE_VERSION"
  step_done
}

warm_models() {
  step "Warming the models (the first answer would otherwise pay their loading)"
  local llm tts stt
  llm="$(env_value OLLAMA_LLM_MODEL llama3.1:8b)"
  tts="$(env_value TTS_MODEL speaches-ai/piper-pt_BR-faber-medium)"
  stt="$(env_value WHISPER_MODEL Systran/faster-whisper-small)"
  # Default options, as the agent's requests use: different ones would load a second copy.
  curl -fsS -m 300 -o /dev/null http://127.0.0.1:11434/api/generate \
    -d "{\"model\":\"$llm\",\"prompt\":\"ok\",\"stream\":false,\"keep_alive\":-1,\"options\":{\"num_predict\":1}}" \
    || fail "LLM $llm did not load (is it pulled? podman exec monibot-ollama ollama pull $llm)"
  echo "  ok  LLM $llm"
  mkdir -p "$DATA"
  # The agent's TTS sends the OpenAI plugin's default voice; speaches requires the field.
  curl -fsS -m 120 -o "$DATA/warm-up.wav" http://127.0.0.1:8000/v1/audio/speech \
    -H 'content-type: application/json' \
    -d "{\"model\":\"$tts\",\"input\":\"Aquecendo o MoniBot.\",\"voice\":\"alloy\",\"response_format\":\"wav\"}" \
    || fail "TTS $tts did not load"
  echo "  ok  TTS $tts"
  curl -fsS -m 180 -o /dev/null http://127.0.0.1:8000/v1/audio/transcriptions \
    -F "file=@$DATA/warm-up.wav" -F "model=$stt" -F language=pt \
    || fail "STT $stt did not load"
  echo "  ok  STT $stt"
  step_done
}

element_call() {
  step "Element Call presentation mode"
  # The API check runs at the end, once this script has started the apps.
  bash "$ROOT/docker/demo/element-call-demo.sh" up \
    | grep -E '^\s+(ok|FAIL|\.\.|!!)' | grep -v 'MoniBot API not running' || true
  step_done
}

APPS_PID=""
stop_apps() {
  [ -n "$APPS_PID" ] && kill -INT -- "-$APPS_PID" 2>/dev/null || true
  wait "$APPS_PID" 2>/dev/null || true
  echo
  echo "Apps stopped. Containers keep running (podman stop to free the GPU)."
}

start_apps() {
  step "Apps (web :3000, API :3001, agent worker)"
  mkdir -p "$DATA"
  # Own process group, so Ctrl+C stops turbo and every app it started.
  LOG_LEVEL=info setsid bunx turbo run dev \
    --filter=@monibot/web --filter=@monibot/api --filter=@monibot/agent-worker \
    --env-mode=loose >"$APP_LOG" 2>&1 &
  APPS_PID=$!
  trap stop_apps EXIT
  # Ctrl+C is the normal way to stop: exit cleanly so `bun run` does not report an error.
  trap 'exit 0' INT TERM
  WAIT_SECONDS=90 wait_for "API" curl -fsS -m 2 "$API/api/health" \
    || fail "API did not start (see $APP_LOG)"
  WAIT_SECONDS=90 wait_for "agent worker registered with LiveKit" grep -q "registered worker" "$APP_LOG" \
    || fail "agent worker did not register (see $APP_LOG)"
  WAIT_SECONDS=120 wait_for "web" curl -fsS -m 10 -o /dev/null http://127.0.0.1:3000/ \
    || fail "web did not start (see $APP_LOG)"
  step_done
}

post_checks() {
  step "End-to-end checks"
  wait_for "Synapse reaches the API (call memberships)" synapse_reaches_api \
    || fail "Synapse cannot reach the API: run \`bun run demo:up\` again"
  if [ "$(appservice_state)" = "down" ]; then
    echo "  ..  Synapse holds undelivered call memberships: forcing a retry"
    wake_appservice || fail "could not wake the appservice scheduler"
    wait_for "Synapse delivering to the API again" appservice_is_up \
      || fail "Synapse still marks the appservice down"
  else
    echo "  ok  Synapse appservice queue empty"
  fi
  # Through the API, so the embedder loads with the API's options (on the CPU).
  curl -fsS -m 120 -o /dev/null -X POST "$API/api/knowledge/retrieve" \
    -H "x-agent-secret: $(env_value AGENT_SECRET '')" -H 'content-type: application/json' \
    -d '{"query":"aquecimento","topK":1,"minScore":0}' \
    || fail "RAG retrieval failed (embedding model)"
  echo "  ok  RAG retrieval (embedding model loaded)"
  step_done
}

preflight
start_containers
warm_models
element_call
start_apps
post_checks

echo
echo "Ready in $((SECONDS - STARTED_AT)) s"
echo "  Web app:       http://localhost:3000"
echo "  Element Call:  http://localhost:8090"
echo "  App log:       $APP_LOG"
echo "Following the app log; Ctrl+C stops the apps."
echo
tail -n 0 -f "$APP_LOG" &
TAIL_PID=$!
trap 'kill "$TAIL_PID" 2>/dev/null; stop_apps' EXIT
wait "$APPS_PID"
