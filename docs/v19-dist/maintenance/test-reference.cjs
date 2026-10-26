const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=__dirname;
const fieldCode=fs.readFileSync(path.join(base,'reference-field.js'),'utf8');
const growthCode=fs.readFileSync(path.join(base,'reference-growth.js'),'utf8');
const bundle=fs.readFileSync(path.join(base,'../assets/index-BWYXfAkm.js'),'utf8');
assert.ok(bundle.includes(fieldCode));assert.ok(bundle.includes(growthCode));
class Vec {
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  copy(v){return this.set(v.x,v.y,v.z)}
  clone(){return new Vec(this.x,this.y,this.z)}
  normalize(){const length=Math.hypot(this.x,this.y,this.z)||1;this.x/=length;this.y/=length;this.z/=length;return this}
}
class Texture {constructor(image){this.image=image}dispose(){this.disposed=true}}
class Mesh {constructor(geometry,material){this.geometry=geometry;this.material=material;this.scale=new Vec();this.position=new Vec()}}
let pixels=new Uint8ClampedArray(16).fill(255),cameraRequests=[];
function canvas(){return {width:2,height:2,getContext:()=>({drawImage(){},getImageData:()=>({data:pixels})})}}
function video(){return {paused:true,readyState:2,videoWidth:2,videoHeight:2,pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()},load(){},removeAttribute(){}}}
class Engine {
  addSeg(plant,a,b,r,time){return {plant,a:a.clone(),b:b.clone(),r,born:time}}
  finishSegment(tip){tip.seg=null}
  clearGrowth(){this.segs=[];this.plants=[]}
}
const sandbox=vm.createContext({
  document:{createElement:tag=>tag==='video'?video():canvas()},
  navigator:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>cameraRequests.push(resolve))}},
  performance:{now:()=>1000},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Image:class{},
  tw:Engine,G:(controls,key)=>controls[key]??0,A:Vec,IU:Texture,FU:Texture,
  $t:Mesh,Up:class{},xs:class{constructor(options){Object.assign(this,options)}},Et:2,us:'srgb'
});
vm.runInContext(fieldCode+';globalThis.Field=aJ;'+growthCode,sandbox);
function field(){const f=new sandbox.Field(4);f.w=f.h=2;f.aspect=2;f.active=true;f.isStill=true;f.depthBuf=new Float32Array([0,1,0,1]);f.edgeBuf=new Float32Array([0,1,0,1]);f.gxBuf=new Float32Array(4);f.gyBuf=new Float32Array(4);f.visited=new Uint8Array(4);return f}
function engine(){const e=new Engine();e.field=field();e.controls={videoMode:4,videoSize:20,videoDepth:8,videoFollow:1,videoBuild:0,videoShow:.55,maxLive:16};e.fieldSize=()=>({w:e.controls.videoSize,h:e.controls.videoSize/e.field.aspect});Object.defineProperty(e,'videoOn',{get:()=>e.field.ready&&e.controls.videoMode>0});e.segs=[];e.plants=[];e.scene={add(){}};e.writeSeg=()=>{};e.budgetCap=()=>30000;e.release=p=>{p.held=false;p.autoUntil=0};return e}
async function run(){
  let f=field();assert.equal(f.depth(.5,.5),.5);assert.equal(f.depth(-2,0),0);assert.equal(f.depth(4,1),1);
  let e=engine();assert.equal(e.fieldZ(0,.5),-4);assert.equal(e.fieldZ(1,.5),4);
  e.controls.videoInvert=1;assert.equal(e.fieldZ(0,.5),4);e.controls.videoInvert=0;
  const p=new Vec(100,100,99),normal=new Vec();e.projectToField(p,normal);
  assert.ok(p.x<=10&&p.y<=5);assert.ok(Math.abs(p.z-e.fieldZ(p.x/20+.5,.5-p.y/10))<1e-8);
  assert.ok(Math.abs(Math.hypot(normal.x,normal.y,normal.z)-1)<1e-8);

  const segment={a:new Vec(-5,0,0),b:new Vec(5,0,0),referenceUV:{a:{u:.25,v:.5},b:{u:.75,v:.5}}};
  e.segs=[segment];e.updateReference({time:1},{});
  assert.equal(segment.a.z,-2);assert.equal(segment.b.z,2);
  let writes=0;e.writeSeg=()=>writes++;e.updateReference({time:1.1},{});assert.equal(writes,0,'unchanged still must not rewrite geometry');
  e.controls.videoSize=40;e.updateReference({time:2},{});
  assert.equal(segment.a.x,-10);assert.equal(segment.b.x,10);
  e.controls.videoFollow=0;e.field.depthBuf.fill(1);const frozen=segment.a.z;e.updateReference({time:3},{});assert.equal(segment.a.z,frozen);
  e.controls.videoFollow=1;e.updateReference({time:4},{});assert.ok(segment.a.z>frozen);

  e.rebuildBackdrop();const texture=e.videoTex,plane=e.backdrop;
  e.controls.videoShow=0;e.rebuildBackdrop();assert.equal(plane.visible,false);assert.equal(e.field.active,true);
  e.controls.videoShow=.6;e.field.revision++;texture.needsUpdate=false;e.rebuildBackdrop();
  assert.equal(plane.visible,true);assert.equal(e.videoTex,texture);assert.equal(texture.needsUpdate,true);
  assert.equal(plane.scale.x,40);assert.equal(plane.material.opacity,.6);
  e.field.active=false;e.rebuildBackdrop();assert.equal(plane.visible,false);assert.equal(e.videoTex,null);

  // Large static references finish their resize sweep; live revisions must not
  // repeatedly rewind to segment zero and starve the rest of the scene.
  for(const still of [true,false]){
    const big=engine();big.field.isStill=still;big.field.update=()=>{if(!still)big.field.revision++};
    big.segs=Array.from({length:5001},(_,idx)=>({idx,a:new Vec(),b:new Vec(),referenceUV:{a:{u:.3,v:.4},b:{u:.4,v:.4}}}));
    const touched=new Set();big.writeSeg=seg=>touched.add(seg.idx);
    big.updateReference({time:1},{});big.updateReference({time:2},{});
    assert.equal(touched.size,5001);assert.equal(big.referenceResizePending,false);
    touched.clear();big.updateReference({time:3},{});
    assert.equal(touched.size,still?0:4000);
  }

  // Frame sampling initializes without a dark temporal ramp and caps portrait dimensions.
  f=new sandbox.Field(4);f.active=true;f.video.videoWidth=2;f.video.videoHeight=100;
  pixels=new Uint8ClampedArray(2*4*4).fill(255);f.update(1);
  assert.equal(f.h,4);assert.equal(f.w,2);assert.equal(f.depth(.5,.5),1);
  pixels=new Uint8ClampedArray(2*4*4);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  f.update(1.1);assert.ok(f.depth(.5,.5)>0&&f.depth(.5,.5)<1);

  // Stop or a newer request must invalidate late camera permissions.
  f=new sandbox.Field();const open=f.openCamera();f.stop();
  let stopped=false;const track={stop(){stopped=true}};
  cameraRequests.shift()({getTracks:()=>[track],getVideoTracks:()=>[track]});await open;
  assert.equal(stopped,true);assert.equal(f.active,false);

  // Auto filling respects pause, rate and budget, while preserving note input.
  e=engine();e.controls.videoBuild=1;let spawned=0;
  e.newPlant=(pitch,velocity,globals,time,opts)=>{spawned++;const plant={root:opts.root,segs:[],tips:[],autoUntil:opts.autoUntil};e.plants.push(plant);return plant};
  e.updateReference({time:1},{});assert.equal(spawned,0);
  e.updateReference({time:2.3},{});assert.equal(spawned,1);assert.equal(e.plants[0].held,false);
  e.updateReference({time:2.31},{});assert.equal(spawned,1);
  e.controls.videoBuild=0;e.updateReference({time:2.4},{});assert.equal(e.plants[0].autoUntil,0);
  e.controls.videoBuild=1;e.segs=Array(16000).fill({});e.updateReference({time:3},{});assert.equal(spawned,1);
  console.log('PASS: bilinear depth, bounds/normals, inversion, live/frozen geometry, resize, reference toggle/refresh, portrait budget, camera cancellation, bounded auto-fill');
}
run().catch(error=>{console.error(error);process.exitCode=1});
