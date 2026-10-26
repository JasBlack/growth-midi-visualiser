// Installed before application startup. These methods belong in the Organism
// engine's TypeScript source when the distribution patch is ported upstream.
Object.assign(tw.prototype, {
  fieldZ(u,v) {
    if(!this.field || G(this.controls,'videoMode')===2) return 0;
    const sign=G(this.controls,'videoInvert')>0?-1:1;
    return (this.field.depth(u,v)-.5)*G(this.controls,'videoDepth')*sign;
  },
  projectToField(point,normal) {
    if(!this.field)return;
    const {w,h}=this.fieldSize();
    // Constrain every guidance mode to the source rectangle; never sample a
    // clamped border indefinitely while a branch escapes into empty space.
    point.x=Math.max(-w*.499,Math.min(w*.499,point.x));
    point.y=Math.max(-h*.499,Math.min(h*.499,point.y));
    const u=point.x/w+.5,v=.5-point.y/h;
    const stick=G(this.controls,'videoMode')===4?1:G(this.controls,'videoStick');
    point.z+=(this.fieldZ(u,v)-point.z)*stick;
    const du=1/Math.max(2,this.field.w),dv=1/Math.max(2,this.field.h);
    const dx=(this.fieldZ(u+du,v)-this.fieldZ(u-du,v))/(2*du*w);
    const dy=(this.fieldZ(u,v+dv)-this.fieldZ(u,v-dv))/(2*dv*h);
    normal.set(-dx,dy,1).normalize();
  },
  referenceAnchor(point) {
    const {w,h}=this.fieldSize();
    return {u:Math.max(0,Math.min(1,point.x/w+.5)),v:Math.max(0,Math.min(1,.5-point.y/h))};
  },
  referencePoint(point,anchor,alpha=1) {
    const {w,h}=this.fieldSize();
    point.x=(anchor.u-.5)*w;point.y=(.5-anchor.v)*h;
    point.z+=(this.fieldZ(anchor.u,anchor.v)-point.z)*alpha;
  },
  rebuildBackdrop() {
    if(!this.scene)return;
    const field=this.field,opacity=G(this.controls,'videoShow');
    if(!field?.ready || opacity<=0){
      if(this.backdrop)this.backdrop.visible=false;
      // Release the texture when the feed is stopped, not just hidden.
      if(!field?.active && this.videoTex){this.videoTex.dispose();this.videoTex=null;}
      return;
    }
    const source=field.frameSource;
    if(!this.videoTex || this.videoTex.image!==source){
      this.videoTex?.dispose();this.videoTex=field.isStill?new IU(source):new FU(source);
      this.videoTex.colorSpace=us;
    }
    if(!this.backdrop){
      this.backdrop=new $t(new Up(1,1),new xs({transparent:true,depthWrite:false,toneMapped:false,side:Et}));
      this.backdrop.raycast=()=>{};this.backdrop.frustumCulled=false;this.scene.add(this.backdrop);
    }
    const {w,h}=this.fieldSize();
    this.backdrop.visible=true;this.backdrop.scale.set(w,h,1);
    this.backdrop.position.z=-G(this.controls,'videoDepth')/2-.6;
    if(this.backdrop.material.map!==this.videoTex){this.backdrop.material.map=this.videoTex;this.backdrop.material.needsUpdate=true;}
    this.backdrop.material.opacity=opacity;
    // Uploaded stills reuse the same canvas object, so identity alone is not sufficient.
    if(field.isStill && this.referenceTextureRevision!==field.revision){
      this.videoTex.needsUpdate=true;this.referenceTextureRevision=field.revision;
    }
  },
  updateReference(state,globals) {
    if(!this.field)return;
    this.field.seedScatter=G(this.controls,'videoScatter');
    this.field.update(state.time);this.rebuildBackdrop();
    if(!this.videoOn){
      for(const plant of this.plants)if(plant.referenceAuto&&(plant.held||plant.autoUntil>state.time))this.release(plant,state.time,0,true);
      return;
    }
    const time=state.time,{w,h}=this.fieldSize();
    if(this.referenceSourceRequest!==this.field.request){
      this.referenceSourceRequest=this.field.request;
      this.referenceFrameRadius=(w*w+h*h+G(this.controls,'videoDepth')**2)/4;
    }
    const signature=[w,h,G(this.controls,'videoDepth'),G(this.controls,'videoInvert'),this.field.request].join(':');
    if(this.referenceSignature!==signature){this.referenceSignature=signature;this.referenceResizePending=true;this.referenceCursor=0;}
    const follow=G(this.controls,'videoFollow')>0;
    if(follow&&((this.field.isStill&&this.referenceRevision!==this.field.revision)||!this.referenceWasFollowing)){
      this.referenceRevision=this.field.revision;this.referenceResizePending=true;this.referenceCursor=0;
    }
    this.referenceWasFollowing=follow;
    if(time-(this.referenceGeometryT??-Infinity)>=1/30 && ((follow&&!this.field.isStill)||this.referenceResizePending)){
      this.referenceGeometryT=time;
      const alpha=this.referenceResizePending?1:1-Math.exp(-1/30*12);
      // Bounded mesh writes. Large scenes follow in batches, rather than stalling.
      const count=this.segs.length,limit=Math.min(count,4000);
      let cursor=this.referenceCursor||0,completed=false;
      for(let i=0;i<limit;i++){
        if(cursor>=count){cursor=0;completed=true;if(this.referenceResizePending)break;}
        const segment=this.segs[cursor++];
        if(!segment.referenceUV)continue;
        this.referencePoint(segment.a,segment.referenceUV.a,alpha);
        this.referencePoint(segment.b,segment.referenceUV.b,alpha);
        this.writeSeg(segment);
      }
      this.referenceCursor=cursor;
      if(cursor>=count||completed)this.referenceResizePending=false;
      for(const plant of this.plants){
        if(plant.referenceRoot)this.referencePoint(plant.root,plant.referenceRoot,alpha);
        for(const tip of plant.tips){
          if(tip.seg?.referenceUV){
            tip.pos.copy(tip.seg.a);
          }else if(tip.referenceUV){this.referencePoint(tip.pos,tip.referenceUV,alpha);}
        }
      }
    }
    const build=G(this.controls,'videoBuild')>0;
    if(!build){
      for(const plant of this.plants)if(plant.referenceAuto&&(plant.held||plant.autoUntil>time))this.release(plant,time,0,true);
      return;
    }
    // Automatic filling is explicit and bounded; MIDI/audio growth still works.
    const active=this.plants.filter(p=>p.held||p.autoUntil>time).length;
    if(active>=Math.min(4,G(this.controls,'maxLive')) || this.segs.length>=Math.min(16000,this.budgetCap()*.8))return;
    if(this.referenceSeedT==null||!Number.isFinite(this.referenceSeedT)){this.referenceSeedT=time;return;}
    if(time-this.referenceSeedT<1/Math.max(.2,G(this.controls,'videoBuildPace')||.8))return;
    this.referenceSeedT=time;
    const uv=this.field.pickPoint(true),root=new A((uv.u-.5)*w,(.5-uv.v)*h,this.fieldZ(uv.u,uv.v));
    const plant=this.newPlant(48+Math.floor(Math.random()*24),.65,globals,time,{root,autoUntil:time+2});
    plant.held=false;plant.referenceAuto=true;plant.referenceRoot=uv;
    this.field.visit(uv.u,uv.v);
  }
});

