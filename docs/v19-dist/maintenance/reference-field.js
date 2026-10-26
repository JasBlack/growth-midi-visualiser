// Replacement for aJ: a bounded, smoothed real-time image field.
// This is luminance relief, not monocular semantic depth reconstruction.
class aJ {
  constructor(targetW = 192) {
    this.targetW = targetW;
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.loop = true;
    this.still = document.createElement('canvas');
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', {willReadFrequently: true});
    this.stream = null; this.objectURL = null; this.request = 0; this.revision = 0;
    this.active = false; this.isStill = false; this.source = 'none'; this.name = '';
    this.aspect = 16 / 9; this.lastT = -Infinity; this.w = this.h = 0;
    this.edgeCells = this.visitedCells = 0; this.onStatus = () => {};
    this.depthBuf = this.edgeBuf = this.gxBuf = this.gyBuf = this.prev = new Float32Array(0);
    this.visited = new Uint8Array(0);
  }
  resetField() {
    this.w = this.h = 0; this.lastT = -Infinity;
    this.edgeCells = this.visitedCells = 0; this.seedCounts = new Float32Array(144); this.revision++;
  }
  stopCamera() {
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
  }
  stop() {
    this.request++;
    this.video.pause(); this.stopCamera(); this.video.srcObject = null;
    this.video.removeAttribute('src'); this.video.load();
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
    this.objectURL = null; this.active = false; this.isStill = false;
    this.source = 'none'; this.name = ''; this.resetField();
  }
  async openImage(file) {
    this.stop(); const request = this.request;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (request !== this.request) return 'picture load cancelled';
      const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
      this.still.width = Math.max(2, Math.round(image.naturalWidth * scale));
      this.still.height = Math.max(2, Math.round(image.naturalHeight * scale));
      this.still.getContext('2d').drawImage(image, 0, 0, this.still.width, this.still.height);
      this.isStill = true; this.source = 'image'; this.name = file.name; this.active = true;
      this.update(performance.now() / 1000);
      return `picture: ${file.name}`;
    } catch (error) { return `image failed: ${error.message}`; }
    finally { URL.revokeObjectURL(url); }
  }
  async openFile(file) {
    this.stop(); const request = this.request;
    this.objectURL = URL.createObjectURL(file); this.video.src = this.objectURL;
    try {
      await this.video.play();
      if (request !== this.request) return 'video load cancelled';
      this.source = 'file'; this.name = file.name; this.active = true;
      this.update(performance.now() / 1000);
      return `video: ${file.name}`;
    } catch (error) {
      if (request === this.request) this.stop();
      return `video unavailable: ${error.message}`;
    }
  }
  async openCamera(deviceId) {
    this.stop(); const request = this.request; let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({video: deviceId
        ? {deviceId: {exact: deviceId}} : {width: 640, height: 360, facingMode: 'user'}});
      if (request !== this.request) { stream.getTracks().forEach(track => track.stop()); return 'camera cancelled'; }
      this.stream = stream; this.video.srcObject = stream;
      await this.video.play();
      if (request !== this.request) { stream.getTracks().forEach(track => track.stop()); return 'camera cancelled'; }
      this.name = stream.getVideoTracks()[0]?.label || 'camera';
      this.source = 'camera'; this.active = true;
      stream.getVideoTracks().forEach(track => { track.onended = () => {
        if (request !== this.request) return;
        this.stop(); this.onStatus('camera disconnected');
      }; });
      this.update(performance.now() / 1000);
      return `video: ${this.name}`;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (request === this.request) this.stop();
      return `camera unavailable: ${error.message}`;
    }
  }
  async listCameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
      .map((d, i) => ({id: d.deviceId, label: d.label || `camera ${i + 1}`})); }
    catch { return []; }
  }
  get frameSource() { return this.isStill ? this.still : this.video; }
  get ready() { return this.active && this.w > 0; }
  togglePlay() {
    if (this.source !== 'file') return;
    if (this.video.paused) this.video.play().catch(error => this.onStatus(`video: ${error.message}`));
    else this.video.pause();
  }
  update(time) {
    if (!this.active || (this.isStill && this.w) || (!this.isStill && this.video.readyState < 2)) return;
    if (time - this.lastT < 1 / 30) return;
    const dt = Number.isFinite(this.lastT) ? Math.max(0, time - this.lastT) : 1;
    this.lastT = time;
    const width = this.isStill ? this.still.width : this.video.videoWidth;
    const height = this.isStill ? this.still.height : this.video.videoHeight;
    if (!width || !height) return;
    this.aspect = width / height;
    // Bound both axes, including tall portrait inputs.
    const scale = Math.min(this.targetW / width, this.targetW / height);
    const w = Math.max(2, Math.round(width * scale)), h = Math.max(2, Math.round(height * scale));
    const fresh = w !== this.w || h !== this.h;
    if (fresh) {
      this.w = w; this.h = h; this.canvas.width = w; this.canvas.height = h;
      this.depthBuf = new Float32Array(w*h); this.edgeBuf = new Float32Array(w*h);
      this.gxBuf = new Float32Array(w*h); this.gyBuf = new Float32Array(w*h);
      this.prev = new Float32Array(w*h); this.visited = new Uint8Array(w*h);
    }
    try {
      this.ctx.drawImage(this.frameSource, 0, 0, w, h);
      const rgba = this.ctx.getImageData(0, 0, w, h).data;
      for (let i=0; i<w*h; i++) this.prev[i] = (rgba[4*i]*.299 + rgba[4*i+1]*.587 + rgba[4*i+2]*.114) / 255 * rgba[4*i+3]/255;
    } catch (error) { this.stop(); this.onStatus(`cannot read reference: ${error.message}`); return; }
    const alpha = fresh || this.isStill ? 1 : 1-Math.exp(-dt*9);
    const at = (x,y) => this.prev[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))];
    this.edgeCells = this.visitedCells = 0;
    for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
      const i=y*w+x;
      const tl=at(x-1,y-1),tc=at(x,y-1),tr=at(x+1,y-1),ml=at(x-1,y),mc=at(x,y),mr=at(x+1,y),bl=at(x-1,y+1),bc=at(x,y+1),br=at(x+1,y+1);
      const smooth=(tl+tr+bl+br+2*(tc+ml+mr+bc)+4*mc)/16;
      this.depthBuf[i]+=(smooth-this.depthBuf[i])*alpha;
      const gx=tr+2*mr+br-tl-2*ml-bl,gy=bl+2*bc+br-tl-2*tc-tr;
      this.gxBuf[i]=gx; this.gyBuf[i]=gy;
      this.edgeBuf[i]=Math.min(1,Math.hypot(gx,gy)*.9);
      // Moving edges should get new seeds, rather than retaining old coverage.
      if (!this.isStill && Math.abs(smooth-this.depthBuf[i])>.025) this.visited[i]=0;
      if (this.edgeBuf[i]>=.3) {this.edgeCells++;if(this.visited[i])this.visitedCells++;}
    }
    this.revision++;
  }
  idx(u,v) { return Math.round(Math.max(0,Math.min(1,v))*(this.h-1))*this.w+Math.round(Math.max(0,Math.min(1,u))*(this.w-1)); }
  sample(buffer,u,v) {
    if (!this.w) return 0;
    const x=Math.max(0,Math.min(1,u))*(this.w-1),y=Math.max(0,Math.min(1,v))*(this.h-1);
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(this.w-1,x0+1),y1=Math.min(this.h-1,y0+1),fx=x-x0,fy=y-y0;
    return (buffer[y0*this.w+x0]*(1-fx)+buffer[y0*this.w+x1]*fx)*(1-fy)+(buffer[y1*this.w+x0]*(1-fx)+buffer[y1*this.w+x1]*fx)*fy;
  }
  depth(u,v) { return this.sample(this.depthBuf,u,v); }
  edge(u,v) { return this.sample(this.edgeBuf,u,v); }
  grad(u,v,out) { out.x=this.sample(this.gxBuf,u,v);out.y=this.sample(this.gyBuf,u,v); }
  visit(u,v) {
    if (!this.w || u<0 || u>1 || v<0 || v>1) return;
    const i=this.idx(u,v),x=i%this.w,y=Math.floor(i/this.w);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=this.w||yy<0||yy>=this.h)continue;
      const j=yy*this.w+xx;
      if(!this.visited[j]){this.visited[j]=1;if(this.edgeBuf[j]>=.3)this.visitedCells++;}
    }
  }
  coverage() { return this.edgeCells ? Math.min(1,this.visitedCells/this.edgeCells) : 0; }
  pickPoint(edges=true,tries=32) {
    this.seedCounts??=new Float32Array(144);
    const scatter=Math.max(0,Math.min(1,this.seedScatter??.7));
    // Weighted reservoir sampling, not "pick the strongest of 64 edges".
    // Every pixel has a nonzero chance, with a soft penalty on crowded tiles.
    let chosen={u:Math.random(),v:Math.random()},total=0;
    for(let i=0;i<tries;i++){
      const u=Math.random(),v=Math.random();
      const tile=Math.min(11,Math.floor(v*12))*12+Math.min(11,Math.floor(u*12));
      const detail=edges?.15+this.edge(u,v)*2:.25+this.depth(u,v);
      const coverage=this.visited[this.idx(u,v)]?.3:1;
      const weight=(scatter+(1-scatter)*detail)*coverage/(1+this.seedCounts[tile]*.8);
      total+=weight;
      if(Math.random()*total<weight)chosen={u,v};
    }
    const tile=Math.min(11,Math.floor(chosen.v*12))*12+Math.min(11,Math.floor(chosen.u*12));
    this.seedCounts[tile]++;
    // Slowly forget old roots; changing footage and long sessions stay varied.
    for(let i=0;i<this.seedCounts.length;i++)this.seedCounts[i]*=.998;
    return chosen;
  }
}
