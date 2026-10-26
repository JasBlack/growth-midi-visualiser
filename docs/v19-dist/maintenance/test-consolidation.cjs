const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const ui=read('simple-ui.js'),camera=read('calm-camera.js'),bundle=read('../assets/index-BWYXfAkm.js');
assert.ok(bundle.includes(ui));assert.ok(bundle.includes(camera));
class Classes{
 constructor(){this.values=new Set()}toggle(k,on){on===undefined?this.values.has(k)?this.values.delete(k):this.values.add(k):on?this.values.add(k):this.values.delete(k)}
 contains(k){return this.values.has(k)}
}
const elements=new Map(),element=id=>elements.get(id)??elements.set(id,{id,value:'',textContent:'',dataset:{},classList:new Classes(),setAttribute(k,v){this[k]=v},click(){this.onclick?.()}}).get(id);
for(const id of ['uiMode','simpleSurprise','randomMix','simpleLookName','presetStatus','status','simpleGrowth','simpleGrowthValue','simpleDetail','simpleDetailValue','simpleAudio','simpleAudioValue','simpleCamera','simpleTrace','simpleRelief','simpleModel','simpleFree','simpleModelFile','simpleModelStatus','simpleReferenceVisible','simpleFit','refFit'])element(id);
element('simpleAudio').value='.45';
const lookButtons=['roots','coral','neural','crystal','liquid','silk'].map(id=>Object.assign(element('look-'+id),{dataset:{simpleLook:id}}));
const body={classList:new Classes()},document={body,querySelectorAll(selector){return selector==='[data-simple-look]'?lookButtons:[]}};
const controls=new Map(),makeControl=(key,value=0)=>{const c={value,set(v){this.value=v}};controls.set(`e:organism:${key}`,c);return c};
const species=['roots','corals','neuron','crystals','liquid','silk ribbon','jelly bell'];
for(let i=0;i<species.length;i++)makeControl(`sp:${i}`);
for(const key of ['species','wild','nested','physics','seasons','cycleEvery','speed','branch','wiggle','length','thickness','nodes','softWave','softReact','softSpeed','shader','env','bloom','pulse','flash','musicAmount','musicFocus','musicTrail','sustain','fillRate','videoBuild','screenBounce','materialSpeed','materialReact','calmCamera','camFollow','growAtCam','kick','shake','camMode','orbit','videoMode','shellMode','skinStick','morph','attach','join','videoStick','videoFollow','videoEdge','videoScatter','videoSpawn'])makeControl(key);
for(const key of ['zoomReact','beatZoom','rotSpeed'])controls.set(`g:${key}`,{value:1,set(v){this.value=v}});
let locked=false,clears=0,palette=-1,status='',timers=[];
class Engine{constructor(){this.id='organism';this.cameraLockPose=null}setControl(key,value){controls.get(`e:organism:${key}`).set(value)}toggleCameraLock(){locked=!locked;this.cameraLockPose=locked?{}:null;return locked}async loadShell(){return 'model loaded'}}
const te=new Engine();
const storage=new Map();
const context=vm.createContext({
  console,document,window:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
  setTimeout:fn=>{timers.push(fn)},Math,Y:element,Zt:controls,js:species.map(name=>({name})),te,tw:Engine,
  he:{},xn:{active:true},Fm:async()=>{},Im:i=>palette=i,M5:()=>clears++,vs:s=>status=s,
  referenceSync(){},referenceSet(k,v){controls.get(`e:organism:${k}`)?.set(v)},referenceValue(k){return controls.get(`e:organism:${k}`)?.value??0}
});
vm.runInContext(camera+'\n'+ui+'\nglobalThis.applyLook=simpleApplyLook;globalThis.surprise=simpleSurprise;globalThis.reference=simpleReference;',context);
(async()=>{
  assert.ok(body.classList.contains('simple-ui'));assert.equal(element('uiMode').textContent,'Advanced controls');
  await context.applyLook('roots');
  assert.equal(controls.get('e:organism:sp:0').value,1);assert.equal(controls.get('e:organism:sp:1').value,0);
  assert.equal(controls.get('g:zoomReact').value,0);assert.equal(controls.get('g:beatZoom').value,0);assert.equal(locked,true);
  await context.applyLook('liquid',{clear:true});
  assert.equal(controls.get('e:organism:sp:4').value,1);assert.equal(controls.get('e:organism:sp:6').value,0,'weaker new soft species are not in curated looks');
  assert.equal(clears,1);assert.equal(element('simpleLookName').textContent,'Liquid');
  context.reference('trace');assert.equal(controls.get('e:organism:videoMode').value,3);assert.equal(controls.get('e:organism:videoBuild').value,0);assert.equal(controls.get('e:organism:videoEdge').value,2.5);
  context.reference('model');assert.equal(controls.get('e:organism:shellMode').value,1);assert.equal(controls.get('e:organism:morph').value,0);
  assert.match(status,/3D skin/);
  element('uiMode').click();assert.ok(!body.classList.contains('simple-ui'));assert.equal(storage.get('growth-ui-mode'),'advanced');
  assert.ok(timers.length);await timers[0]();assert.equal(storage.get('growth-good-start-v0190'),'1');
  assert.equal(bundle.includes('m=1-.7*Math.min(1,Math.max(0,(p-.6)/.35))'),false,'old density slowdown remains removed');
  assert.match(bundle,/this\.scene\.fog\.density=calm\?\.002:/);
  assert.match(bundle,/2\.55-1\.45\*sensitivity/);
  console.log('PASS: simple/advanced mode, curated species, stable camera defaults, source trace/model intentions, first-run setup and calm fog');
})().catch(error=>{console.error(error);process.exitCode=1});
