#!/bin/bash
# ──────────────────────────────────────────────────────────────
# Link Forge - Initial Seed Script (v2)
#
# FIX #8: Auto-detects Neo4j container name from docker-compose
#         instead of hardcoding "link-forge-neo4j-1".
#
# Usage:
#   ./scripts/initial-seed.sh dump
#   ./scripts/initial-seed.sh transfer 100.x.x.B
#   ./scripts/initial-seed.sh load /path/to/dump
# ──────────────────────────────────────────────────────────────

set -euo pipefail

DUMP_DIR="/tmp/link-forge-dump"
DB_NAME="neo4j"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[seed]${NC} $1"; }
warn()  { echo -e "${YELLOW}[seed]${NC} $1"; }
error() { echo -e "${RED}[seed]${NC} $1" >&2; }

# ── FIX #8: Auto-detect container name ───────────────────────
detect_container() {
  local name=""

  # Try docker-compose (looks for neo4j service)
  if command -v docker-compose &>/dev/null; then
    name=$(docker-compose ps --services 2>/dev/null | grep -i neo4j | head -1)
    if [ -n "$name" ]; then
      # docker-compose ps -q gives the container ID
      name=$(docker-compose ps -q "$name" 2>/dev/null)
      if [ -n "$name" ]; then
        name=$(docker inspect --format '{{.Name}}' "$name" 2>/dev/null | sed 's/^\///')
      fi
    fi
  fi

  # Fallback: search running containers for neo4j image
  if [ -z "$name" ]; then
    name=$(docker ps --filter "ancestor=neo4j" --format '{{.Names}}' 2>/dev/null | head -1)
  fi

  # Fallback: search by name pattern
  if [ -z "$name" ]; then
    name=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i 'neo4j' | head -1)
  fi

  if [ -z "$name" ]; then
    error "Could not detect Neo4j container. Is it running?"
    error "Try: docker ps | grep neo4j"
    exit 1
  fi

  echo "$name"
}

usage() {
  echo "Usage:"
  echo "  $0 dump                    Create a Neo4j database dump"
  echo "  $0 transfer <peer-ip>      SCP the dump to the peer"
  echo "  $0 load <dump-path>        Load a dump into local Neo4j"
  exit 1
}

# ── DUMP ──────────────────────────────────────────────────────

do_dump() {
  log "Creating database dump..."
  mkdir -p "$DUMP_DIR"

  CONTAINER_NAME=$(detect_container)
  log "Detected Neo4j container: $CONTAINER_NAME"

  warn "Stopping Neo4j for consistent dump..."
  docker stop "$CONTAINER_NAME"

  DATA_VOL=$(docker inspect "$CONTAINER_NAME" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')

  docker run --rm \
    -v "$DATA_VOL":/data \
    -v "$DUMP_DIR":/dump \
    neo4j:5 \
    neo4j-admin database dump "$DB_NAME" --to-path=/dump/ 2>&1

  docker start "$CONTAINER_NAME"
  log "Neo4j restarted."

  DUMP_FILE="$DUMP_DIR/${DB_NAME}.dump"
  if [ -f "$DUMP_FILE" ]; then
    SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    log "✅ Dump created: $DUMP_FILE ($SIZE)"
    log "Next: $0 transfer <peer-tailscale-ip>"
  else
    error "❌ Dump file not found at $DUMP_FILE"
    exit 1
  fi
}

# ── TRANSFER ──────────────────────────────────────────────────

do_transfer() {
  local PEER_IP="$1"
  DUMP_FILE="$DUMP_DIR/${DB_NAME}.dump"

  if [ ! -f "$DUMP_FILE" ]; then
    error "No dump at $DUMP_FILE. Run '$0 dump' first."
    exit 1
  fi

  SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  log "Transferring $DUMP_FILE ($SIZE) to $PEER_IP..."

  ssh "$PEER_IP" "mkdir -p $DUMP_DIR" 2>/dev/null || true
  scp "$DUMP_FILE" "$PEER_IP:$DUMP_DIR/"

  log "✅ Transfer complete!"
  log "On peer: $0 load $DUMP_DIR/${DB_NAME}.dump"
}

# ── LOAD ──────────────────────────────────────────────────────

do_load() {
  local DUMP_FILE="$1"

  if [ ! -f "$DUMP_FILE" ]; then
    error "Dump not found: $DUMP_FILE"
    exit 1
  fi

  SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  log "Loading dump: $DUMP_FILE ($SIZE)"

  warn "⚠️  This will OVERWRITE the local Neo4j database!"
  read -p "Continue? (y/N) " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    log "Aborted."
    exit 0
  fi

  CONTAINER_NAME=$(detect_container)
  log "Detected Neo4j container: $CONTAINER_NAME"

  log "Stopping Neo4j..."
  docker stop "$CONTAINER_NAME"

  DATA_VOL=$(docker inspect "$CONTAINER_NAME" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')

  docker run --rm \
    -v "$DATA_VOL":/data \
    -v "$(dirname "$DUMP_FILE")":/dump \
    neo4j:5 \
    neo4j-admin database load "$DB_NAME" --from-path=/dump/ --overwrite-destination 2>&1

  docker start "$CONTAINER_NAME"
  log "Neo4j restarted."

  log "Waiting for Neo4j..."
  sleep 5

  log "Running schema setup..."
  npm run db:setup 2>&1 || warn "db:setup had issues"

  log "Running sync migration..."
  npx tsx scripts/migrate-for-sync.ts 2>&1 || warn "migrate had issues"

  log "✅ Database loaded! Run 'npm run sync:status' to verify."
}

# ── MAIN ──────────────────────────────────────────────────────

case "${1:-}" in
  dump) do_dump ;;
  transfer)
    [ -z "${2:-}" ] && { error "Usage: $0 transfer <peer-ip>"; exit 1; }
    do_transfer "$2" ;;
  load)
    [ -z "${2:-}" ] && { error "Usage: $0 load /path/to/dump"; exit 1; }
    do_load "$2" ;;
  *) usage ;;
esac
