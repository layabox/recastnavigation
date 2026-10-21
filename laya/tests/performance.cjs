// npm run bench -- --baseline=/path/to/previous.js --mode=build|crowd
// Standalone paired benchmark; does not update behavior fixtures.
// Also runnable with ELECTRON_RUN_AS_NODE=1 to test the target Chromium/V8.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{
    const [key,...value]=arg.replace(/^--/,'').split('=');return [key,value.join('=')];
}));
if(options.mode&&!['build','crowd'].includes(options.mode))throw new Error('Use --mode=build or --mode=crowd');
const benchmarkBuild=(options.mode||'build')==='build';
const baseline=options.baseline&&path.resolve(options.baseline);
if(!baseline)throw new Error('Use --baseline=/path/to/previous/recast-navigation.js');
const candidate=path.resolve(options.candidate||path.join(__dirname,'../dist/recast-navigation.js'));
const trials=Number(options.trials||6), iterations=Number(options.iterations||200),warmup=Number(options.warmup||1000);
const density=Number(options.density||1),agentCount=Number(options.agents||24);
const yieldEvery=Number(options.yieldEvery||1);
const threadCpu=typeof process.threadCpuUsage==='function';
const cpuStart=()=>threadCpu?process.threadCpuUsage():null;
const cpuElapsed=start=>{if(!start)return 0;const c=process.threadCpuUsage(start);return(c.user+c.system)/1000;};
for(const [name,n] of Object.entries({trials,iterations,warmup,density,agentCount,yieldEvery}))
    if(!Number.isSafeInteger(n)||n<1)throw new Error(`Invalid ${name}: ${n}`);
