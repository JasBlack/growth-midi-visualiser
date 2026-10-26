const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const bundle=fs.readFileSync(path.join(__dirname,'../assets/index-BWYXfAkm.js'),'utf8');
class Vec{
  constructor(x=0,y=0,z=0){this.set(x,y,z)}set(x,y,z){this.x=x;this.y=y;this.z=z;return this}copy(v){return this.set(v.x,v.y,v.z)}clone(){return new Vec(this.x,this.y,this.z)}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this}subVectors(a,b){return this.set(a.x-b.x,a.y-b.y,a.z-b.z)}multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this}distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z)}
  normalize(){return this.multiplyScalar(1/(Math.hypot(this.x,this.y,this.z)||1))}crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x)}
  lerp(v,a){this.x+=(v.x-this.x)*a;this.y+=(v.y-this.y)*a;this.z+=(v.z-this.z)*a;return this}
}
let move;
const start=bundle.indexOf('o.addEventListener("pointermove",l=>'),end=bundle.indexOf('const a=()=>this.dragBtn=-1',start);
const panContext=vm.createContext({o:{addEventListener:(_,fn)=>move=fn},Pa:new Vec(0,1,0),A:Vec});
const camera={dragBtn:1,dragX:0,dragY:0,manTheta:0,manPhi:0,camLook:new Vec(),camPos:new Vec(0,0,10),v2:new Vec(),v3:new Vec(),pan:new Vec()};
panContext.camera=camera;
vm.runInContext('(function(){'+bundle.slice(start,end)+'}).call(camera)',panContext);
move({clientX:20,clientY:10,shiftKey:true});assert.equal(camera.manTheta,0);assert.notEqual(camera.pan.x,0);assert.notEqual(camera.pan.y,0);
const before=camera.pan.clone();move({clientX:40,clientY:20,shiftKey:false});assert.notEqual(camera.manTheta,0);assert.equal(camera.pan.x,before.x);

class Geometry{constructor(){this.attributes={position:{array:new Float32Array([-.5,-.5,0,0,.5,.5,.5,-.5,0,.13,.17,.2])}}}computeVertexNormals(){this.normals=true}dispose(){this.disposed=true}}
class Material{constructor(args){Object.assign(this,args)}dispose(){this.disposed=true}}
class Mesh{constructor(geometry,material){this.geometry=geometry;this.material=material}}
class Engine{syncSoftMaterial(){}disposeSoftItem(item){this.group.remove(item.mesh);item.mesh.geometry.dispose();item.mesh.material.dispose()}focusLevel(){return 1}writeSeg(){}clearGrowth(){this.plants=[]}unmount(){}}
const species=[{},{}];
const ctx=vm.createContext({tw:Engine,js:species,G:(controls,key)=>controls[key]??0,A:Vec,kp:Geometry,Up:Geometry,bf:x=>x,Tc:Material,Et:2,$t:Mesh});
const softCode=fs.readFileSync(path.join(__dirname,'soft-growth.js'),'utf8'),camCode=fs.readFileSync(path.join(__dirname,'cinematic-camera.js'),'utf8');
assert.ok(bundle.includes(softCode.replace('Object.assign(tw.prototype,{',fs.readFileSync(path.join(__dirname,'soft-species-extra.js'),'utf8')+'\nObject.assign(tw.prototype,{')));assert.ok(bundle.includes(camCode));vm.runInContext(softCode+'\n'+fs.readFileSync(path.join(__dirname,'soft-species-extra.js'),'utf8')+'\n'+camCode,ctx);
assert.equal(species.length,15);assert.equal(species[2].soft,'liquid');assert.equal(species[4].soft,'blanket');
for(const kind of species.filter(s=>s.soft).map(s=>s.soft)){
  const e=new Engine();e.controls={softWave:1,softReact:2,softSpeed:1};e.group={add(){},remove(){}};
  const color={copy(){return this},multiplyScalar(){return this}};const plant={id:3,sp:{soft:kind},root:new Vec(),color,segs:[{a:new Vec(),b:new Vec(0,3,0),growth:1}]};plant.segs[0].plant=plant;e.plants=[plant];
  e.updateSoftGrowth({time:1,dt:.1,bass:0,treble:0});const item=e.softMeshes.get(plant),first=item.mesh.geometry.attributes.position.array.slice();
  e.updateSoftGrowth({time:1.1,dt:.1,bass:1,treble:1});const second=item.mesh.geometry.attributes.position.array;
  assert.ok([...second].every(Number.isFinite));assert.ok([...second].some((v,i)=>v!==first[i]),kind+' should move');assert.equal(item.mesh.geometry.normals,true);
  plant.segs[0].growth=0;e.updateSoftGrowth({time:1.2,dt:.1,bass:0,treble:0});assert.equal(item.mesh.visible,false,'retracted shapes should disappear');
  e.clearGrowth();assert.equal(item.mesh.geometry.disposed,true);assert.equal(e.softMeshes.size,0);
}
for(const mode of [6,7,8]){
  const e=new Engine();e.controls={camMode:mode,orbit:1,camSmooth:.4,camDistance:9};e.plants=[{held:true,tips:[{pos:new Vec(5,2,1)}]}];e.newCenter=new Vec();e.center=new Vec();e.pan=new Vec(1,0,0);e.camPos=new Vec(0,0,20);e.camLook=new Vec();e.zoomMul=1;e.manTheta=e.manPhi=0;
  e.updateCinematic({time:1,dt:1/60,bass:.6},{zoomNow:1});
  assert.ok([e.camPos.x,e.camPos.y,e.camPos.z].every(Number.isFinite));assert.ok(e.camPos.distanceTo(new Vec(0,0,20))<5,'camera transition should be smoothed');
}
{
 const e=new Engine();e.controls={softWave:1,softReact:1,softSpeed:1};e.group={add(){},remove(){}};
 e.plants=Array.from({length:80},(_,i)=>({id:i,sp:{soft:'kelp'},root:new Vec(),color:{copy(){return this},multiplyScalar(){return this}},segs:[{a:new Vec(),b:new Vec(0,2,0),growth:1}]}));
 for(const p of e.plants)p.segs[0].plant=p;
 for(let frame=0;frame<8;frame++){
  const time=1+frame*.1;e.updateSoftGrowth({time,dt:.1,bass:.5,treble:.4});
  assert.ok(e.softMeshes.size<=64);
  assert.ok([...e.softMeshes.values()].filter(item=>item.last===time).length<=16,'bounded per-frame mesh updates');
 }
 assert.equal(e.softMeshes.size,64);
 e.clearGrowth();assert.equal(e.softMeshes.size,0);
}
console.log('PASS: Shift-middle pan vs orbit, thirteen animated/retracting soft species; bounded 16 updates and 64 meshes, disposal, and finite smoothed camera modes');
