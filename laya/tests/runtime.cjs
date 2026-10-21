const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const adapter = fs.readFileSync(path.join(__dirname,'fixtures/WasmAdapter.js'),'utf8');
async function load(file, {hook = true, document, streaming = true, restricted = false, mapping} = {}) {
    file = path.resolve(file);
    const wasm = file.endsWith('-wasm.js');
    const bytes = wasm ? fs.readFileSync(file.replace(/\.js$/, '.wasm')) : null;
    const calls = [];
    const URLClass = class extends URL {};
    URLClass.urlMapping = mapping ? {'recast-navigation-wasm.wasm': mapping} : {};
    URLClass.formatURL = name => URLClass.urlMapping[name] || name;
    const context = {console, performance, setTimeout, clearTimeout, URL: URLClass, document,
        Browser: {document}, TextDecoder, TextEncoder};
    context.window = {};
    context.WebAssembly = hook ? undefined : {
        RuntimeError: WebAssembly.RuntimeError,
        instantiate: WebAssembly.instantiate
    };
    context.fetch = async url => {
        calls.push(['fetch', url]);
        return {ok: true, arrayBuffer: async () => bytes};
    };
    if (!hook) {
        // Capture the imports while preserving the generated streaming/fallback paths.
        context.WebAssembly.instantiateStreaming = async (response, imports) => {
            calls.push(['streaming']);
            if (!streaming) throw new Error('wrong MIME');
            return WebAssembly.instantiate(await (await response).arrayBuffer(), imports);
        };
    }
    if (restricted) Object.assign(context, {Function: undefined, BigInt64Array: undefined,
        BigUint64Array: undefined, TextDecoder: undefined, TextEncoder: undefined});
    vm.createContext(context, {codeGeneration: {strings: false, wasm: true}});
    vm.runInContext(adapter, context);
    context.Laya = {WasmAdapter: context.WasmAdapter};
    if (hook) context.WasmAdapter.instantiateWasm = async (name, imports) => {
        name = context.WasmAdapter.locateFileDefault(name);
        calls.push(['hook', name]);
        return WebAssembly.instantiate(bytes, imports);
    };
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
    const module = await context.window.Recast();
    return {module, context, calls};
}
function inventory(m) {
    const out = {};
    for (const key of Object.keys(m).filter(k => k.startsWith('dt') || ['updateCrowd','fixupShortcuts','mergeCorridorStartMoved'].includes(k)).sort()) {
        const v = m[key];
        const entry = {args: v.argCount ?? v.length};
        if (v.prototype) entry.prototype = Object.fromEntries(Object.getOwnPropertyNames(v.prototype)
            .filter(n => n !== 'constructor').sort().map(n => {
                const d = Object.getOwnPropertyDescriptor(v.prototype, n);
                return [n, typeof d.value === 'function' ? {args: d.value.argCount ?? d.value.length} : {get: !!d.get, set: !!d.set}];
            }));
        const enums = Object.entries(v).filter(([n,x]) => n.startsWith('DT_') && x && typeof x.value === 'number');
        if (enums.length) entry.values = Object.fromEntries(enums.map(([n,x]) => [n,x.value]));
        out[key] = entry;
    }
    return out;
}
module.exports = {load, inventory, root};
