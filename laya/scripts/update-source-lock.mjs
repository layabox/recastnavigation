import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {git,nativeSnapshot,sha256} from './source-state.mjs';
const revision=process.argv[2];
if(!revision||!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Pass the reviewed full official commit SHA: npm run lock-source -- <40-character-sha>');
const root=fileURLToPath(new URL('../..',import.meta.url));
git(root,'merge-base','--is-ancestor',revision,'HEAD');
const files=nativeSnapshot(root);
for(const [file,hash] of Object.entries(files)) {
    const committed=execFileSync('git',['-C',root,'show',`${revision}:${file}`]);
    if(sha256(committed)!==hash) throw new Error(`Working native source differs from selected official revision: ${file}`);
}
const lockFile=new URL('../source-lock.json',import.meta.url);
writeFileSync(lockFile,JSON.stringify({upstream:'https://github.com/recastnavigation/recastnavigation',upstreamRevision:revision,files},null,2)+'\n');
console.log(`Locked ${Object.keys(files).length} native files at ${revision}. Behavior fixtures were not changed; run the tests and review any differences.`);
