const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8'),bundle=read('../assets/index-BWYXfAkm.js');
class V{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}}
class Attr{constructor(array,itemSize){this.array=array;this.itemSize=itemSize}}
class Geometry{
 setAttribute(k,a){this.attributes??={};this.attributes[k]=a;return this}
 computeBoundingBox(){const a=this.attributes.position.array,min=new V(Infinity,Infinity,Infinity),max=new V(-Infinity,-Infinity,-Infinity);for(let i=0;i<a.length;i++) {const k=['x','y','z'][i%3];min[k]=Math.min(min[k],a[i]);max[k]=Math.max(max[k],a[i]);}this.boundingBox={min,max,getSize(v){v.x=max.x-min.x;v.y=max.y-min.y;v.z=max.z-min.z},getCenter(v){v.x=(max.x+min.x)/2;v.y=(max.y+min.y)/2;v.z=(max.z+min.z)/2}};}
 translate(x,y,z){const a=this.attributes.position.array;for(let i=0;i<a.length;i++)a[i]+=[x,y,z][i%3]}
 scale(x,y,z){const a=this.attributes.position.array;for(let i=0;i<a.length;i++)a[i]*=[x,y,z][i%3]}
 computeVertexNormals(){}dispose(){this.disposed=true}
}
class Engine{unmount(){this.unmounted=true}}
const ctx=vm.createContext({tw:Engine,Ct:Geometry,es:Attr,A:V,G:(c,k)=>c[k]??0});
const motion=read('stage-motion.js'),tips=read('tip-shapes.js');assert.ok(bundle.includes(motion));assert.ok(bundle.includes(tips));
vm.runInContext(motion+'\n'+tips+';globalThis.step=reflectedStep;globalThis.parse=parseTipOBJ;globalThis.flat=tipFlatGeometry;',ctx);
for(const direction of [-1,1]){
 let x=0,d=direction;for(let i=0;i<10000;i++){const next=ctx.step(x,d,.017,.6);assert.ok(Math.abs(next.position)<=.600001);assert.ok(Math.abs(next.position-x)<=.017001);x=next.position;d=next.direction;}
}
assert.equal(ctx.step(.2,1,0,1).position,.2);assert.equal(ctx.step(3,1,2,0).position,0);
assert.ok(Math.abs(ctx.step(.2,1,500,1).position)<=1);
class Matrix{constructor(elements){this.elements=elements||[1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-1,0]}clone(){return new Matrix([...this.elements])}copy(m){this.elements=[...m.elements];return this}invert(){return this}}
Engine.prototype.draw=function(){if(this.failDraw)throw new Error('render test failure');return this.camera.projectionMatrix.elements[0]};
const wrapperStart=bundle.indexOf('const stageDraw=tw.prototype.draw;'),wrapperEnd=bundle.indexOf('\n};',wrapperStart)+3;
assert.ok(wrapperStart>0);vm.runInContext(bundle.slice(wrapperStart,wrapperEnd),ctx);
const scene=new Engine();scene.controls={screenBounce:1,bounceSpeed:.08,bounceSize:.55};scene.renderer={};scene.performanceState={time:1};scene.camera={projectionMatrix:new Matrix(),projectionMatrixInverse:new Matrix()};scene.updateBounceBounds=()=>{scene.bounceBounds={x:0,y:0,hx:1,hy:1}};
const matrixBefore=[...scene.camera.projectionMatrix.elements];assert.equal(scene.draw(),.55);assert.deepEqual(scene.camera.projectionMatrix.elements,matrixBefore);
scene.failDraw=true;assert.throws(()=>scene.draw(),/render test failure/);assert.deepEqual(scene.camera.projectionMatrix.elements,matrixBefore);
const sample=read('../custom-tip-example.obj');const geometry=ctx.parse(sample);assert.equal(geometry.attributes.position.array.length,36);assert.ok([...geometry.attributes.position.array].every(x=>Number.isFinite(x)&&Math.abs(x)<=1));
assert.throws(()=>ctx.parse('v NaN 0 0\nf 1 1 1'),/Invalid/);assert.throws(()=>ctx.parse('v 0 0 0\nf 1 2 3'),/Invalid/);
assert.throws(()=>ctx.parse('v 0 0 0\nv 1 0 0\nv 0 1 0\n'+'f 1 2 3\n'.repeat(2049)),/2,048/);
assert.equal(ctx.parse('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1 # triangle').attributes.position.array.length,9);
for(const kind of ['star','heart'])assert.ok([...ctx.flat(kind).attributes.position.array].every(Number.isFinite));
(async()=>{
 const e=new Engine();e.ready=true;assert.equal(await e.loadTipFile({name:'shape.obj',size:100,text:async()=>sample}),10);const old=e.tipOBJ;
 await e.loadTipFile({name:'shape.obj',size:100,text:async()=>sample});assert.equal(old.disposed,true);
 await assert.rejects(e.loadTipFile({name:'bad.gif',size:3}),/Choose PNG/);await assert.rejects(e.loadTipFile({name:'huge.obj',size:9000000}),/8 MB/);
 const current=e.tipOBJ;e.unmount();assert.equal(current.disposed,true);assert.equal(e.unmounted,true);
 console.log('PASS: bounded continuous reflection, no speed-zero motion, OBJ limits/normalisation/comments, flat shapes, upload replacement/disposal');
})().catch(e=>{console.error(e);process.exitCode=1});
