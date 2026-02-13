#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Building Link Forge..."
cd "$PROJECT_DIR"
npm ci --production=false
npm run build

echo "Installing systemd service..."
sudo cp "$SCRIPT_DIR/link-forge.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable link-forge

echo "Starting service..."
sudo systemctl start link-forge
sudo systemctl status link-forge

echo "Done! Link Forge is running."
echo "Logs: journalctl -u link-forge -f"
