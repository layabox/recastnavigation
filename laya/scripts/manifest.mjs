import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {sha256} from './source-state.mjs';
const [output,compiler]=process.argv.slice(2);
const root=fileURLToPath(new URL('..',import.meta.url));
const recipe=['src/laya-recast.cpp','scripts/build.sh','scripts/postprocess.mjs','scripts/prepare-binaryen.mjs','scripts/wasm2js-bounded.sh','scripts/check-bytecode.mjs','scripts/source-info.mjs','scripts/source-state.mjs','scripts/manifest.mjs','source-lock.json','package-lock.json'];
const artifacts=['recast-navigation.js','recast-navigation-wasm.js','recast-navigation-wasm.wasm'];
const manifest={...JSON.parse(readFileSync(join(output,'source.json'),'utf8')),compiler,
    recipeSha256:Object.fromEntries(recipe.map(file=>[file,sha256(readFileSync(join(root,file)))])),
    outputs:Object.fromEntries(artifacts.filter(file=>existsSync(join(output,file))).map(file=>[file,sha256(readFileSync(join(output,file)))]))};
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
