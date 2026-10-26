// Quick controls share the engine's real controls, so presets and MIDI learning
// continue to operate on the same values.
async function activateReference() {
  if(!xn.active)return;
  if(te?.id!=='organism')await Fm('organism');
  if(te?.id!=='organism')return;
  referenceSet('videoMode',3);referenceSet('videoStick',1);
  referenceSet('videoSpawn',1);referenceSet('videoFollow',1);referenceSet('videoBuild',1);
  referenceSync();
}
function referenceSet(key,value) {
  Zt.get(`e:organism:${key}`)?.set(value);
  referenceSync();
}
function referenceValue(key,fallback=0) {
  return te?.id==='organism' ? (Zt.get(`e:organism:${key}`)?.c.value??fallback) : fallback;
}
function referenceSync() {
  const enabled=!!xn.active&&te?.id==='organism';
  for(const [id,key] of [['refBuild','videoBuild'],['refFollow','videoFollow'],['refVisible','videoShow'],['refInvert','videoInvert']]){
    const button=Y(id);if(!button)continue;
    button.disabled=!enabled;
    const on=referenceValue(key)>0;
    button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));
  }
  for(const [id,key,fallback] of [['refSize','videoSize',22],['refDepth','videoDepth',8]]){
    const slider=Y(id);if(!slider)continue;slider.disabled=!enabled;
    slider.value=String(referenceValue(key,fallback));Y(id+'Value').textContent=slider.value;
  }
  if(Y('refEnable'))Y('refEnable').disabled=!xn.active;
  if(Y('refFit'))Y('refFit').disabled=!enabled;
  if(Y('refHint'))Y('refHint').textContent=!xn.active?'Choose a picture, video or camera above.'
    :te?.id!=='organism'?'Use as 3D shape switches to the Organism pattern.'
    :referenceValue('videoMode')===0?'Guidance is off. Use as 3D shape to enable it.'
    :referenceValue('videoBuild')>0?'Filling the shape. Music can add more growth; Reset starts it again.'
    :'Play notes to grow into the reference, or enable Build shape.';
}
Y('refEnable').onclick=()=>void activateReference();
Y('refFit').onclick=()=>{
  if(te?.id!=='organism'||!xn.ready)return;
  const {w,h}=te.fieldSize();
  te.referenceFrameRadius=(w*w+h*h+referenceValue('videoDepth')**2)/4;
  te.zoomMul=1;te.pan.set(0,0,0);referenceSet('camMode',0);
};
for(const [id,key] of [['refBuild','videoBuild'],['refFollow','videoFollow'],['refInvert','videoInvert']]){
  Y(id).onclick=()=>referenceSet(key,referenceValue(key)>0?0:1);
}
let referenceOpacity=.55;
Y('refVisible').onclick=()=>{
  const value=referenceValue('videoShow');
  if(value>0)referenceOpacity=value;
  referenceSet('videoShow',value>0?0:referenceOpacity);
};
Y('refSize').oninput=event=>referenceSet('videoSize',+event.target.value);
Y('refDepth').oninput=event=>referenceSet('videoDepth',+event.target.value);
xn.onStatus=message=>{Lm(message);Y('videoStop').hidden=!xn.active;referenceSync();};
referenceSync();
setInterval(referenceSync,400);
