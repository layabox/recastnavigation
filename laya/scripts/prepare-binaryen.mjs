import {mkdirSync, readdirSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const [sdkRoot, temporaryRoot] = process.argv.slice(2);
mkdirSync(join(temporaryRoot, 'bin'));
for (const name of readdirSync(join(sdkRoot, 'bin'))) {
    const target = name === 'wasm2js'
        ? fileURLToPath(new URL('./wasm2js-bounded.sh', import.meta.url))
        : join(sdkRoot, 'bin', name);
    symlinkSync(target, join(temporaryRoot, 'bin', name));
}
