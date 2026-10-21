// node tests/slope-regression.cjs [library.js] [--report-only]
const path = require('node:path');
const assert = require('node:assert/strict');
const {load,root} = require('./runtime.cjs');
const reportOnly = process.argv.includes('--report-only');
const file = process.argv.slice(2).find(x=>x!=='--report-only') || path.join(root,'dist/recast-navigation-wasm.js');
function geometry(reverse) {
    const vertices=[],indices=[],flags=[];
    const height=x=>Math.max(0,Math.min(4,x-6));
    for(let z=0;z<8;z++) for(let x=0;x<16;x++) {
        const base=vertices.length/3;
        vertices.push(x,height(x),z,x,height(x),z+1,x+1,height(x+1),z,x+1,height(x+1),z+1);
        indices.push(base,base+1,base+2,base+2,base+1,base+3); flags.push(1,1);
    }
    if(reverse) for(let i=0;i<indices.length;i+=3) [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    return {vertices,indices,flags};
}
(async()=>{
    const results=[];
    for(const maxSlope of [0,30,60]) for(const partition of [0,1,2]) for(const reverse of [false,true]) {
        // Use fresh native state and rebuild every tile for each setting.
        const {module:m}=await load(file);
        const nav=new m.dtNavMesh(),query=new m.dtNavMeshQuery(),filter=new m.dtQueryFilter();
        nav.init([0,-1,0],[16,6,8],.1,80);
        const input=geometry(reverse),data=new m.dtNavTileData(),cache=new m.dtNavTileCache();
        data.setTriVertex(input.vertices);data.setTriIndex(input.indices);data.setTriFlag(input.flags);cache.init(data);
        const links=new m.dtOffMeshConnection(),volumes=new m.dtConvexVolume();
        for(let tx=0;tx<2;tx++) nav.addTile(
            {cellSize:.1,cellHeight:.05,tileSize:80,agentMaxSlope:maxSlope,agentHeight:1,agentRadius:.2,agentMaxClimb:.3},
            {tx,ty:0,bmin:[tx*8,-1,0],bmax:[(tx+1)*8,6,8],agentHeight:1,agentRadius:.2,agentMaxClimb:.3,
                maxEdgeLen:12,maxSimplificationError:.9,partitionType:partition},[cache.$$.ptr],links,volumes);
        query.init(nav,2048);
        const start=query.findNearestPoly([3,0,4],[.5,1,.5],filter);
        const end=query.findNearestPoly([13,4,4],[.5,1,.5],filter);
        const route=start.polyRef&&end.polyRef?query.findPath(start,end,filter,256):null;
        const complete=!!(route&&route.polys.length&&route.polys.at(-1)===end.polyRef&&!(route.Status&64));
        const result={maxSlope,partition,reverse,complete};results.push(result);
        if(!reportOnly) assert.equal(complete,maxSlope===60,JSON.stringify(result));
        query.delete();nav.delete();filter.delete();links.delete();volumes.delete();cache.delete();data.delete();
    }
    console.log(JSON.stringify({file,results},null,2));
    if(!reportOnly) console.log('PASS 18 slope checks: 45-degree ramp, 0/30/60-degree limits, three partitions and both windings');
})().catch(error=>{console.error(error);process.exitCode=1});
