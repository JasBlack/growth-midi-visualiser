for(const species of extraSoftSpecies){const option=document.createElement('option');option.value=species[2];option.textContent=species[0];Y('softChoice').appendChild(option);}
for(const [index,name] of tipShapeNames.entries()){const option=document.createElement('option');option.value=index;option.textContent=name;Y('tipShapeSelect').appendChild(option);}
Y('tipShapeSelect').onchange=event=>referenceSet('tipShape',+event.target.value);
Y('tipFile').onchange=async event=>{
 const file=event.target.files?.[0];if(!file||te?.id!=='organism')return;
 const engine=te;Y('tipUploadStatus').textContent='Loading marker…';
 try{const index=await engine.loadTipFile(file);if(te!==engine||index==null)return;referenceSet('tipShape',index);Y('tipUploadStatus').textContent=`Loaded ${file.name}`;}
 catch(error){Y('tipUploadStatus').textContent=error.message;}finally{event.target.value='';}
};
Y('screenBounceToggle').onclick=()=>referenceSet('screenBounce',referenceValue('screenBounce')?0:1);
for(const key of ['bounceSpeed','bounceSize','tipSize','tipBrightness','tipLimit'])Y(key).oninput=event=>referenceSet(key,+event.target.value);
function syncExtraControls(){
 const enabled=te?.id==='organism';Y('screenBounceToggle').disabled=!enabled;Y('tipShapeSelect').disabled=!enabled;Y('tipFile').disabled=!enabled;
 Y('screenBounceToggle').setAttribute('aria-pressed',String(!!referenceValue('screenBounce')));
 Y('screenBounceToggle').textContent=referenceValue('screenBounce')?'Bouncing on':'Bounce around screen';
 if(enabled)Y('tipShapeSelect').value=String(referenceValue('tipShape'));
 for(const key of ['bounceSpeed','bounceSize','tipSize','tipBrightness','tipLimit']){
  Y(key).disabled=!enabled;if(enabled)Y(key).value=referenceValue(key);Y(key+'Value').textContent=Y(key).value;
 }
 Y('recReport').disabled=!hl.lastReport||hl.recording;Y('recEditor').disabled=hl.recording||recordingBusy;
}
Y('recReport').onclick=()=>{if(hl.lastReport)Tx(new Blob([JSON.stringify(hl.lastReport,null,2)],{type:'application/json'}),'growth-recording-report.json');};
Y('recEditor').onclick=()=>{
 if(recordingBusy||hl.recording)return;
 const format=Qa.find(item=>item.ext==='mp4');if(!format)return vs('MP4 is not offered by this browser. Record WebM and use the conversion helper.');
 he.recFormat=format.mime;Y('recFormat').value=format.mime;Y('recCompat').checked=true;
 Y('recResolution').value='1080';Y('recFps').value='30';Hi();vs('Editor starting point: MP4 H.264/AAC requested, 1080 tall, 30 fps target.');
};
syncExtraControls();setInterval(syncExtraControls,400);
