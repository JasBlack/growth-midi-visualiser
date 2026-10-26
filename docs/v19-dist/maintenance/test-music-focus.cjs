const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'music-focus.js'),'utf8');
const bundle=fs.readFileSync(path.join(__dirname,'../assets/index-BWYXfAkm.js'),'utf8');assert.ok(bundle.includes(code));
class Vec{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}clone(){return new Vec(this.x,this.y,this.z)}copy(v){Object.assign(this,v);return this}multiplyScalar(n){this.x*=n;this.y*=n;this.z*=n;return this}}
class Engine{
 writeColor(s){this.lastColor=s.plant.color.clone()}
 clear(){this.segs=[];this.plants=[];this.camPos=new Vec();this.camLook=new Vec();this.pan=new Vec();this.zoomMul=1;this.theta=0}
}
const ctx=vm.createContext({tw:Engine,G:(c,k)=>c[k]??0});vm.runInContext(code,ctx);
const e=new Engine();e.controls={camMode:2,musicFocus:1,musicTrail:2};e.camPos=new Vec(7,8,9);e.camLook=new Vec(1,2,3);e.pan=new Vec(4,5,6);e.zoomMul=2;e.theta=3;e.segs=[];
e.camera={position:e.camPos.clone(),quaternion:new Vec(.1,.2,.3),near:.05,far:200,fov:50,updateProjectionMatrix(){}};
const pos=e.camera.position.clone(),rotation=e.camera.quaternion.clone();assert.equal(e.toggleCameraLock(),true);
e.clear();assert.deepEqual(e.camPos,pos);assert.equal(e.zoomMul,2);assert.equal(e.theta,3);assert.equal(e.pan.x,4);
e.camera.position=new Vec();e.camera.quaternion=new Vec();e.camera.near=9;
// Execute the actual compiled camera block; tunnel simulation/culling must be skipped.
const start=bundle.indexOf('const Ls=G(this.controls,"camMode"),calm=G(this.controls,"calmCamera")>0;if(!this.cameraLockPose)'),end=bundle.indexOf('const Tu=',start);
assert.ok(start>0&&end>start);ctx.engine=e;vm.runInContext('(function(){'+bundle.slice(start,end)+'}).call(engine)',ctx);
assert.deepEqual(e.camera.position,pos);assert.deepEqual(e.camera.quaternion,rotation);assert.equal(e.camera.near,.05);
assert.equal(e.toggleCameraLock(),false);e.clear();assert.equal(e.zoomMul,1);
for(const fps of [30,60,120]){
 const x=new Engine();let sum=0;
 for(let i=0;i<fps*4;i++){const n=x.segmentAllowance(5,1/fps);sum+=n;x.musicCredit-=n;}
 assert.ok(sum>=19&&sum<=20,`5 starts/sec at ${fps}fps: ${sum}`);
}
assert.ok(new Engine().segmentAllowance(300,10)<=15,'stall must not bank seconds of work');
assert.equal(new Engine().segmentAllowance(0,.1),Infinity);
const plant={color:new Vec(1,.5,.25)},segment={plant,born:10};e.lastGTime=10;const original=plant.color;e.writeColor(segment);
assert.equal(plant.color,original);assert.ok(e.lastColor.x>1);
e.lastGTime=13;e.writeColor(segment);assert.ok(e.lastColor.x<.21);
plant.referenceAuto=true;e.lastGTime=10;e.writeColor(segment);assert.ok(e.lastColor.x<.21,'background fill must not look like a music event');
e.controls.musicFocus=0;e.writeColor(segment);assert.equal(e.lastColor.x,1);
assert.ok(bundle.includes("referenceSet('videoBuild',0)"));
assert.ok(!bundle.includes('m=1-.7*Math.min(1,Math.max(0,(p-.6)/.35))'));
console.log('PASS: locked camera survives Reset and skips tunnel camera simulation; fractional pacing across frame rates; bounded stall; fresh/old/background colour separation');
