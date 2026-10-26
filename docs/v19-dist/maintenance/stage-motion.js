function reflectedStep(position,direction,distance,limit){
 if(limit<=0)return {position:0,direction};
 if(distance<=0)return {position:Math.max(-limit,Math.min(limit,position)),direction};
 let x=position+direction*distance,d=direction;
 // Modulo triangle wave handles long frames without an unbounded bounce loop.
 const span=limit*2,phase=((x+limit)%(span*2)+span*2)%(span*2);
 if(phase>span){x=limit-(phase-span);d=-d;}else x=phase-limit;
 return {position:x,direction:d};
}
Object.assign(tw.prototype,{
 updateBounceBounds(time){
  if(time-(this.bounceBoundsT??-Infinity)<.25&&this.bounceBounds)return;
  this.bounceBoundsT=time;this.camera.updateMatrixWorld();
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const v=new A(),view=new A();
  const add=point=>{
   view.copy(point).applyMatrix4(this.camera.matrixWorldInverse);
   if(view.z>=-this.camera.near)return;
   v.copy(point).project(this.camera);
   if(!Number.isFinite(v.x+v.y)||Math.abs(v.x)>100||Math.abs(v.y)>100)return;
   minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);
  };
  const stride=Math.max(1,Math.ceil(this.segs.length/384));
  for(let i=0;i<this.segs.length;i+=stride){add(this.segs[i].a);add(this.segs[i].b);}
  if(this.videoOn){const {w,h}=this.fieldSize(),d=G(this.controls,'videoDepth')/2;for(const x of [-w/2,w/2])for(const y of [-h/2,h/2])for(const z of [-d,d])add(new A(x,y,z));}
  else if(this.shell){const r=G(this.controls,'shellSize')*1.3;for(const x of [-r,r])for(const y of [-r,r])for(const z of [-r,r])add(new A(x,y,z));}
  for(const [plant,item] of this.softMeshes||[]){if(!item.mesh.visible)continue;item.mesh.geometry.computeBoundingBox();const b=item.mesh.geometry.boundingBox;if(b)for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])add(new A(x,y,z));}
  this.bounceBounds=minX===Infinity?{x:0,y:0,hx:1,hy:1}:{x:(minX+maxX)/2,y:(minY+maxY)/2,hx:Math.max(.1,(maxX-minX)/2)*1.05,hy:Math.max(.1,(maxY-minY)/2)*1.05};
 },
 beginScreenBounce(){
  if(!G(this.controls,'screenBounce')){this.bounceLastTime=null;return null;}
  const time=this.performanceState?.time??0;
  const dt=this.bounceLastTime==null?0:Math.min(.05,Math.max(0,time-this.bounceLastTime));this.bounceLastTime=time;
  this.updateBounceBounds(time);
  this.bounceSmooth??={...this.bounceBounds};const b=this.bounceSmooth,alpha=1-Math.exp(-dt*6);
  for(const key of ['x','y','hx','hy'])b[key]+=(this.bounceBounds[key]-b[key])*alpha;
  const scale=Math.min(1,G(this.controls,'bounceSize')/Math.max(b.hx,b.hy));
  const limitX=Math.max(0,.96-b.hx*scale),limitY=Math.max(0,.96-b.hy*scale);
  const speed=G(this.controls,'bounceSpeed')*2;
  const x=reflectedStep(Math.max(-limitX,Math.min(limitX,this.bounceX||0)),this.bounceDX??1,dt*speed,limitX);
  const y=reflectedStep(Math.max(-limitY,Math.min(limitY,this.bounceY||0)),this.bounceDY??1,dt*speed*.71,limitY);
  this.bounceX=x.position;this.bounceDX=x.direction;this.bounceY=y.position;this.bounceDY=y.direction;
  const original=this.camera.projectionMatrix.clone(),m=this.camera.projectionMatrix.elements;
  for(const i of [0,4,8,12,1,5,9,13])m[i]*=scale;
  m[8]-=x.position-b.x*scale;m[9]-=y.position-b.y*scale;
  this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  return original;
 },
 endScreenBounce(original){if(original){this.camera.projectionMatrix.copy(original);this.camera.projectionMatrixInverse.copy(original).invert();}}
});
