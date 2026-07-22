#!/bin/sh

SYMTYPE_COMMAND_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$SYMTYPE_COMMAND_DIR/start.sh" "$@"
