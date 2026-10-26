const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const source=read('dynamic-materials.js'),runtime=read('dynamic-material-runtime.js'),bundle=read('../assets/index-BWYXfAkm.js');
assert.ok(bundle.includes(source));assert.ok(bundle.includes(runtime));
let operations=0,sines=0,position=[.4,.7,1.2];
class N{
 constructor(fn){this.fn=typeof fn==='function'?fn:()=>fn}
 val(){return this.fn()}
 op(other,fn){operations++;other=node(other);return new N(()=>{const a=this.val(),b=other.val();if(Array.isArray(a)||Array.isArray(b)){const n=Math.max(a.length||1,b.length||1);return Array.from({length:n},(_,i)=>fn(Array.isArray(a)?a[i%a.length]:a,Array.isArray(b)?b[i%b.length]:b));}return fn(a,b)})}
 add(b){return this.op(b,(a,b)=>a+b)}sub(b){return this.op(b,(a,b)=>a-b)}mul(b){return this.op(b,(a,b)=>a*b)}
 get x(){return new N(()=>this.val()[0])}get y(){return new N(()=>this.val()[1])}get z(){return new N(()=>this.val()[2])}get xz(){return new N(()=>[this.val()[0],this.val()[2]])}
}
const node=x=>x instanceof N?x:new N(x);
const unary=(x,f)=>{operations++;x=node(x);return new N(()=>{const v=x.val();return Array.isArray(v)?v.map(f):f(v)})};
function uniform(v){const n=new N(()=>n.value);n.value=v;return n}
let made=0,disposed=0;
const ctx=vm.createContext({I_:Array.from({length:22},(_,i)=>({name:'old'+i})),on:uniform,
 ot:new N(()=>position),pc:x=>{sines++;return unary(x,Math.sin)},eL:(x,a,b)=>unary(x,v=>Math.max(a,Math.min(b,v))),
 Le:(...x)=>new N(x.length===1?[x[0],x[0],x[0]]:x),Ri:(a,b,t)=>node(a).mul(node(1).sub(t)).add(node(b).mul(t)),
 cl:(a,b,x)=>unary(x,v=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t)}),
 RC:x=>new N(()=>Math.hypot(...node(x).val())),Yg:x=>new N(()=>[0,1,2].map(i=>.5+.5*Math.cos(node(x).val()*6.283+i*2.094))),
 b:{materialColor:new N([1,1,1])},KX:{rgb:new N([1,1,1])},ks:args=>({ ...args,dispose(){disposed++},color:{copy(){return this}}}),
 tw:class Engine{},G:(c,k)=>c[k]??0,bf:x=>x,Et:2,console});
vm.runInContext(source+';globalThis.catalog=dynamicMaterialEntries;globalThis.clock=dynamicClock;globalThis.audio=dynamicAudio;globalThis.attack=dynamicAttack;'+runtime,ctx);
assert.equal(ctx.I_.length,32);assert.equal(ctx.I_[21].name,'old21');assert.equal(new Set(ctx.catalog.map(x=>x.name)).size,10);
const signatures=[];
for(const entry of ctx.catalog){
 operations=sines=0;const material=entry.make();assert.ok(operations<=100,entry.name+' bounded graph');assert.ok(sines<=6,entry.name+' bounded trig');
 assert.ok(!material.transparent&&!material.transmission&&!material.positionNode);
 ctx.clock.value=0;ctx.audio.value=0;ctx.attack.value=0;
 const initial=material.colorNode.val();const colors=[];
 for(let t=0;t<5;t++){ctx.clock.value=t*.7;position=[.4+t*.1,.7,1.2];const rgb=material.colorNode.val();assert.ok(rgb.every(v=>Number.isFinite(v)&&v>=0&&v<=1.2));colors.push(...rgb)}
 assert.ok(colors.some((v,i)=>Math.abs(v-initial[i%3])>.001),entry.name+' animates');
 signatures.push(colors.map(v=>v.toFixed(3)).join(','));
 let responds=false;
 for(let sample=0;sample<40;sample++){
  position=[sample*.37,sample*.17,sample*.29];ctx.clock.value=sample*.1;
  ctx.audio.value=0;ctx.attack.value=0;const dark=material.emissiveNode.val();
  ctx.audio.value=1;ctx.attack.value=1;const loud=material.emissiveNode.val();
  responds ||= loud.some((v,i)=>Math.abs(v-dark[i])>1e-6);
 }
 assert.ok(responds,entry.name+' responds to audio');
 console.log(entry.name+': '+operations+' arithmetic nodes, '+sines+' sine nodes');
}
assert.equal(new Set(signatures).size,10);
const e=new ctx.tw();e.controls={materialSpeed:0,materialScale:1,materialReact:0};const before=ctx.clock.value;
e.updateDynamicMaterials({dt:.016,energy:1,onset:1,beat:{hit:1}});assert.equal(ctx.clock.value,before);assert.equal(ctx.audio.value,0);assert.equal(ctx.attack.value,0);
e.controls.materialReact=1;e.controls.materialSpeed=1;e.updateDynamicMaterials({dt:10,energy:1,onset:0,beat:{hit:1}});assert.ok(ctx.clock.value-before<=.051);
e.materialAttack=0;e.updateDynamicMaterials({dt:.016,energy:0,onset:0,beat:{hit:1}});assert.equal(ctx.attack.value,0,'silent tempo must not flash');
// Soft surfaces create a material on selection only, reuse it during animation,
// and dispose exactly the owned effect and base material at the appropriate times.
e.controls.shader=22;let baseDisposed=0,geometryDisposed=0,removed=0;
const base={dispose(){baseDisposed++}},item={mesh:{material:base,geometry:{dispose(){geometryDisposed++}}}};
e.group={remove(){removed++}};
e.syncSoftMaterial({},item);const effect=item.effectMaterial;assert.ok(effect);assert.equal(item.mesh.material,effect);
for(let i=0;i<100;i++)e.syncSoftMaterial({},item);assert.equal(item.effectMaterial,effect);assert.equal(disposed,0);
e.controls.shader=0;e.syncSoftMaterial({},item);assert.equal(disposed,1);assert.equal(item.mesh.material,base);assert.equal(baseDisposed,0);
e.controls.shader=23;e.syncSoftMaterial({},item);e.disposeSoftItem(item);assert.equal(disposed,2);assert.equal(baseDisposed,1);assert.equal(geometryDisposed,1);assert.equal(removed,1);
console.log('PASS: ten distinct bounded patterns, animation/audio response, silent beat gating, speed freeze, soft-material reuse and disposal');
