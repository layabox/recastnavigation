const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {load, inventory, root} = require('./runtime.cjs');
const output = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || path.join(root, 'dist'));
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/api.json')));
(async () => {
    const {inspectBytecode} = await import('../scripts/check-bytecode.mjs');
    const bytecode = await inspectBytecode(path.join(output, 'recast-navigation.js'));
    assert.deepEqual(bytecode.oversized, [], 'Generated JS exceeds the V8 bytecode budget');
    console.log(`PASS JS bytecode: ${bytecode.functions.length} functions, largest ${bytecode.functions[0].bytes} bytes`);
    // Detect future minifier names and prove inspection never executes initializers.
    const os = require('node:os');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recast-bytecode-test-'));
    try {
        const sample = path.join(scratch, 'future-output.js');
        fs.writeFileSync(sample, "throw new Error('must not execute');\nfunction futureMinifierName(a){" +
            'a=(a+1)|0;'.repeat(12000) + 'return a;}');
        const large = await inspectBytecode(sample);
        assert.ok(large.oversized.some(f => f.name === 'futureMinifierName'));
        fs.writeFileSync(sample, 'function broken(');
        await assert.rejects(inspectBytecode(sample), /Bytecode inspection failed/);
    } finally {
        fs.rmSync(scratch, {recursive:true, force:true});
    }
    let checks = 3;
    for (const backend of ['wasm', 'js']) {
        const file = path.join(output, backend === 'wasm' ? 'recast-navigation-wasm.js' : 'recast-navigation.js');
        const {module:m, calls} = await load(file, {restricted: true});
        assert.deepEqual(inventory(m), golden, `${backend}: public API differs`);
        if (backend === 'wasm') assert.deepEqual(calls, [['hook','recast-navigation-wasm.wasm']]);
        const data = new m.dtNavTileData(), cache = new m.dtNavTileCache();
        data.setTriVertex(new Float32Array([0,0,0, 1,0,0, 0,0,1]));
        data.setTriIndex(new Uint32Array([0,1,2])); data.setTriFlag(new Uint8Array([1]));
        cache.init(data);
        assert.equal(cache.getTriVertexCount(), 9); assert.equal(cache.getTriIndexCount(), 3);
        cache.transfromData([1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1]);
        assert.deepEqual(Array.from(cache.getVerts()), [5,6,7,6,6,7,5,6,8]);
        // Transform is always applied to the source, not compounded on the previous result.
        cache.transfromData([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        assert.deepEqual(Array.from(cache.getVerts()), [0,0,0,1,0,0,0,0,1]);
        data.setTriVertex([0,0,0, 0,0,8, 8,0,0, 8,0,8]);
        data.setTriIndex([0,1,2,2,1,3]); data.setTriFlag([1,1]); cache.init(data);
        const nav = new m.dtNavMesh(), links = new m.dtOffMeshConnection(), volumes = new m.dtConvexVolume();
        assert.equal(nav.init([0,-1,0],[8,3,8],.25,32), undefined);
        assert.equal(nav.addTile({cellSize:.25,cellHeight:.2,tileSize:32,agentMaxSlope:45},
            {tx:0,ty:0,bmin:[0,-1,0],bmax:[8,3,8],agentHeight:1.8,agentRadius:.2,
             agentMaxClimb:.3,maxEdgeLen:12,maxSimplificationError:.9,partitionType:0},
            [cache.$$.ptr],links,volumes), undefined);
        const tile=nav.getTile(0), query=new m.dtNavMeshQuery(), filter=new m.dtQueryFilter();
        assert.equal(tile.getVerts().constructor.name,'Float32Array');
        assert.equal(tile.getdetailTris().constructor.name,'Uint8Array');
        assert.equal(query.init(nav,2048),2);
        const point=query.findNearestPoly([1,0,1],[1,4,1],filter);
        assert.ok(point.polyRef); assert.equal(nav.getPolyFlags(point.polyRef),1);
        assert.equal(nav.getPolyArea(point.polyRef),1);
        assert.equal(query.findRandomPoint(filter,point),2);
        assert.equal(query.findRandomPointAroundCircle(point,2,filter,point),2);
        const moved=query.moveAlongSurface(point.polyRef,point.data,[2,0,2],filter,16);
        assert.equal(moved.visited.constructor.name,'Uint32Array');
        filter.setIncludeFlags(2);
        assert.equal(query.findNearestPoly([1,0,1],[1,4,1],filter).polyRef,0);
        assert.equal(nav.removeTile(0,0),undefined);
        query.delete(); nav.delete(); filter.delete(); links.delete(); volumes.delete();
        cache.destroy(); data.destroy(); cache.delete(); data.delete();
        checks++;
        const behaviorArgs = [path.join(__dirname,'fixtures/native-behavior.json')];
        const result = spawnSync(process.execPath, [path.join(__dirname,'behavior-regression.cjs'),file,...behaviorArgs,'--portable'], {encoding:'utf8',maxBuffer:4*1024*1024});
        if (result.status !== 0) throw new Error(`${backend}: native regression failed\n${result.stderr}`);
        console.log(`PASS ${backend}: API, geometry buffers and six path/Crowd scenes`);
        checks += 6;
        const slope = spawnSync(process.execPath, [path.join(__dirname,'slope-regression.cjs'),file],
            {encoding:'utf8',maxBuffer:1024*1024});
        if (slope.status !== 0) throw new Error(`${backend}: slope regression failed\n${slope.stderr}`);
        console.log(`PASS ${backend}: 18 slope checks`);
        checks += 18;
        const geometry=spawnSync(process.execPath,[path.join(__dirname,'geometry-regression.cjs'),file],
            {encoding:'utf8',maxBuffer:1024*1024});
        if(geometry.status!==0)throw new Error(`${backend}: geometry update regression failed\n${geometry.stderr}`);
        console.log(`PASS ${backend}: 17 geometry update and borrowed-view checks`);
        checks += 17;
        const obstacles=spawnSync(process.execPath,[path.join(__dirname,'obstacle-regression.cjs'),file],
            {encoding:'utf8',maxBuffer:1024*1024});
        if(obstacles.status!==0)throw new Error(`${backend}: obstacle regression failed\n${obstacles.stderr}`);
        console.log(`PASS ${backend}: 96 obstacle geometry checks`);
        checks += 96;
    }
    const wasmFile = path.join(output,'recast-navigation-wasm.js');
    for (const streaming of [true,false]) {
        const {calls} = await load(wasmFile, {hook:false,streaming,
            document:{currentScript:{src:'https://cdn.example/game/libs/recast-navigation-wasm.js?v=7#load'}}});
        assert.ok(calls.some(([kind,url])=>kind==='fetch'&&url==='https://cdn.example/game/libs/recast-navigation-wasm.wasm'));
        assert.ok(calls.some(([kind])=>kind==='streaming'));
        checks++;
    }
    const {calls} = await load(wasmFile,{mapping:'cache/recast-navigation-wasm.hash.wasm',restricted:true});
    assert.deepEqual(calls,[['hook','cache/recast-navigation-wasm.hash.wasm']]);
    console.log(`PASS ${checks+1} checks, including browser streaming/fallback and mini game hooks without document, standard WebAssembly, eval or BigInt arrays`);
})().catch(error=>{console.error(error);process.exitCode=1});
