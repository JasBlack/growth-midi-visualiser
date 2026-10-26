Object.assign(tw.prototype,{
  updateCinematic(state,globals){
    const mode=G(this.controls,'camMode');if(mode<6)return;
    const time=state.time,dt=Math.min(.1,state.dt),speed=G(this.controls,'orbit');
    const smooth=G(this.controls,'camSmooth'),distance=G(this.controls,'camDistance');
    const alive=this.plants.filter(plant=>(plant.held||plant.autoUntil>time)&&plant.tips.length);
    let target=this.newCenter.clone();
    const tipPosition=plant=>{
      const tip=plant.tips[plant.tips.length-1];
      return tip.seg?tip.seg.a.clone().lerp(tip.seg.b,Math.min(1,tip.seg.growth)):tip.pos.clone();
    };
    if(mode===6&&alive.length)target=tipPosition(alive[alive.length-1]);
    if(mode===7&&alive.length){
      if(!alive.includes(this.tourPlant)||time>(this.tourSwitch??0)){
        const index=(this.tourIndex??-1)+1;this.tourIndex=index;
        this.tourPlant=alive[index%alive.length];this.tourSwitch=time+Math.max(2,5-speed);
      }
      target=tipPosition(this.tourPlant);
    }
    let radius=distance*this.zoomMul/Math.max(.2,globals.zoomNow);
    if(mode===8){
      target=this.center.clone();let extent=Math.sqrt(this.referenceFrameRadius||0);
      const segments=this.segs||[],stride=Math.max(1,Math.ceil(segments.length/512));
      for(let i=0;i<segments.length;i+=stride)extent=Math.max(extent,segments[i].b.distanceTo(target));
      radius=Math.max(distance,extent*2.2+5)*this.zoomMul/Math.max(.2,globals.zoomNow);
    }
    this.cinematicAngle=(this.cinematicAngle??0)+dt*speed*(mode===8?.14:.3);
    const angle=this.cinematicAngle+this.manTheta;
    const elevation=Math.max(-1.2,Math.min(1.2,.25+this.manPhi+.16*Math.sin(time*.21)));
    this.cinematicBass=(this.cinematicBass??0)+(state.bass-(this.cinematicBass??0))*(1-Math.exp(-dt*3));
    radius*=1-.07*this.cinematicBass;
    const position=new A(Math.sin(angle)*Math.cos(elevation),Math.sin(elevation),Math.cos(angle)*Math.cos(elevation)).multiplyScalar(radius).add(target).add(this.pan);
    target.add(this.pan);
    const alpha=1-Math.exp(-dt*(1+smooth*7));
    this.camPos.lerp(position,alpha);this.camLook.lerp(target,alpha);
  }
});
