#!/bin/sh
set -eu
: "${RECAST_REAL_WASM2JS:?Missing SDK wasm2js path}"
# wasm2js runs its own optimization after wasm-opt. Its default unlimited
# single-caller inlining would recreate the large JS functions here.
exec "$RECAST_REAL_WASM2JS" --one-caller-inline-max-function-size=500 "$@"
