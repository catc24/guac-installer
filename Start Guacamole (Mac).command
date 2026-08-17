#!/usr/bin/env bash
# Double-click this file to START Guacamole on macOS.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/scripts/guac.sh" start