const specs = [
    { name: 'plane', width: 8, partition: 0 },
    { name: 'obstacle-watershed', width: 16, hole: 'center', partition: 0 },
    { name: 'obstacle-monotone', width: 16, hole: 'center', partition: 1 },
    { name: 'obstacle-layers', width: 16, hole: 'center', partition: 2 },
    { name: 'disconnected', width: 16, hole: 'gap', partition: 0 },
    { name: 'offmesh-link', width: 16, hole: 'gap', link: true, partition: 0 },
];
function grid(spec) {
    const vertices = [], indices = [], flags = [];
    for(let iz=0;iz<8*density;iz++) for(let ix=0;ix<spec.width*density;ix++) {
        const x=ix/density,z=iz/density,step=1/density;
        if ((spec.hole === 'center' && x >= 7 && x < 9 && z >= 3 && z < 5)
            || (spec.hole === 'gap' && x >= 7 && x < 9)) continue;
        const height=(xx,zz)=>options.terrain==='ramp'?xx*.25:options.terrain==='wave'?.15*Math.sin(xx*1.5)+.1*Math.sin(zz*1.2):xx>12?(xx-12)*.1:0;
        const base = vertices.length / 3;
        vertices.push(x,height(x,z),z, x,height(x,z+step),z+step, x+step,height(x+step,z),z, x+step,height(x+step,z+step),z+step);
        indices.push(base,base+1,base+2, base+2,base+1,base+3);
        flags.push(x >= 12 ? 2 : 1, x >= 12 ? 2 : 1);
    }
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), flags: new Uint8Array(flags) };
}
function plain(value) {
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Array.isArray(value)) return Array.from(value,plain);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, plain(value[key])]));
    return value;
}
async function* scenario(spec, sourcePath) {
    const source=fs.readFileSync(sourcePath,'utf8');
    const diagnostics = [];
    const context = { window: {}, performance, setTimeout, clearTimeout,
        WebAssembly, URL, TextDecoder, TextEncoder,
        Laya: { WasmAdapter: { create: module => module } },
        console: Object.fromEntries(['log','info','warn','error'].map(level => [level, (...args) => diagnostics.push([level, args.map(String)])])) };
    vm.createContext(context);
    vm.runInContext('let randomSeed=123456789; Math.random=()=>((randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0)/4294967296);',context);
    assert.notEqual(vm.runInContext('Math.fround',context),Math.fround,'Do not import host Math intrinsics');
    assert.notEqual(vm.runInContext('Math.sqrt',context),Math.sqrt,'Do not import host Math intrinsics');
    vm.runInContext(source, context, {filename:sourcePath});
    const options = sourcePath.endsWith("-wasm.js") ? { wasmBinary: fs.readFileSync(sourcePath.replace(/\.js$/, ".wasm")) } : {};
    const m = await context.Recast(options);
    const nav = new m.dtNavMesh();
    nav.init([0,-1,0], [spec.width,3,8], .25, 32);
    const mesh = grid(spec), data = new m.dtNavTileData();
    data.setTriVertex(mesh.vertices); data.setTriIndex(mesh.indices); data.setTriFlag(mesh.flags);
    const cache = new m.dtNavTileCache(); cache.init(data);
    const links = new m.dtOffMeshConnection(), volumes = new m.dtConvexVolume();
    if (spec.link) links.addOffMeshConnection(7, [6,.2,4], [10,.2,4], .6, 1, 1);
    const config = { cellSize:.25, cellHeight:.2, tileSize:32, agentMaxSlope:45,
        agentHeight:1.8, agentMaxClimb:.3, agentRadius:.2 };
    let buildMs = 0, buildCpuMs=0;
    function addTile(tx) {
        const tile = { tx,ty:0,bmin:[tx*8,-1,0],bmax:[(tx+1)*8,3,8],agentHeight:1.8,
            agentRadius:.2,agentMaxClimb:.3,maxEdgeLen:12,maxSimplificationError:.9,partitionType:spec.partition };
        const cpuBefore=cpuStart();
        const start = performance.now();
        nav.addTile(config, tile, [cache.$$.ptr], links, volumes);
        buildMs += performance.now() - start;
        buildCpuMs+=cpuElapsed(cpuBefore);
    }
    for (let tx = 0; tx < spec.width/8; tx++) addTile(tx);
    const query = new m.dtNavMeshQuery(); query.init(nav,2048);
    const filter = new m.dtQueryFilter();
    const extents = [1,4,1];
    function find(start, end) {
        const a = plain(query.findNearestPoly(start,extents,filter));
        const b = plain(query.findNearestPoly(end,extents,filter));
        const route = plain(query.findPath(a,b,filter,256));
        let straight = null;
        if (route.polys.length) {
            const raw = query.findStraightPath(a.data,b.data,route.polys,route.polys.length,256);
            // Only nsteerPath entries are initialized; the remaining capacity is scratch memory.
            straight = { nsteerPath: raw.nsteerPath, steerPath: Array.from(raw.steerPath).slice(0,raw.nsteerPath*3) };
        }
        const height = route.polys.length ? plain(query.getPolyHeight(route.polys[0],a.data)) : null;
        return { a,b,route,straight,height };
    }
    const paths = [find([1,0,1],[spec.width-1,0,7]), find([1,0,7],[spec.width-1,0,1]),
        find([1,0,1],[2,0,2]), find([spec.width-2,0,1],[spec.width-1,0,7])];
    assert.ok(paths[2].route.polys.length > 0, `${spec.name}: local path must exist`);
    assert.ok(paths[2].straight.nsteerPath > 0, `${spec.name}: straight path must be exercised`);
    filter.setAreaCost(1,2.5); filter.setAreaCost(2,4);
    paths.push(find([1,0,1],[spec.width-1,0,7]));
    filter.setExcludeFlags(0xffff);
    paths.push(plain(query.findNearestPoly([1,0,1],extents,filter)));
    filter.setExcludeFlags(0); filter.setAreaCost(1,1); filter.setAreaCost(2,1);
    const coldBuild = {tiles: spec.width/8, ms: buildMs,cpuMs:buildCpuMs};
    if (benchmarkBuild) {
        // Separate warmup from the measured 100 runtime tile rebuilds.
        for (let i=0;i<500;i++) { nav.removeTile(0,0); addTile(0); }
        yield {phase:'ready',coldBuild};
        for(let trial=0;trial<trials;trial++) {
            const queries=crypto.createHash('sha256'), before=buildMs,cpuBefore=buildCpuMs;
            for(let i=0;i<iterations;i++) {
                nav.removeTile(0,0); addTile(0);
                queries.update(JSON.stringify(find([1,0,1],[spec.width-1,0,7])));
            }
            yield {ms:(buildMs-before)/iterations,cpuMs:threadCpu?(buildCpuMs-cpuBefore)/iterations:null,hash:queries.digest('hex')};
        }
        return;
    }
    async function crowdPass() {
    const crowd = new m.dtCrowd(); crowd.init(Math.max(32,agentCount),.5,nav);
    const params = new m.dtCrowdAgentParams();
    Object.assign(params,{ radius:agentCount>24?.08:.2,height:1.8,maxAcceleration:8,maxSpeed:2,collisionQueryRange:2,
        pathOptimizationRange:8,updateFlags:31,obstacleAvoidanceType:2,queryFilterType:0,separationWeight:2 });
    const handles=new Map();
    const ids = [], commands = [], initialPositions = [];
    assert.ok(Array.from(m.updateCrowd(crowd,0)).every(value => value === 0), 'empty Crowd output');
    for (let i = 0; i < agentCount; i++) {
        const x=agentCount===24?(i%2?spec.width-1-(i%3)*.45:1+(i%3)*.45):(i%2?spec.width-1-(i%8)*.2:1+(i%8)*.2), z=agentCount===24?1+Math.floor(i/4)*.9:1+Math.floor(i/8)*.35;
        const nearest = query.findNearestPoly(spec.link && i===0 ? [6,0,4] : [x,0,z],extents,filter);
        const id = crowd.addAgent(nearest.data,params); assert.ok(id >= 0);
        ids.push(id);handles.set(id,crowd.getAgent(id)); initialPositions.push(nearest.data);
        const target = query.findNearestPoly(spec.link && i===0 ? [10.5,0,4] : [i%2?1:spec.width-1,0,7-z],extents,filter);
        commands.push(crowd.requestMoveTarget(id,target));
    }
    const positions = crypto.createHash('sha256'), states = crypto.createHash('sha256');
    const snapshot=new Float32Array(Math.max(32,agentCount)*6);
    const checkpoints = []; let updateMs = 0, updateCpuMs=0, heapBytes=0, advanced = 0, offmeshFrames = 0;
    for (let frame = 0; frame < 480; frame++) {
        if (frame === 120) for (const id of ids.slice(0,4)) commands.push(crowd.requestMoveVelocity(id,[.5,0,-.2]));
        if (frame === 180) for (const id of ids) {
            const target = query.findNearestPoly([spec.width/2,0,1.5],extents,filter);
            commands.push(crowd.requestMoveTarget(id,target));
        }
        if (frame === 240) { const id = ids.pop(); crowd.removeAgent(id); commands.push(['remove',id]); }
        if (frame === 260) { const id = crowd.addAgent(paths[2].a.data,params); ids.push(id);handles.set(id,crowd.getAgent(id));
            commands.push(['add',id,crowd.requestMoveTarget(id,paths[0].b)]); }
        if (frame === 300) { const active = handles.get(ids[0]).getparams(); active.updateFlags=0; active.maxSpeed=1; }
        const dt = frame%29===0 ? 0 : frame%3===0 ? 1/30 : 1/60;
        const cpuBefore=cpuStart();
        const start = performance.now(), rawValues = m.updateCrowd(crowd,dt);
        updateMs += performance.now() - start;
        updateCpuMs+=cpuElapsed(cpuBefore);
        // The module returns a borrowed heap view. Snapshot it before another native call.
        heapBytes=rawValues.buffer.byteLength;
        snapshot.set(rawValues);
        const values = snapshot;
        assert.ok(Array.from(values).every(Number.isFinite), `${spec.name}: non-finite Crowd output`);
        positions.update(values);
        const status = ids.map(id => { const agent = handles.get(id);
            return [id,agent.active,agent.state,agent.targetState,agent.targetRef]; });
        states.update(JSON.stringify(status));
        if (status.some(agent => agent[2]===2)) offmeshFrames++;
        if (frame%120===119) checkpoints.push({frame,values:Array.from(values.slice(0,24)),status:plain(status.slice(0,4))});
        if((frame+1)%yieldEvery===0)await new Promise(setImmediate);
        if (frame===119) advanced=Math.hypot(values[0]-initialPositions[0][0],values[2]-initialPositions[0][2]);
    }
    assert.ok(advanced > .05, `${spec.name}: agents must actually move`);
    if (spec.link) assert.ok(offmeshFrames > 0, 'Crowd must traverse the off-mesh link');
    const record = {heapBytes,ms:updateMs,cpuMs:updateCpuMs,positionHash:positions.digest('hex'),stateHash:states.digest('hex'),advanced,offmeshFrames};
    crowd.delete(); params.delete();
    return record;
    }
    const cold=await crowdPass();await crowdPass();await crowdPass();
    yield {phase:'ready',coldBuild,coldCrowd:cold};
    for(let trial=0;trial<trials;trial++) {
        const row=await crowdPass();
        assert.ok(row.positionHash===cold.positionHash && row.stateHash===cold.stateHash);
        yield {...row,ms:row.ms/480,cpuMs:threadCpu?row.cpuMs/480:null};
    }
}


