// A stable presentation camera. Growth remains the motion; audio does not push,
// shake or zoom the lens while calmCamera is enabled.
Object.assign(tw.prototype, {
  setCalmCamera(mode='still') {
    const set=(key,value)=>this.setControl(key,value);
    set('calmCamera',1);set('camFollow',0);set('growAtCam',0);
    set('kick',0);set('shake',0);
    if(mode==='still') {
      set('camMode',0);set('orbit',0);
      if(!this.cameraLockPose)this.toggleCameraLock();
    } else {
      if(this.cameraLockPose)this.toggleCameraLock();
      set('camMode',0);set('orbit',mode==='gentle'?.08:0);
    }
  }
});
