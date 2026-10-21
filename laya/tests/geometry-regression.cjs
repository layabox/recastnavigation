const assert=require('node:assert/strict');
const path=require('node:path');
const {load,root}=require('./runtime.cjs');
(async()=>{
 const file=path.resolve(process.argv[2]||path.join(root,'dist/recast-navigation.js'));
 const {module:m}=await load(file);
 const plane=[0,0,0, 0,0,8, 8,0,0, 8,0,8];
 const ramp=[0,0,0, 0,0,8, 8,8,0, 8,8,8];
 const indices=[0,1,2,2,1,3];
 const data=new m.dtNavTileData(),cache=new m.dtNavTileCache();
 function set(vertices,triangles=indices){data.setTriVertex(vertices);data.setTriIndex(triangles);
  data.setTriFlag(new Uint8Array(triangles.length/3).fill(1));cache.init(data);}
 const nav=new m.dtNavMesh(),query=new m.dtNavMeshQuery(),filter=new m.dtQueryFilter();
 const links=new m.dtOffMeshConnection(),volumes=new m.dtConvexVolume();
 nav.init([0,-1,0],[8,12,8],.25,32);query.init(nav,2048);
 let checks=0;
 function rebuild(slope,caches=[cache]) {
  nav.removeTile(0,0);
  nav.addTile({cellSize:.25,cellHeight:.2,tileSize:32,agentMaxSlope:slope},
   {tx:0,ty:0,bmin:[0,-1,0],bmax:[8,12,8],agentHeight:1.8,agentRadius:.2,
    agentMaxClimb:1,maxEdgeLen:12,maxSimplificationError:.9,partitionType:0},
   caches.map(c=>c.$$.ptr),links,volumes);
  return query.findNearestPoly([2,2,2],[1,16,1],filter);
 }
 function walk(slope,expected,label){const p=rebuild(slope);assert.equal(!!p.polyRef,expected,label);checks++;return p;}
 set(plane);walk(30,true,'initial plane');
 cache.setFlag(2);assert.equal(nav.getPolyArea(walk(30,true,'live area flags').polyRef),2);checks++;
 walk(0,false,'slope change cannot reuse filtered area flags');walk(60,true,'restore slope');
 const co=Math.SQRT1_2,rotation=[co,co,0,0,-co,co,0,0,0,0,1,0,0,0,0,1];
 cache.transfromData(rotation);walk(30,false,'rotation invalidates geometry');walk(60,true,'rotated slope accepted');
 cache.transfromData([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);walk(30,true,'identity recomputes from source');
 set(ramp);walk(30,false,'reinitialization replaces geometry');walk(60,true,'reinitialized ramp');
 set(plane);walk(30,true,'prime before mutable vertex view');
 const vertices=cache.getVerts();vertices.set(ramp);walk(30,false,'escaped vertex view mutation');
 vertices.set(plane);walk(30,true,'retained vertex view mutation after rebuild');
 const other=new m.dtNavTileCache();other.init(data);
 assert.ok(rebuild(30,[cache,other]).polyRef,'mixed escaped and prepared caches');checks++;
 other.destroy();other.delete();
 set([...plane,...ramp]);walk(30,true,'prime before mutable index view');
 const tris=cache.getTris();tris.set(indices.map(i=>i+4));walk(30,false,'escaped index view mutation');
 tris.set(indices);walk(30,true,'retained index view mutation after rebuild');
 query.delete();nav.delete();filter.delete();links.delete();volumes.delete();
 cache.destroy();cache.delete();data.destroy();data.delete();
 console.log(`PASS ${checks} geometry update checks: slope/flags/init/transform and retained mutable views`);
})().catch(e=>{console.error(e);process.exitCode=1});
