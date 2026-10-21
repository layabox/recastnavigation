const assert=require('node:assert/strict'),path=require('node:path');
const {load,root}=require('./runtime.cjs');
(async()=>{
 const {module:m}=await load(path.resolve(process.argv[2]||path.join(root,'dist/recast-navigation.js')));
 let checks=0;
 const quad=(x0,z0,x1,z1,y=0)=>[x0,y,z0,x0,y,z1,x1,y,z0,x1,y,z1];
 const indices=[0,1,2,2,1,3];
 function cache(verts,tris,area){const d=new m.dtNavTileData(),c=new m.dtNavTileCache();d.setTriVertex(new Float32Array(verts));d.setTriIndex(new Uint32Array(tris));d.setTriFlag(new Uint8Array(tris.length/3).fill(area));c.init(d);c.sourceData=d;return c;}
 const circle=[],fan=[];for(let i=0;i<60;i++){const t=i*Math.PI/30;circle.push(8+2*Math.cos(t),0,8+2*Math.sin(t));if(i>=2)fan.push(0,i-1,i);}
 // Two separated strips deliberately leave a navigable hole: a convex hull mask is incorrect.
 const custom=[...quad(5,5,7,11),...quad(9,5,11,11)],customTris=[...indices,...indices.map(i=>i+4)];
 for(const partition of [0,1,2]) for(const reverse of [false,true]) for(const [name,verts,tris,inside] of [
  ['rectangle',quad(6,6,10,10),indices,[8,0,8]],['circle',circle,fan,[8,0,8]],['custom',custom,customTris,[6,0,8]]]){
  const ground=cache(quad(0,0,16,16),indices,1),obstacle=cache(verts,tris,0);
  const nav=new m.dtNavMesh(),q=new m.dtNavMeshQuery(),f=new m.dtQueryFilter(),links=new m.dtOffMeshConnection(),vol=new m.dtConvexVolume();
  nav.init([0,-1,0],[16,8,16],.25,64);q.init(nav,2048);
  const rebuild=(caches)=>{nav.removeTile(0,0);nav.addTile({cellSize:.25,cellHeight:.1,tileSize:64,agentMaxSlope:45,agentHeight:1,agentRadius:.25,agentMaxClimb:.3},{tx:0,ty:0,bmin:[0,-1,0],bmax:[16,8,16],agentHeight:1,agentRadius:.25,agentMaxClimb:.3,maxEdgeLen:12,maxSimplificationError:.9,partitionType:partition},caches.map(c=>c.$$.ptr),links,vol);q.init(nav,2048);};
  const present=p=>!!q.findNearestPoly(p,[.1,.3,.1],f).polyRef;
  rebuild(reverse?[obstacle,ground]:[ground,obstacle]);
  assert.equal(present(inside),false,`${name}: explicit unwalk must override coplanar walk, partition=${partition}, reverse=${reverse}`);checks++;
  assert.ok(present([3,0,8]),'ground outside obstacle remains walkable');checks++;
  if(name==='custom'){assert.ok(present([8,0,8]),'custom mesh hole remains walkable');checks++;}
  obstacle.setFlag(2);rebuild([ground,obstacle]);assert.ok(present(inside),'nonzero area remains walkable');checks++;
  obstacle.setFlag(0);rebuild([ground]);assert.ok(present(inside),'removing obstacle restores ground');checks++;
  const bridge=cache(quad(0,0,16,16,4),indices,1);rebuild([ground,obstacle,bridge]);assert.ok(present([inside[0],4,inside[2]]),'obstacle must not erase upper floor');checks++;
  for(const c of [bridge,ground,obstacle]){c.delete();c.sourceData.delete();}q.delete();nav.delete();f.delete();links.delete();vol.delete();
 }
 console.log(`PASS ${checks} obstacle checks: shapes, partitions, cache order, area changes, removal, holes and upper floors`);
})().catch(e=>{console.error(e);process.exitCode=1});
