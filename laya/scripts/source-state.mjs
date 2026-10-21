import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
export const directories=['Recast/Include','Recast/Source','Detour/Include','Detour/Source','DetourCrowd/Include','DetourCrowd/Source'];
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
export function nativeSnapshot(root) {
    const files={};
    for(const dir of directories) for(const name of readdirSync(join(root,dir)).sort()) {
        if(!/\.(h|cpp)$/.test(name)) continue;
        const relative=`${dir}/${name}`;
        files[relative]=sha256(readFileSync(join(root,relative)));
    }
    return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')));
}
