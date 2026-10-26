// A single MediaRecorder clock keeps live video and audio together. Do not
// manually discard mismatched PCM packets or silently create a silent take.
class rZ {
  constructor(){this.active=false;this.frames=0;this.failure='';this.tracks=[];this.rec=null;this.done=null;this.started=0;}
  get recording(){return this.active;}
  get seconds(){return this.active?(performance.now()-this.started)/1000:0;}
  async start(canvas,audio,fps=60,format){
    if(this.active)return 'already recording';
    if(typeof MediaRecorder==='undefined')return 'This browser cannot record. Try Chrome or Edge.';
    const preferred=format?.ext==='mp4'?'mp4':'webm';
    const strict=preferred==='mp4'&&(document.getElementById('recCompat')?.checked??true);
    const explicit=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1.640034,mp4a.40.2','video/mp4;codecs=avc1.4D0034,mp4a.40.2'];
    const candidates=strict?explicit:preferred==='mp4'
      ?['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
      :['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
    const mime=candidates.find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)return strict?'This browser cannot capture explicit H.264 + AAC. Disable MP4 editor compatibility to record another format, then use the Resolve conversion helper.':'No supported recording format in this browser.';
    this.ext=mime.startsWith('video/mp4')?'mp4':'webm';
    this.frames=0;this.failure='';this.tracks=[];this.chunks=[];
    this.lastReport={version:'0.18.0',requestedMime:mime,editorCompatibility:strict,width:canvas.width,height:canvas.height,targetFps:fps};
    try{
      this.stream=canvas.captureStream(fps);
      this.tracks.push(...this.stream.getVideoTracks());
      if(!this.tracks.length)throw new Error('canvas did not provide a video track');
      this.tracks[0].contentHint='detail';
      if(audio)for(const source of audio.getAudioTracks()){
        if(source.readyState==='ended')continue;
        const track=source.clone();this.tracks.push(track);this.stream.addTrack(track);
      }
      const bitrate=Number(document.getElementById('recQuality')?.value)||24000000;
      this.rec=new MediaRecorder(this.stream,{mimeType:mime,videoBitsPerSecond:bitrate,audioBitsPerSecond:256000});
      this.lastReport.reportedMime=this.rec.mimeType;this.lastReport.requestedVideoBitrate=bitrate;
      this.lastReport.reportedVideoBitrate=this.rec.videoBitsPerSecond;this.lastReport.reportedAudioBitrate=this.rec.audioBitsPerSecond;
      this.done=new Promise(resolve=>{this.resolveDone=resolve;});
      this.rec.ondataavailable=event=>{if(event.data?.size)this.chunks.push(event.data);};
      this.rec.onerror=event=>{
        this.failure=event.error?.message||'capture interrupted';
        if(this.rec?.state!=='inactive')this.rec.stop();
        else this.finish();
      };
      this.rec.onstop=()=>this.finish();
      this.started=performance.now();this.rec.start(1000);this.active=true;
      const fallback=this.ext!==preferred?` · ${this.ext.toUpperCase()} fallback`:'';
      return `recording ${canvas.width}×${canvas.height} · ${fps} fps target · ${Math.round(bitrate/1e6)} Mbps${fallback} · ${this.rec.mimeType}${this.stream.getAudioTracks().length?' · audio connected':' · no audio track'}`;
    }catch(error){this.cleanup();return `recording could not start: ${error.message}`;}
  }
  grab(){if(this.active)this.frames++;}
  finish(){
    if(!this.resolveDone)return;
    const resolve=this.resolveDone;this.resolveDone=null;this.active=false;
    let message;
    if(this.failure)message=`recording failed: ${this.failure}`;
    else if(!this.chunks.length)message='recording failed: no frames were captured';
    else{
      const blob=new Blob(this.chunks,{type:this.rec.mimeType});
      const name=`growth-${em()}.${this.ext}`;Tx(blob,name);
      Object.assign(this.lastReport,{filename:name,bytes:blob.size,durationSeconds:(performance.now()-this.started)/1000,renderCallbacks:this.frames,note:'MIME and bitrate are browser reports; inspect the saved file to confirm codecs and frame timing.'});
      message=`saved ${name} · ${(blob.size/1e6).toFixed(1)} MB · ${((performance.now()-this.started)/1000).toFixed(1)} s`;
    }
    this.cleanup();resolve(message);
  }
  async stop(){
    if(!this.rec)return 'not recording';
    const result=this.done;
    if(this.rec.state!=='inactive')this.rec.stop();
    return result;
  }
  cleanup(){
    // Only stop tracks owned by the take. Never stop the input stream.
    for(const track of this.tracks)track.stop();
    this.tracks=[];this.rec=null;this.active=false;this.stream=null;this.chunks=[];
  }
}
