Y('softOnly').onclick=async()=>{
  if(te?.id!=='organism')await Fm('organism');
  if(te?.id!=='organism')return;
  const selected=Y('softChoice').value;
  for(let i=0;i<js.length;i++){
    const value=js[i].soft&&(selected==='all'||js[i].soft===selected)?1:0;
    sl(te.controls,`sp:${i}`,value);
    (he.engineCtl.organism??={})[`sp:${i}`]=value;
  }
  te.respawnHeld();lR(te);Hi();vs('Soft species selected — play notes or use Build shape with a reference.');
};
Y('cameraPreset').onchange=event=>{
  if(te?.id!=='organism')return vs('Choose the Organism pattern for these camera modes.');
  Zt.get('e:organism:camMode')?.set(+event.target.value);T5();
};
