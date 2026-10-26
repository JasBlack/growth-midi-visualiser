// Additive species: existing rigid species and saved indices remain unchanged.
for(const [name,icon,soft,hue] of [['liquid','💧','liquid',.08],['silk ribbon','〰','ribbon',.32],['wave blanket','🌊','blanket',.56]]){
  js.push({...js[1],name,icon,soft,hue,skin:'smooth',node:'none',nodeScale:0,
    segLen:.22,thickness:.7,taper:.997,branch:.035,branchTaper:.92,
    branchAngle:[.12,.4],wiggle:.35,gravity:0,radial:.05,maxTips:4,maxDepth:140,
    speed:.8,avoid:.1,join:.2,glow:0,turn:'smooth'});
}

Object.assign(tw.prototype,{
  updateSoftGrowth(state){
    if(!state)return;
    this.softMeshes??=new Map();
    const live=new Set(this.plants);
    for(const [plant,item] of this.softMeshes)if(!live.has(plant)){
      this.disposeSoftItem(item);this.softMeshes.delete(plant);
    }
    const dt=Math.min(.1,Math.max(0,state.dt)),mix=1-Math.exp(-dt*8);
    this.softBass=(this.softBass??0)+(state.bass-(this.softBass??0))*mix;
    this.softTreble=(this.softTreble??0)+(state.treble-(this.softTreble??0))*mix;
    const wave=G(this.controls,'softWave'),react=G(this.controls,'softReact'),speed=G(this.controls,'softSpeed');
    const softPlants=this.plants.filter(plant=>plant.sp.soft);
    const start=(this.softUpdateCursor||0)%Math.max(1,softPlants.length);
    let work=0;this.softUpdateCursor=start+16;
    this.softPoint??=[0,0,0];
    for(let step=0;step<softPlants.length;step++){
      const plant=softPlants[(start+step)%softPlants.length];
      let item=this.softMeshes.get(plant);
      if(!item){
        if(work>=16)continue;
        // Additional retained shapes fall back to the original smooth skeleton.
        if(this.softMeshes.size>=64)continue;
        const geometry=plant.sp.soft==='liquid'?new kp(1,2):new Up(1,1,24,16);
        const material=bf(new Tc({color:plant.color,roughness:plant.sp.soft==='liquid'?.16:.45,
          metalness:plant.sp.soft==='liquid'?.25:.08,side:Et}));
        const mesh=new $t(geometry,material);mesh.frustumCulled=false;this.group.add(mesh);
        item={mesh,base:geometry.attributes.position.array.slice(),last:-Infinity};this.softMeshes.set(plant,item);
        for(const segment of plant.segs)this.writeSeg(segment);
      }
      this.syncSoftMaterial(plant,item);
      if(state.time-item.last<1/30||work>=16)continue;work++;item.last=state.time;
      let length=0;for(const segment of plant.segs)length+=segment.a.distanceTo(segment.b)*Math.max(0,Math.min(1,segment.growth));
      const size=Math.min(8,Math.sqrt(length)*.8);
      item.mesh.visible=size>.02;if(size<=.02)continue;
      item.mesh.material.color?.copy(plant.color).multiplyScalar(this.focusLevel(plant.segs[plant.segs.length-1]||{plant,born:plant.birth}));
      const values=item.mesh.geometry.attributes.position.array,phase=plant.id*1.731,t=state.time*speed;
      const energy=(.18+this.softBass*.7+this.softTreble*.25)*react;
      for(let i=0;i<values.length;i+=3){
        const bx=item.base[i],by=item.base[i+1],bz=item.base[i+2];let x,y,z;
        if(plant.sp.soft==='liquid'){
          const pulse=1+wave*(.12+energy*.18)*(Math.sin(bx*3+t+phase)*Math.cos(by*2-t*.7)+.45*Math.sin(bz*4+t*1.2));
          const radius=size*.45;x=bx*radius*pulse;y=by*radius*pulse;z=bz*radius*pulse;
        }else if(plant.sp.soft==='ribbon'){
          const along=(by+.5)*size*2;
          const twist=along*.6+Math.sin(t*.4+phase)*.7;
          const width=Math.min(1.4,size*.2)*bx*(1+.25*Math.sin(along*1.1+t));
          x=Math.sin(along*.55-t*.45+phase)*wave*(.4+energy)+Math.cos(twist)*width;
          y=along;z=Math.cos(along*.4-t*.3+phase)*wave*(.3+energy)+Math.sin(twist)*width;
        }else if(plant.sp.soft!=='blanket'){
          softFormXYZ(plant.sp.soft,bx,by,size,t,phase,wave,energy,this.softPoint);
          [x,y,z]=this.softPoint;
        }else{
          x=bx*size*1.6;y=by*size*1.15;
          z=wave*(.25+energy)*(Math.sin(bx*5+t+phase)*Math.cos(by*4-t*.7)+.45*Math.sin((bx+by)*8-t*1.3));
        }
        x+=plant.root.x;y+=plant.root.y;z+=plant.root.z;
        if(this.videoOn){
          const {w,h}=this.fieldSize();x=Math.max(-w/2,Math.min(w/2,x));y=Math.max(-h/2,Math.min(h/2,y));
          if(G(this.controls,'videoFollow')>0)z=this.fieldZ(x/w+.5,.5-y/h)+(z-plant.root.z)*.18;
        }
        values[i]=x;values[i+1]=y;values[i+2]=z;
      }
      item.mesh.geometry.attributes.position.needsUpdate=true;if(state.time-(item.normalT??-Infinity)>=1/15){item.mesh.geometry.computeVertexNormals();item.normalT=state.time;}
    }
  },
  clearSoftMeshes(){
    if(!this.softMeshes)return;
    for(const item of this.softMeshes.values()){this.disposeSoftItem(item);}
    this.softMeshes.clear();
  }
});
const softWrite=tw.prototype.writeSeg;
tw.prototype.writeSeg=function(segment,...args){
  if(segment.plant.sp.soft&&this.softMeshes?.has(segment.plant)){
    const growth=segment.growth;segment.growth=0;
    try{return softWrite.call(this,segment,...args);}finally{segment.growth=growth;}
  }
  return softWrite.call(this,segment,...args);
};
const softClear=tw.prototype.clearGrowth;
tw.prototype.clearGrowth=function(){this.clearSoftMeshes();return softClear.call(this);};
const softUnmount=tw.prototype.unmount;
tw.prototype.unmount=function(){this.clearSoftMeshes();return softUnmount.call(this);};
