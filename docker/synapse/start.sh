#!/bin/sh
# Renders the appservice registration from env (secrets never live in the repo), generates the
# signing key on first boot, then starts Synapse.
set -eu
: "${MATRIX_AS_TOKEN:?}" "${MATRIX_WEBHOOK_SECRET:?}" "${MONIBOT_API_URL:?}"
mkdir -p /data/media_store
sed -e "s|__MATRIX_AS_TOKEN__|${MATRIX_AS_TOKEN}|" \
    -e "s|__MATRIX_HS_TOKEN__|${MATRIX_WEBHOOK_SECRET}|" \
    -e "s|__MONIBOT_API_URL__|${MONIBOT_API_URL}|" \
    /config/monibot-appservice.template.yaml > /data/monibot-appservice.yaml
[ -f /data/localhost.signing.key ] || python -m synapse.app.homeserver --config-path /config/homeserver.yaml --generate-keys
exec python -m synapse.app.homeserver --config-path /config/homeserver.yaml
