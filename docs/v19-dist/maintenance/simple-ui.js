const simpleLooks=[
  {id:'roots',label:'Roots',species:['roots'],palette:4,shader:2,values:{branch:.7,wiggle:1.15,length:.85,thickness:1.15,nodes:.7,softWave:0}},
  {id:'coral',label:'Coral',species:['corals'],palette:3,shader:4,values:{branch:.9,wiggle:.65,length:.8,thickness:1.25,nodes:.8,softWave:0}},
  {id:'neural',label:'Neural',species:['neuron'],palette:6,shader:6,values:{branch:.8,wiggle:1.2,length:.8,thickness:.8,nodes:1.15,softWave:0}},
  {id:'crystal',label:'Crystal',species:['crystals'],palette:5,shader:14,values:{branch:.55,wiggle:.35,length:1.15,thickness:.9,nodes:.85,softWave:0}},
  {id:'liquid',label:'Liquid',species:['liquid'],palette:1,shader:22,values:{branch:.2,wiggle:.5,length:.75,thickness:1.2,nodes:0,softWave:.8,softReact:.75,softSpeed:.45}},
  {id:'silk',label:'Silk',species:['silk ribbon'],palette:5,shader:27,values:{branch:.15,wiggle:.4,length:.75,thickness:.9,nodes:0,softWave:.65,softReact:.7,softSpeed:.35}}
];
let simpleLastLook=-1;
function simpleSet(key,value){Zt.get(`e:organism:${key}`)?.set(value);}
function simpleGlobal(key,value){Zt.get(`g:${key}`)?.set(value);}
function simpleSpecies(names){
  const wanted=new Set(names);
  for(let i=0;i<js.length;i++)simpleSet(`sp:${i}`,wanted.has(js[i].name)?1:0);
}
async function simpleApplyLook(id,{vary=false,clear=false}={}){
  if(te?.id!=='organism')await Fm('organism');
  if(te?.id!=='organism')return;
  const recipe=simpleLooks.find(item=>item.id===id)??simpleLooks[0];
  simpleSpecies(recipe.species);Im(recipe.palette);
  const base={species:0,wild:0,nested:0,physics:0,seasons:0,cycleEvery:0,
    speed:.75,branch:.65,wiggle:.7,length:.85,thickness:1,nodes:.8,
    shader:recipe.shader,env:0,bloom:.35,pulse:.15,flash:.08,
    musicAmount:.42,musicFocus:.7,musicTrail:2,sustain:.2,fillRate:240,
    videoBuild:0,screenBounce:0,materialSpeed:.45,materialReact:.65};
  for(const [key,value] of Object.entries({...base,...recipe.values})){
    let next=value;
    if(vary&&['branch','wiggle','length','thickness'].includes(key))next*=.88+Math.random()*.24;
    simpleSet(key,next);
  }
  simpleGlobal('zoomReact',0);simpleGlobal('beatZoom',0);simpleGlobal('rotSpeed',0);
  te.setCalmCamera?.('still');
  if(clear)M5();
  document.querySelectorAll('[data-simple-look]').forEach(button=>button.classList.toggle('active',button.dataset.simpleLook===recipe.id));
  Y('simpleLookName').textContent=recipe.label;
  vs(`${recipe.label} look · stable camera · play a note`);
}
async function simpleSurprise(){
  let index=Math.floor(Math.random()*simpleLooks.length);
  if(simpleLooks.length>1&&index===simpleLastLook)index=(index+1+Math.floor(Math.random()*(simpleLooks.length-1)))%simpleLooks.length;
  simpleLastLook=index;
  await simpleApplyLook(simpleLooks[index].id,{vary:true,clear:true});
  Y('presetStatus').textContent=`curated surprise: ${simpleLooks[index].label} · shift+click a slot to save`;
}
function simpleReference(mode){
  if(te?.id!=='organism')return vs('Choose Organism before using source guidance.');
  if(mode==='off'){
    simpleSet('videoMode',0);simpleSet('videoBuild',0);simpleSet('shellMode',0);
    return vs('Source guidance off — music grows freely.');
  }
  if(mode==='model'){
    simpleSet('shellMode',1);simpleSet('skinStick',1);simpleSet('morph',0);simpleSet('attach',1);
    simpleSet('branch',.32);simpleSet('wiggle',.35);simpleSet('length',.55);simpleSet('join',.25);
    return vs('3D skin mode — drop a GLB, GLTF, OBJ or STL; growth follows its surface.');
  }
  if(!xn.active)return vs('Load a picture, video or camera first.');
  simpleSet('videoMode',mode==='trace'?3:4);simpleSet('videoStick',1);simpleSet('videoFollow',1);
  simpleSet('videoEdge',mode==='trace'?2.5:1.35);simpleSet('videoScatter',mode==='trace'?.22:.55);
  simpleSet('videoSpawn',1);simpleSet('videoBuild',0);simpleSet('branch',mode==='trace'?.22:.45);
  simpleSet('wiggle',mode==='trace'?.25:.5);simpleSet('length',mode==='trace'?.55:.72);
  simpleSet('join',mode==='trace'?.15:.35);simpleSet('musicAmount',.38);simpleSet('fillRate',180);
  referenceSync();vs(mode==='trace'?'Detail trace — music draws along edges and relief.':'Living relief — music grows across the source surface.');
}
function simpleSetMode(advanced){
  document.body.classList.toggle('simple-ui',!advanced);
  Y('uiMode').textContent=advanced?'Simple controls':'Advanced controls';
  Y('uiMode').setAttribute('aria-pressed',String(advanced));
  try{localStorage.setItem('growth-ui-mode',advanced?'advanced':'simple')}catch{}
}
Y('uiMode').onclick=()=>simpleSetMode(document.body.classList.contains('simple-ui'));
for(const button of document.querySelectorAll('[data-simple-look]'))button.onclick=()=>simpleApplyLook(button.dataset.simpleLook,{clear:true});
Y('simpleSurprise').onclick=()=>void simpleSurprise();
Y('randomMix').onclick=()=>void simpleSurprise();
Y('simpleGrowth').oninput=event=>{
  const value=+event.target.value;Y('simpleGrowthValue').textContent=value.toFixed(2);
  simpleSet('musicAmount',value);simpleSet('speed',.5+value*.65);simpleSet('sustain',Math.max(.08,value*.35));
};
Y('simpleDetail').oninput=event=>{
  const value=+event.target.value;Y('simpleDetailValue').textContent=value.toFixed(2);
  simpleSet('branch',.12+value*.9);simpleSet('wiggle',.2+value*.9);simpleSet('length',1.05-value*.45);
};
Y('simpleAudio').oninput=event=>{
  const value=+event.target.value;globalThis.__growthAudioSensitivity=value;
  Y('simpleAudioValue').textContent=value.toFixed(2);
};
globalThis.__growthAudioSensitivity=+Y('simpleAudio').value;
Y('simpleCamera').onchange=event=>{
  if(te?.id!=='organism')return;
  const mode=event.target.value;
  if(mode==='manual'){if(te.cameraLockPose)te.toggleCameraLock();te.setCalmCamera?.('manual');}
  else te.setCalmCamera?.(mode);
};
Y('simpleTrace').onclick=()=>simpleReference('trace');
Y('simpleRelief').onclick=()=>simpleReference('relief');
Y('simpleModel').onclick=()=>simpleReference('model');
Y('simpleFree').onclick=()=>simpleReference('off');
Y('simpleModelFile').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(te?.id!=='organism')await Fm('organism');
  if(te?.id!=='organism')return;
  Y('simpleModelStatus').textContent='Loading model…';
  try{
    const message=await te.loadShell(file);Y('simpleModelStatus').textContent=message;
    simpleReference('model');M5();
  }catch(error){Y('simpleModelStatus').textContent=`Could not load model: ${error.message}`}
  finally{event.target.value=''}
};
Y('simpleReferenceVisible').onclick=()=>referenceSet('videoShow',referenceValue('videoShow')>0?0:.45);
Y('simpleFit').onclick=()=>Y('refFit').click();
window.addEventListener('drop',event=>{
  const file=event.dataTransfer?.files?.[0];
  if(file&&/\.(glb|gltf|obj|stl)$/i.test(file.name)&&document.body.classList.contains('simple-ui')){
    setTimeout(()=>simpleReference('model'),250);
  }
});

let simpleAdvanced=false;try{simpleAdvanced=localStorage.getItem('growth-ui-mode')==='advanced'}catch{}
simpleSetMode(simpleAdvanced);
const firstRunKey='growth-good-start-v0190';
setTimeout(()=>{
  let first=false;try{first=!localStorage.getItem(firstRunKey);if(first)localStorage.setItem(firstRunKey,'1')}catch{first=true}
  if(first)simpleApplyLook('roots');
},700);
