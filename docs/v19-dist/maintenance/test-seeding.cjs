const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fieldCode=fs.readFileSync(path.join(__dirname,'reference-field.js'),'utf8'),growthCode=fs.readFileSync(path.join(__dirname,'reference-growth.js'),'utf8');
const bundle=fs.readFileSync(path.join(__dirname,'../assets/index-BWYXfAkm.js'),'utf8');
assert.ok(bundle.includes(fieldCode));assert.ok(bundle.includes(growthCode));
class V{
  constructor(x=0,y=0,z=0){this.set(x,y,z)}set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  clone(){return new V(this.x,this.y,this.z)}distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z)}
}
class Engine{
  addSeg(plant,a,b){
    const saved={a:a.clone(),b:b.clone(),plant};
    // Reproduce the real addSeg -> writeSeg scratch-vector reuse.
    b.set(0,1,0);
    return saved;
  }
  finishSegment(){}clearGrowth(){}
}
let seed=17;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
const math=Object.create(Math);math.random=random;
const ctx=vm.createContext({tw:Engine,A:V,G:(controls,key)=>controls[key]??0,Math:math,
  document:{createElement:()=>({getContext:()=>({})})}});
vm.runInContext(fieldCode+';globalThis.Field=aJ;'+growthCode,ctx);
const field=new ctx.Field();field.w=field.h=2;field.visited=new Uint8Array(4);field.edgeBuf=new Float32Array(4);field.depthBuf=new Float32Array([0,1,0,1]);field.active=true;field.aspect=2;
const engine=new Engine();engine.field=field;engine.videoOn=true;engine.controls={videoDepth:8,videoMode:4};engine.fieldSize=()=>({w:20,h:10});
const plant={root:new V(-4,1,0),segLen:.5};const a=new V(-4,1,0),scratch=new V(-3.7,1.1,.1);
const segment=engine.addSeg(plant,a,scratch,.1,0);
assert.equal(scratch.x,0,'test must actually reproduce the render mutation');
assert.ok(Math.abs(segment.referenceUV.b.u-.315)<1e-10,'endpoint must come from the saved segment, not the reused temporary');
assert.ok(Math.abs(segment.referenceUV.b.v-.39)<1e-10);
engine.referencePoint(segment.b,segment.referenceUV.b);
assert.ok(Math.abs(segment.b.x+3.7)<1e-10,'live following must not pull the endpoint into the centre');
assert.equal(engine.addSeg(plant,new V(),new V(0,0,15),.1,0),null,'abrupt depth cliff should not become a spear');
engine.videoOn=false;assert.ok(engine.addSeg(plant,new V(),new V(0,0,15),.1,0),'unrelated growth remains unchanged');

function distribution(f,count=2000){
  const tiles=new Set(),quadrants=[0,0,0,0];let center=0;
  for(let i=0;i<count;i++){
    const p=f.pickPoint(true);assert.ok(p.u>=0&&p.u<=1&&p.v>=0&&p.v<=1);
    tiles.add(Math.floor(p.u*12)+12*Math.floor(p.v*12));quadrants[(p.u>.5?1:0)+(p.v>.5?2:0)]++;
    if(Math.hypot(p.u-.5,p.v-.5)<.1)center++;
    f.visit(p.u,p.v);
  }
  assert.ok(tiles.size>=140,`only ${tiles.size}/144 image regions seeded`);
  assert.ok(quadrants.every(n=>n>count*.15),'all four quadrants must receive starts');
  assert.ok(center<count*.1,'roots must not cluster at the centre');
  return {regions:tiles.size,quadrants,center};
}
field.seedScatter=.7;console.log('Synthetic field:',distribution(field));
if(process.argv[2]){
  const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const f=new ctx.Field(192);f.active=true;f.isStill=true;f.still.width=fixture.w;f.still.height=fixture.h;
  f.ctx={drawImage(){},getImageData:()=>({data:fixture.rgba})};f.update(1);f.seedScatter=.7;
  console.log('Supplied portrait:',distribution(f));
}
console.log('PASS: renderer scratch-vector regression, no centre snap, depth-cliff rejection, distributed seed coverage');
