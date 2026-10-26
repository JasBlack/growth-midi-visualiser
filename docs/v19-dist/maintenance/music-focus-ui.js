const cameraLockButton=Y('cameraLock');
function syncMusicControls(){
  const enabled=te?.id==='organism';
  cameraLockButton.disabled=!enabled;
  const locked=enabled&&!!te.cameraLockPose;
  cameraLockButton.textContent=locked?'🔒 Camera locked':'🔓 Lock camera';
  cameraLockButton.setAttribute('aria-pressed',String(locked));
  cameraLockButton.title=locked?'Unlock to move the camera. Reset keeps this view.':'Freeze this view, including across Reset';
  for(const [id,key] of [['musicAmount','musicAmount'],['musicFocus','musicFocus'],['musicTrail','musicTrail'],['buildPace','videoBuildPace']]){
    const slider=Y(id);slider.disabled=!enabled;
    if(enabled)slider.value=String(referenceValue(key));
    Y(id+'Value').textContent=slider.value;
  }
}
cameraLockButton.onclick=()=>{if(te?.id==='organism')te.toggleCameraLock();syncMusicControls();};
for(const key of ['musicAmount','musicFocus','musicTrail'])Y(key).oninput=event=>{referenceSet(key,+event.target.value);syncMusicControls();};
Y('buildPace').oninput=event=>{referenceSet('videoBuildPace',+event.target.value);syncMusicControls();};
Y('musicLed').onclick=()=>{
  if(te?.id!=='organism')return;
  for(const [key,value] of [['videoBuild',0],['musicAmount',.45],['sustain',.25],['musicFocus',.8],['musicTrail',2],['fillRate',300]])referenceSet(key,value);
  syncMusicControls();
};
syncMusicControls();setInterval(syncMusicControls,400);
