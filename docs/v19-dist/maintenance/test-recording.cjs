const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'recorder-native.js'),'utf8');
const bundle=fs.readFileSync(path.join(__dirname,'../assets/index-BWYXfAkm.js'),'utf8');
assert.ok(bundle.includes(code));
const downloads=[];let latest,allowed='webm',strict=false;
class Track {constructor(kind){this.kind=kind;this.readyState='live';this.stopped=false;}stop(){this.stopped=true;}clone(){const clone=new Track(this.kind);this.cloneTrack=clone;return clone;}}
class Stream {constructor(tracks){this.tracks=tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video')}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio')}addTrack(t){this.tracks.push(t)}}
class Recorder {
  static isTypeSupported(type){return type.includes(allowed)}
  constructor(stream,options){this.stream=stream;this.options=options;this.mimeType=options.mimeType;this.state='inactive';latest=this;}
  start(){this.state='recording'}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['test frames'])});this.onstop()})}
}
const context=vm.createContext({MediaRecorder:Recorder,document:{getElementById:()=>({value:'40000000',checked:strict})},performance:{now:()=>1000},Blob,em:()=> 'test',Tx:(blob,name)=>downloads.push({blob,name})});
vm.runInContext(code+';globalThis.Recording=rZ;',context);
async function run(){
  strict=true;
  const unsupported=new context.Recording();
  assert.match(await unsupported.start({},null,30,{ext:'mp4'}),/cannot capture explicit H.264/);
  strict=false;
  const video=new Track('video'),audio=new Track('audio');let fps;
  const canvas={width:1920,height:1080,captureStream:value=>{fps=value;return new Stream([video])}};
  const recording=new context.Recording();
  const message=await recording.start(canvas,new Stream([audio]),60,{ext:'mp4'});
  assert.match(message,/WebM fallback/i);assert.match(message,/audio connected/);
  assert.equal(fps,60);assert.equal(latest.options.videoBitsPerSecond,40000000);assert.equal(latest.options.audioBitsPerSecond,256000);
  assert.equal(latest.stream.getAudioTracks()[0],audio.cloneTrack);assert.notEqual(audio.cloneTrack,audio);
  const result=await recording.stop();
  assert.match(result,/saved growth-test.webm/);assert.equal(audio.stopped,false);assert.equal(audio.cloneTrack.stopped,true);assert.equal(video.stopped,true);
  assert.equal(recording.active,false);assert.equal(downloads.length,1);
  strict=true;allowed='mp4';const second=new context.Recording();const source=new Track('audio');
  await second.start({width:2560,height:1440,captureStream:()=>new Stream([new Track('video')])},new Stream([source]),30,{ext:'mp4'});
  assert.match(latest.options.mimeType,/avc1/);assert.match(latest.options.mimeType,/mp4a.40.2/);
  const done=second.done;latest.onerror({error:new Error('encoder failure')});
  assert.match(await done,/encoder failure/);assert.equal(source.stopped,false);assert.equal(downloads.length,1,'failed recording must not be presented as a valid file');
  const invalid=new context.Recording();assert.match(await invalid.start({captureStream:()=>new Stream([])},null,30,{ext:'mp4'}),/could not start/);assert.equal(invalid.active,false);

  // The actual input-only method creates and caches one separate analyser tap.
  const begin=bundle.indexOf('recordStream(){this.ensureCtx()'),end=bundle.indexOf('get duration()',begin);
  const method=vm.runInNewContext('({'+bundle.slice(begin,end)+'})');
  let connections=0,created=0;const input={ensureCtx(){},ctx:{createMediaStreamDestination(){created++;return {stream:'input-only'}}},analyser:{connect(){connections++}}};
  assert.equal(method.recordStream.call(input),'input-only');assert.equal(method.recordStream.call(input),'input-only');assert.equal(created,1);assert.equal(connections,1);
  console.log('PASS: audio tracks included, owned clone cleanup, codec fallback, bitrate/fps settings, error handling, and cached input-only bus');
}
run().catch(error=>{console.error(error);process.exitCode=1});