(async()=>{
 const cases=[];
 const selected=specs.filter(s=>!options.scene||s.name===options.scene);
 if(!selected.length)throw new Error('Unknown --scene');
 if(agentCount>128)throw new Error('This fixture supports at most 128 agents');
 if(agentCount!==24 && selected.some(s=>s.name!=='plane'))throw new Error('Use --scene=plane for agent counts other than 24');
 for(const [index,spec] of selected.entries()) {
  const iter={old:scenario(spec,baseline),new:scenario(spec,candidate)};
  const rows={name:spec.name,old:[],new:[],cold:{}};
  for(const v of(index%2?['new','old']:['old','new']))rows.cold[v]=(await iter[v].next()).value;
  for(let trial=0;trial<trials;trial++)for(const v of(trial%2?['new','old']:['old','new'])){
   await new Promise(setImmediate);
   rows[v].push((await iter[v].next()).value);
  }
  await iter.old.return();await iter.new.return();
  rows.matchingOutput=benchmarkBuild?rows.old[0].hash===rows.new[0].hash:
   rows.old[0].positionHash===rows.new[0].positionHash && rows.old[0].stateHash===rows.new[0].stateHash;
  cases.push(rows);
  console.error('DONE',spec.name);
 }
 console.log(JSON.stringify({node:process.versions.node,electron:process.versions.electron,v8:process.versions.v8,
  baseline,candidate,artifactSha256:Object.fromEntries([baseline,candidate].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
  mode:benchmarkBuild?'build':'crowd',threadCpu,platform:process.platform,arch:process.arch,
  protocol:{trials,iterations,warmup,density,agentCount,yieldEvery,math:'same-realm intrinsics'},cases}));
})().catch(e=>{console.error(e);process.exitCode=1});
