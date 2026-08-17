#!/usr/bin/env bash
# Double-click this file to STOP Guacamole on macOS. Your data is kept.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/scripts/guac.sh" stop
