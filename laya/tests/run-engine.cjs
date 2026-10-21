const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const engine=process.env.LAYAAIR_ROOT;
if(!engine) throw new Error('Set LAYAAIR_ROOT to a LayaAir checkout with npm run build outputs. This optional suite does not copy files into the engine.');
const root=path.resolve(engine),dist=path.resolve(__dirname,'../dist');
assert.ok(fs.existsSync(path.join(root,'build/libs/laya.core.js')),'Build LayaAir first (npm run build)');
for(const backend of ['js','wasm']) {
    const file=path.join(dist,backend==='wasm'?'recast-navigation-wasm.js':'recast-navigation.js');
    const result=spawnSync(process.execPath,[path.join(__dirname,'engine-regression.cjs')],{
        env:{...process.env,LAYAAIR_ROOT:root,NAV_RECAST_SOURCE:file,NAV_WASM:''},stdio:'inherit'});
    if(result.status!==0) process.exit(result.status||1);
    console.log(`PASS ${backend} engine integration`);
}
