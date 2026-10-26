// Camera pose lock and bounded music-led pacing. Port into the source engine.
Object.assign(tw.prototype,{
  toggleCameraLock(){
    if(this.cameraLockPose){this.cameraLockPose=null;return false;}
    if(!this.camera)return false;
    this.cameraLockPose={position:this.camera.position.clone(),quaternion:this.camera.quaternion.clone(),
      look:this.camLook.clone(),near:this.camera.near,far:this.camera.far,fov:this.camera.fov};
    this.dragBtn=-1;return true;
  },
  applyCameraLock(){
    const pose=this.cameraLockPose;if(!pose)return;
    this.camPos.copy(pose.position);this.camLook.copy(pose.look);
    this.camera.position.copy(pose.position);this.camera.quaternion.copy(pose.quaternion);
    if(this.camera.near!==pose.near||this.camera.far!==pose.far||this.camera.fov!==pose.fov){
      this.camera.near=pose.near;this.camera.far=pose.far;this.camera.fov=pose.fov;this.camera.updateProjectionMatrix();
    }
  },
  segmentAllowance(rate,dt){
    if(rate<=0){this.musicCredit=0;return Infinity;}
    // Fractional credit, no minimum of one per frame and no post-stall catch-up burst.
    this.musicCredit=Math.min(64,(this.musicCredit||0)+rate*Math.min(.05,Math.max(0,dt)));
    return Math.floor(this.musicCredit);
  },
  focusLevel(segment){
    const focus=G(this.controls,'musicFocus');if(focus<=0)return 1;
    const age=Math.max(0,(this.lastGTime??segment.born)-segment.born);
    const trail=G(this.controls,'musicTrail')||2;
    const fresh=segment.plant.referenceAuto?0:Math.max(0,1-age/trail);
    return 1-focus*.8+focus*1.15*fresh;
  },
  refreshMusicFocus(){
    const count=this.segs.length;
    // New segments are coloured immediately. Older ones age in a bounded sweep.
    for(let i=0;i<Math.min(count,800);i++){
      this.focusCursor=(this.focusCursor||0)%count;
      this.writeColor(this.segs[this.focusCursor++]);
    }
    if(this.tipMesh){
      const focus=G(this.controls,'musicFocus')>0;
      this.tipMesh.material.depthTest=!focus;this.tipMesh.renderOrder=focus?10:0;
    }
  }
});
const focusWriteColor=tw.prototype.writeColor;
tw.prototype.writeColor=function(segment){
  const plant=segment.plant,original=plant.color;
  this.musicTint??=original.clone();
  plant.color=this.musicTint.copy(original).multiplyScalar(this.focusLevel(segment));
  try{return focusWriteColor.call(this,segment);}finally{plant.color=original;}
};
const focusClear=tw.prototype.clear;
tw.prototype.clear=function(){
  const keys=['center','newCenter','camPos','camLook','heading','pan','camTarget','camLookT'];
  const scalars=['dist','manTheta','manPhi','zoomMul','theta','cinematicAngle'];
  const saved=this.cameraLockPose?Object.fromEntries([...keys.map(k=>[k,this[k]?.clone()]),...scalars.map(k=>[k,this[k]])]):null;
  focusClear.call(this);this.musicCredit=0;this.focusCursor=0;
  if(saved){for(const k of keys)if(saved[k])this[k].copy(saved[k]);for(const k of scalars)this[k]=saved[k];this.applyCameraLock();}
};