const referenceOriginalAddSeg=tw.prototype.addSeg;
tw.prototype.addSeg=function(plant,a,b,r,time){
  // Do not bridge an abrupt relief cliff with a long spear. A later seed can
  // begin on the other side. Preserve typography paths and non-reference growth.
  if(this.videoOn&&!plant.isText){
    const {w}=this.fieldSize();
    const maxLength=Math.max(.75,Math.min(3,w*.06,(plant.segLen||.5)*3));
    if(a.distanceTo(b)>maxLength)return null;
  }
  const segment=referenceOriginalAddSeg.call(this,plant,a,b,r,time);
  if(segment&&this.videoOn){
    // addSeg -> writeSeg reuses the caller's scratch vector (often b=this.v1).
    // Only the segment's cloned endpoints remain authoritative after drawing.
    segment.referenceUV={a:this.referenceAnchor(segment.a),b:this.referenceAnchor(segment.b)};
    plant.referenceRoot??=this.referenceAnchor(plant.root);
    this.field.visit(segment.referenceUV.b.u,segment.referenceUV.b.v);
  }
  return segment;
};
const referenceOriginalFinish=tw.prototype.finishSegment;
tw.prototype.finishSegment=function(tip){
  const segment=tip.seg;
  referenceOriginalFinish.call(this,tip);
  if(segment?.referenceUV){tip.referenceUV=segment.referenceUV.b;if(segment.plant.referenceAuto)segment.permanent=true;}
};
const referenceOriginalClear=tw.prototype.clearGrowth;
tw.prototype.clearGrowth=function(){
  referenceOriginalClear.call(this);
  this.referenceCursor=0;this.referenceSeedT=null;
  if(this.field?.visited){this.field.visited.fill(0);this.field.visitedCells=0;this.field.seedCounts?.fill(0);}
};
