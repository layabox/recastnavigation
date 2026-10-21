#!/bin/sh
set -eu
laya_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
recast_root=$(CDPATH= cd -- "$laya_root/.." && pwd)
cd "$laya_root"
: "${EMXX:=em++}"
: "${RECAST_OUTPUT:=$laya_root/dist}"
if [ "${RECAST_LAYER_MODE:-upstream}" != upstream ]; then
    echo "Only official native layers are supported; legacy mode restores a known bug" >&2
    exit 1
fi
version=$("$EMXX" --version | head -n 1)
case "$version" in *3.1.64*) ;; *) echo "Expected Emscripten 3.1.64; found: $version" >&2; exit 1 ;; esac
mkdir -p "$RECAST_OUTPUT"
RECAST_OUTPUT=$(CDPATH= cd -- "$RECAST_OUTPUT" && pwd)
node scripts/source-info.mjs "$recast_root" > "$RECAST_OUTPUT/source.json"
# Use a temporary Binaryen view so the SDK itself remains untouched.
# Emscripten exposes extra flags for wasm-opt, but not its later wasm2js call.
bounded_root=$(mktemp -d "${TMPDIR:-/tmp}/laya-recast-binaryen.XXXXXX")
trap 'rm -rf "$bounded_root"' EXIT HUP INT TERM
emxx_path=$(command -v "$EMXX")
binaryen_root=$("$(dirname "$emxx_path")/em-config" BINARYEN_ROOT)
node scripts/prepare-binaryen.mjs "$binaryen_root" "$bounded_root"
run_compiler() {
    if [ "$backend" = js ]; then
        EM_BINARYEN_ROOT="$bounded_root" RECAST_REAL_WASM2JS="$binaryen_root/bin/wasm2js" \
            "$EMXX" -sBINARYEN_EXTRA_PASSES=--one-caller-inline-max-function-size=500 "$@"
    else
        "$EMXX" "$@"
    fi
}
for backend in ${RECAST_BACKENDS:-wasm js}; do
    case "$backend" in
        wasm) wasm=1; output="$RECAST_OUTPUT/recast-navigation-wasm.js" ;;
        js) wasm=0; output="$RECAST_OUTPUT/recast-navigation.js" ;;
        *) echo "Unknown backend: $backend (expected wasm or js)" >&2; exit 1 ;;
    esac
    run_compiler src/laya-recast.cpp \
        "$recast_root"/Recast/Source/*.cpp \
        "$recast_root"/Detour/Source/*.cpp \
        "$recast_root"/DetourCrowd/Source/*.cpp \
        -I"$recast_root/Recast/Include" -I"$recast_root/Detour/Include" \
        -I"$recast_root/DetourCrowd/Include" \
        -std=c++17 -O3 -DNDEBUG --bind -sWASM="$wasm" -sMODULARIZE=1 -sEXPORT_NAME=Recast \
        -sENVIRONMENT=web -sDYNAMIC_EXECUTION=0 -sALLOW_MEMORY_GROWTH=1 \
        -sFILESYSTEM=0 -sEXPORTED_FUNCTIONS='["_malloc","_free"]' \
        -sWASM_BIGINT=0 -o "$output"
    node scripts/postprocess.mjs "$output" "$backend"
    if [ "$backend" = js ]; then
        node scripts/check-bytecode.mjs "$output"
    fi
done
node scripts/manifest.mjs "$RECAST_OUTPUT" "$version"
