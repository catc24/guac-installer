#!/usr/bin/env bash
# Run this file to STOP Guacamole on Linux:  ./stop-linux.sh   (your data is kept)
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/scripts/guac.sh" stop
