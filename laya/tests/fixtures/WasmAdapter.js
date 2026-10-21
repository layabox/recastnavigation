// Snapshot of LayaAir WasmAdapter for standalone loading-contract tests.
// URL and Browser are supplied by the test harness. See provenance.json.
/**
 * @ignore
 */
class WasmAdapter {
    static create(module, wasmFile) {
        var _a;
        let webDir;
        if (typeof document != 'undefined') {
            webDir = (_a = Browser.document.currentScript) === null || _a === void 0 ? void 0 : _a.src;
            if (webDir)
                webDir = webDir.substring(0, webDir.replace(/[?#].*/, "").lastIndexOf("/") + 1);
        }
        return () => {
            let moduleArg = {};
            if (WasmAdapter.instantiateWasm != null) {
                moduleArg["instantiateWasm"] = function (imports, receiveInstance) {
                    return WasmAdapter.instantiateWasm(wasmFile, imports).then(exports => {
                        receiveInstance(exports["instance"]);
                        return exports;
                    });
                };
            }
            moduleArg["locateFile"] = function (path, scriptDirectory) {
                if (WasmAdapter.locateFile != null)
                    wasmFile = WasmAdapter.locateFile(path, scriptDirectory, webDir);
                else
                    wasmFile = WasmAdapter.locateFileDefault(path, scriptDirectory);
                return wasmFile;
            };
            return module(moduleArg);
        };
    }
    static locateFileDefault(path, scriptDirectory) {
        if (URL.urlMapping[path])
            return URL.formatURL(path, '');
        else
            return scriptDirectory != null ? scriptDirectory + path : path;
    }
}
WasmAdapter.Memory = typeof (window.WebAssembly) !== "undefined" ? window.WebAssembly.Memory : null;

this.WasmAdapter = WasmAdapter;
