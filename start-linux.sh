#!/usr/bin/env bash
# Run this file to START Guacamole on Linux:  ./start-linux.sh
# (or double-click it and choose "Run in Terminal" if your file manager offers it)
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/scripts/guac.sh" start
