Object.assign(tw.prototype,{
  updateDynamicMaterials(state){
    const dt=Math.min(.05,Math.max(0,state.dt||0));
    dynamicClock.value+=dt*G(this.controls,'materialSpeed');
    dynamicScale.value=G(this.controls,'materialScale')||1;
    const alpha=1-Math.exp(-dt*10),react=G(this.controls,'materialReact');
    const energy=Math.max(0,Math.min(1,state.energy||0));
    const audible=energy>.01||(state.active?.size||0)>0||state.events?.some(event=>event.kind==='on');
    const attack=Math.max(0,Math.min(1,Math.max(state.onset||0,audible?(state.beat?.hit||0):0)));
    this.materialEnergy=(this.materialEnergy||0)+(energy-(this.materialEnergy||0))*alpha;
    this.materialAttack=Math.max(attack,(this.materialAttack||0)*Math.exp(-dt*7));
    dynamicAudio.value=this.materialEnergy*react;
    dynamicAttack.value=this.materialAttack*react;
  },
  syncSoftMaterial(plant,item){
    const index=G(this.controls,'shader');
    if(item.materialIndex===index)return;
    item.materialIndex=index;
    item.baseMaterial??=item.mesh.material;
    if(item.effectMaterial){item.effectMaterial.dispose();item.effectMaterial=null;}
    // Existing shaders retain their old soft-surface behaviour. New patterns
    // use an owned material so every plant keeps its colour/age emphasis.
    if(index>=dynamicMaterialStart&&index<I_.length){
      try{item.effectMaterial=bf(I_[index].make());item.effectMaterial.side=Et;}
      catch(error){console.warn('Animated soft material unavailable',error);}
    }
    item.mesh.material=item.effectMaterial??item.baseMaterial;
  },
  disposeSoftItem(item){
    this.group.remove(item.mesh);item.mesh.geometry.dispose();
    item.effectMaterial?.dispose();
    (item.baseMaterial??item.mesh.material).dispose();
  }
});
