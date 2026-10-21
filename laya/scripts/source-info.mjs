import {readFileSync} from 'node:fs';
import {git,nativeSnapshot,sha256} from './source-state.mjs';
const root=process.argv[2];
const lock=JSON.parse(readFileSync(new URL('../source-lock.json',import.meta.url),'utf8'));
git(root,'merge-base','--is-ancestor',lock.upstreamRevision,'HEAD');
const actual=nativeSnapshot(root);
const changed=[...new Set([...Object.keys(lock.files),...Object.keys(actual)])]
    .filter(file=>actual[file]!==lock.files[file]);
if(changed.length) throw new Error(`Unreviewed native source changes:\n${changed.join('\n')}\nReview upstream changes, run npm run lock-source -- <official-commit>, then test before publishing.`);
console.log(JSON.stringify({upstream:lock.upstream,upstreamRevision:lock.upstreamRevision,
    checkoutRevision:git(root,'rev-parse','HEAD'),layerMode:'upstream',nativeSourceVerified:true,
    nativeSourceSha256:sha256(JSON.stringify(actual)),workingTreeDirty:!!git(root,'status','--porcelain')},null,2));
