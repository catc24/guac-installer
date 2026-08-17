#!/usr/bin/env bash
#
# Shared launcher logic for Apache Guacamole (macOS + Linux).
# The double-click launchers in the project folder call this script.
#
# Usage: guac.sh [start|stop|restart|status|logs|update|uninstall]
#
set -euo pipefail

# --- locate the project folder (parent of this scripts/ directory) -----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

ACTION="${1:-start}"
GUAC_URL_PATH="/guacamole"

# --- pretty output -----------------------------------------------------------
say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ! \033[0m %s\n' "$*"; }
err()  { printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2; }

pause_if_double_clicked() {
    # When launched by double-click (not from an existing terminal session),
    # keep the window open so the user can read the output.
    if [ -t 0 ] && [ -z "${GUAC_NO_PAUSE:-}" ]; then
        printf '\nPress Return to close this window... '
        read -r _ || true
    fi
}
trap pause_if_double_clicked EXIT

# --- requirement checks ------------------------------------------------------
open_url() {
    local url="$1"
    if command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true       # macOS
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true # Linux
    fi
}

require_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        err "Docker is not installed."
        echo
        echo "Please install Docker Desktop (free), then run this launcher again:"
        echo "  https://www.docker.com/products/docker-desktop/"
        echo
        open_url "https://www.docker.com/products/docker-desktop/"
        exit 1
    fi

    if ! docker info >/dev/null 2>&1; then
        err "Docker is installed but not running."
        echo
        echo "Please start Docker Desktop and wait until it says \"running\", then"
        echo "run this launcher again."
        open_url "https://www.docker.com/products/docker-desktop/"
        exit 1
    fi
}

# Set DC to the correct compose command ("docker compose" or "docker-compose").
detect_compose() {
    if docker compose version >/dev/null 2>&1; then
        DC=(docker compose)
    elif command -v docker-compose >/dev/null 2>&1; then
        DC=(docker-compose)
    else
        err "Docker Compose was not found. Please update Docker Desktop."
        exit 1
    fi
}

# --- first-run setup ---------------------------------------------------------
random_password() {
    # 32 hex chars; works without openssl on stock macOS/Linux.
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 16
    else
        LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 32
    fi
}

ensure_env() {
    if [ ! -f .env ]; then
        say "First run: creating configuration (.env) with a random database password"
        cp .env.example .env
        local pw; pw="$(random_password)"
        # Replace the empty POSTGRES_PASSWORD line.
        if command -v python3 >/dev/null 2>&1; then
            PW="$pw" python3 - <<'PY'
import os, re
p = ".env"
s = open(p).read()
s = re.sub(r"^POSTGRES_PASSWORD=.*$", "POSTGRES_PASSWORD=" + os.environ["PW"], s, flags=re.M)
open(p, "w").write(s)
PY
        else
            # sed fallback (portable BSD/GNU form)
            sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${pw}|" .env && rm -f .env.bak
        fi
        ok "Configuration created"
    fi
}

# Read WEB_PORT from .env (default 8080) without sourcing the whole file.
web_port() {
    local p
    p="$(grep -E '^WEB_PORT=' .env 2>/dev/null | tail -n1 | cut -d= -f2)"
    echo "${p:-8080}"
}

guac_version() {
    local v
    v="$(grep -E '^GUAC_VERSION=' .env 2>/dev/null | tail -n1 | cut -d= -f2)"
    echo "${v:-1.6.0}"
}

ensure_schema() {
    mkdir -p init
    if [ ! -s init/initdb.sql ]; then
        say "Generating database schema (one-time, downloads the Guacamole image)"
        local ver; ver="$(guac_version)"
        if ! docker run --rm "guacamole/guacamole:${ver}" \
                /opt/guacamole/bin/initdb.sh --postgresql > init/initdb.sql; then
            err "Could not generate the database schema."
            rm -f init/initdb.sql
            exit 1
        fi
        if [ ! -s init/initdb.sql ]; then
            err "The generated schema was empty. Aborting."
            rm -f init/initdb.sql
            exit 1
        fi
        ok "Schema generated"
    fi
}

wait_until_ready() {
    local port="$1" url="http://localhost:${1}${GUAC_URL_PATH}/"
    say "Waiting for Guacamole to be ready..."
    for _ in $(seq 1 60); do
        # 200/302 both mean the app is serving.
        code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
        case "$code" in 200|301|302) ok "Guacamole is up"; return 0;; esac
        sleep 2
    done
    warn "Guacamole did not respond in time, but it may still be starting."
    return 0
}

# --- actions -----------------------------------------------------------------
do_start() {
    require_docker
    detect_compose
    ensure_env
    ensure_schema

    say "Starting Guacamole (this can take a minute the first time)"
    "${DC[@]}" up -d

    local port; port="$(web_port)"
    wait_until_ready "$port"

    local url="http://localhost:${port}${GUAC_URL_PATH}/"
    cat <<EOF

--------------------------------------------------------------------
  Guacamole is running.

  Open in your browser:   ${url}

  First-time login:
      Username:  guacadmin
      Password:  guacadmin

  IMPORTANT: log in and change the guacadmin password right away
  (top-right menu -> Settings -> Preferences).
--------------------------------------------------------------------
EOF
    open_url "$url"
}

do_stop() {
    require_docker
    detect_compose
    say "Stopping Guacamole (your data is kept)"
    "${DC[@]}" down
    ok "Stopped. Run the Start launcher again anytime; your connections are saved."
}

do_restart() { do_stop; do_start; }

do_status() {
    require_docker
    detect_compose
    say "Container status"
    "${DC[@]}" ps
}

do_logs() {
    require_docker
    detect_compose
    say "Showing logs (press Ctrl+C to stop)"
    GUAC_NO_PAUSE=1 "${DC[@]}" logs -f --tail=100
}

do_update() {
    require_docker
    detect_compose
    say "Updating to the latest images defined in your configuration"
    "${DC[@]}" pull
    "${DC[@]}" up -d
    ok "Updated."
}

do_uninstall() {
    require_docker
    detect_compose
    warn "This removes the Guacamole containers AND ALL saved connections/users."
    printf 'Type DELETE to confirm: '
    read -r ans
    if [ "$ans" = "DELETE" ]; then
        "${DC[@]}" down -v
        rm -f init/initdb.sql
        ok "Removed. Your .env (with the DB password) was kept."
    else
        say "Cancelled. Nothing was removed."
    fi
}

case "$ACTION" in
    start)     do_start ;;
    stop)      do_stop ;;
    restart)   do_restart ;;
    status)    do_status ;;
    logs)      do_logs ;;
    update)    do_update ;;
    uninstall) do_uninstall ;;
    *) err "Unknown action: $ACTION"; echo "Use: start | stop | restart | status | logs | update | uninstall"; exit 2 ;;
esac
