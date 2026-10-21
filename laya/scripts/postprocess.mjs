import { readFileSync, writeFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const [file, backend] = process.argv.slice(2);
let source = readFileSync(file, 'utf8');
// Keep the script-directory lookup safe when mini games provide no document.
// Lower syntax introduced by newer SDKs; do not rewrite generated minified code by hand.
source = transformSync(source, { target: 'es2017', minify: true, legalComments: 'inline' }).code;
if (/\b(?:new\s+Function|eval\s*\()/.test(source)) throw new Error('Dynamic execution is forbidden in mini games');
if (/\bBig(?:U)?Int64Array\b/.test(source)) throw new Error('BigInt heap views break older mini game runtimes');
source += backend === 'wasm'
    ? '\nwindow.Recast = Laya.WasmAdapter.create(Recast, "recast-navigation-wasm.wasm");\n'
    : '\nwindow.Recast = Recast;\n';
writeFileSync(file, source);
