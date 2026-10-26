// Exercise the shipped class with controlled asynchronous browser APIs.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const bundle = fs.readFileSync(path.join(__dirname, '../assets/index-BWYXfAkm.js'), 'utf8');
const start = bundle.indexOf('class O5{');
const end = bundle.indexOf('class W5{', start);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no) => {resolve=yes;reject=no});
  return {promise,resolve,reject};
}
function stream() {
  const audio = {label:'Test mic',stopped:false,stop(){this.stopped=true}};
  return {audio,getTracks:()=>[audio],getAudioTracks:()=>[audio],getVideoTracks:()=>[]};
}
function harness() {
  const decoded = new Map(), requests = [], messages = [], played = [], disconnected = [], notes = [];
  const destination = {};
  const analyser = {connect(){},disconnect: target => disconnected.push(target)};
  const context = {
    destination,currentTime:0,
    decodeAudioData: bytes => {const pending=deferred();decoded.set(bytes,pending);return pending.promise},
    createMediaStreamSource: () => ({connect(){},disconnect(){}}),
    createBufferSource: () => ({connect(){},disconnect(){},stop(){},start(){played.push(this.buffer)}})
  };
  const capture = () => {const pending=deferred();requests.push(pending);return pending.promise};
  const sandbox = vm.createContext({
    C:(object,key,value)=>object[key]=value,kr:4096,ba:class{push(x){return x}},
    navigator:{mediaDevices:{getUserMedia:capture,getDisplayMedia:capture}},
    MediaStream:class{constructor(tracks){this.tracks=tracks}},
    Al:()=>context,U5(){},Gw(){},console
  });
  vm.runInContext(bundle.slice(start,end)+';globalThis.AudioInput=O5;',sandbox);
  const audio = new sandbox.AudioInput({now:()=>0,push:note=>notes.push(note)});
  audio.ctx=context;audio.analyser=analyser;audio.tapped=true;
  audio.onStatus=message=>messages.push(message);
  return {audio,context,decoded,requests,messages,played,disconnected,notes};
}
const file = name => ({name,arrayBuffer:async()=>name});
async function test() {
  // A slow earlier decode may not replace a later selection.
  let h=harness();h.audio.playlist=[file('first'),file('second')];
  const first=h.audio.loadTrack(0);await new Promise(setImmediate);
  const second=h.audio.loadTrack(1);await new Promise(setImmediate);
  h.decoded.get('second').resolve({duration:30,name:'second'});await second;
  h.decoded.get('first').resolve({duration:20,name:'first'});await first;
  assert.equal(h.audio.fileName,'second');assert.equal(h.played.length,1);

  // Returning to MIDI while decoding prevents autoplay.
  h=harness();h.audio.playlist=[file('pending')];
  const pending=h.audio.loadTrack(0);await new Promise(setImmediate);h.audio.stop();
  h.decoded.get('pending').resolve({duration:10});await pending;
  assert.equal(h.played.length,0);assert.equal(h.audio.active,false);

  // A corrupt file must not leave the previous buffer replayable.
  h=harness();h.audio.buffer={duration:50};h.audio.playlist=[file('bad')];
  const bad=h.audio.loadTrack(0);await new Promise(setImmediate);h.decoded.get('bad').reject(new Error('decode failed'));await bad;
  assert.equal(h.audio.buffer,null);assert.equal(h.audio.playing,false);assert.match(h.messages.at(-1),/decode failed/);

  // Late microphone grants are stopped and cannot re-enable an old source.
  h=harness();const oldMic=h.audio.startMic('old');const newMic=h.audio.startMic('new');
  const oldStream=stream(),newStream=stream();h.requests[1].resolve(newStream);await newMic;
  h.requests[0].resolve(oldStream);await oldMic;
  assert.equal(oldStream.audio.stopped,true);assert.equal(newStream.audio.stopped,false);
  assert.equal(h.audio.micStream,newStream);

  // Speaker monitoring is removed, but the separate recording tap is untouched.
  h=harness();h.audio.outConnected=true;const mic=h.audio.startMic();
  assert.deepEqual(h.disconnected,[h.context.destination]);assert.equal(h.audio.outConnected,false);
  const live=stream();h.requests[0].resolve(live);await mic;
  h.audio.pendingOffs=[{pitch:60}];live.audio.onended();
  assert.equal(h.audio.active,false);assert.equal(live.audio.stopped,true);assert.equal(h.notes.at(-1).kind,'off');

  // Leaving a permission prompt cancels its eventual result for either API.
  for (const method of ['startMic','startTabCapture']) {
    h=harness();const capture=h.audio[method]();h.audio.stop();
    const late=stream();h.requests[0].resolve(late);await capture;
    assert.equal(late.audio.stopped,true);assert.equal(h.audio.source,'none');
  }

  // Old errors must not overwrite a newer input's status.
  h=harness();const rejected=h.audio.startMic();const newest=h.audio.startTabCapture();
  h.requests[1].resolve(stream());await newest;const status=h.messages.at(-1);
  h.requests[0].reject(new Error('old denied prompt'));await rejected;
  assert.equal(h.messages.at(-1),status);assert.equal(h.audio.source,'tab');

  // Browser "stop sharing" releases pending notes and closes the active stream.
  const shared=h.audio.tabStream;h.audio.pendingOffs=[{pitch:64}];shared.audio.onended();
  assert.equal(h.audio.active,false);assert.equal(shared.audio.stopped,true);
  assert.equal(h.notes.at(-1).pitch,64);
  console.log('PASS: decode ordering, cancellation, corrupt files, permission races, stale errors, speaker routing, device end and note cleanup');
}
test().catch(error=>{console.error(error);process.exitCode=1});
