// Readable replacement methods for v0.15.0's compiled audio-input class O5.
// The patcher embeds these methods directly into the class, not a runtime shim.
// Shared recording routing through U5/Gw is deliberately retained.
// @method beginInputRequest
beginInputRequest() {
  this.stop();
  // Disconnect only speaker monitoring, preserving the shared recording tap.
  if (this.outConnected && this.analyser && this.ctx) {
    this.analyser.disconnect(this.ctx.destination);
    this.outConnected = false;
  }
  return this.inputRequest;
}
// @method loadTrack
async loadTrack(index) {
  const file = this.playlist[index];
  if (!file) return;
  const request = this.beginInputRequest();
  this.buffer = null;
  this.fileName = '';
  this.offset = 0;
  this.trackI = index;
  this.onStatus(`decoding ${file.name}…`);
  try {
    const context = this.ensureCtx();
    const bytes = await file.arrayBuffer();
    if (request !== this.inputRequest) return;
    const buffer = await context.decodeAudioData(bytes);
    if (request !== this.inputRequest) return;
    this.buffer = buffer;
    this.fileName = file.name;
    this.source = 'file';
    this.active = true;
    this.play();
    this.onStatus(`${this.playlist.length > 1 ? `track ${index + 1}/${this.playlist.length}: ` : ''}${file.name} (${buffer.duration.toFixed(0)} s)`);
    this.onTrack(file.name, index, this.playlist.length);
  } catch (error) {
    if (request !== this.inputRequest) return;
    this.stop();
    this.buffer = null;
    this.fileName = '';
    this.onStatus(`could not play ${file.name}: ${error.message}`);
  }
}
// @method startMic
async startMic(deviceId) {
  const request = this.beginInputRequest();
  let stream;
  try {
    const context = this.ensureCtx();
    stream = await navigator.mediaDevices.getUserMedia({audio: {
      deviceId: deviceId ? {exact: deviceId} : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false
    }});
    if (request !== this.inputRequest) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    if (!stream.getAudioTracks().length) throw new Error('no audio track was provided');
    this.micStream = stream;
    this.micSource = context.createMediaStreamSource(stream);
    this.micSource.connect(this.analyser);
    this.source = 'mic';
    this.active = true;
    stream.getAudioTracks()[0].onended = () => {
      if (request !== this.inputRequest || this.micStream !== stream) return;
      this.stop();
      this.onStatus('microphone disconnected — select an input to reconnect');
    };
    this.onStatus(`input live: ${stream.getAudioTracks()[0].label || 'default microphone'}`);
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    if (request !== this.inputRequest) return;
    this.stop();
    this.onStatus(`microphone unavailable: ${error.message}`);
  }
}
// @method startTabCapture
async startTabCapture() {
  const request = this.beginInputRequest();
  let stream;
  try {
    const context = this.ensureCtx();
    stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
    if (request !== this.inputRequest) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach(track => track.stop());
      this.onStatus('no audio in that share — choose a tab and enable Share tab audio');
      return;
    }
    stream.getVideoTracks().forEach(track => track.stop());
    this.tabStream = stream;
    this.tabSource = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    this.tabSource.connect(this.analyser);
    stream.getAudioTracks()[0].onended = () => {
      if (request !== this.inputRequest || this.tabStream !== stream) return;
      this.stop();
      this.onStatus('tab capture ended');
    };
    this.source = 'tab';
    this.active = true;
    this.onStatus('tab / system audio live');
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    if (request !== this.inputRequest) return;
    this.stop();
    this.onStatus(`tab capture unavailable: ${error.message}`);
  }
}
