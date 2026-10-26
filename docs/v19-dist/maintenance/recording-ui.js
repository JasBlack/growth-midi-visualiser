let recordingBusy=false,recordingCountdown=0,recordingRestore=null;
function restoreRecordingQuality(){
  if(recordingRestore){
    const {engine,ratio}=recordingRestore;
    if(engine.renderer){engine.renderer.setPixelRatio(ratio);engine.pixelNow=ratio;engine.resize();}
    engine.lockQuality=false;recordingRestore=null;
  }
  const button=Y('record');button.classList.remove('rec');button.textContent='● rec';button.disabled=false;
  for(const id of ['recAudio','recResolution','recFps','recQuality','recFormat','recCompat'])Y(id).disabled=false;
}
async function Vw(){
  if(recordingBusy||hl.recording)return;
  recordingBusy=true;Y('record').disabled=true;
  try{
    const context=Al();if(context.state==='suspended')await context.resume();
    let audio;
    if(Y('recAudio').value==='input'&&fa!=='midi'){
      if(!je.active)throw new Error('Start an audio file, microphone or tab input first, or choose Full mix.');
      audio=je.recordStream();
    }else audio=Gw();
    if(te?.renderer){
      const ratio=te.renderer.getPixelRatio();recordingRestore={engine:te,ratio};te.lockQuality=true;
      const target=Number(Y('recResolution').value);
      if(target){
        const height=te.host.clientHeight,width=te.host.clientWidth;
        // Render real pixels, rather than enlarging a low-resolution screenshot.
        const captureRatio=Math.min(4,target/Math.max(1,height),3840/Math.max(1,width));
        te.pixelNow=captureRatio;te.renderer.setPixelRatio(captureRatio);te.resize();te.draw?.();
      }
    }
    const canvas=OM();if(!canvas)throw new Error('Nothing to record.');
    const status=await hl.start(canvas,audio,Number(Y('recFps').value),nZ(he.recFormat),context.sampleRate);
    vs(status);
    if(!hl.recording){restoreRecordingQuality();return;}
    Y('record').classList.add('rec');Y('record').textContent='■ stop';
    for(const id of ['recAudio','recResolution','recFps','recQuality','recFormat','recCompat'])Y(id).disabled=true;
    // Also restore the UI/renderer when the browser ends a take with an error.
    hl.done.then(message=>{restoreRecordingQuality();vs(message);});
  }catch(error){vs(error.message);restoreRecordingQuality();}
  finally{recordingBusy=false;Y('record').disabled=false;}
}
async function x5(){
  if(recordingBusy)return;
  if(hl.recording){recordingBusy=true;try{await hl.stop();}finally{recordingBusy=false;}return;}
  const countdown=Y('countdown');
  if(Cp||recordingCountdown){Cp=false;recordingCountdown=0;countdown.hidden=true;Y('record').textContent='● rec';vs('recording disarmed');return;}
  if(Y('recMode').value==='note'){Cp=true;countdown.textContent='♪';countdown.hidden=false;Y('record').textContent='cancel';vs('armed — recording starts on the next note');return;}
  if(Y('recMode').value==='count'){
    const token=performance.now()||1;recordingCountdown=token;Y('record').textContent='cancel';
    for(let n=3;n>0;n--){
      countdown.textContent=String(n);countdown.hidden=false;
      await new Promise(resolve=>setTimeout(resolve,1000));
      if(recordingCountdown!==token)return;
    }
    recordingCountdown=0;countdown.hidden=true;
  }
  await Vw();
}
