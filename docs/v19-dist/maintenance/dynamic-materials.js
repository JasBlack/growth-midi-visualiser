// Append-only material catalogue. All patterns use bounded arithmetic, no noise
// loops, textures, transparency, additional meshes, or additional render passes.
const dynamicMaterialStart=I_.length;
const dynamicClock=on(0),dynamicScale=on(1),dynamicAudio=on(0),dynamicAttack=on(0);
const dynamicWave=node=>pc(node).mul(.5).add(.5);
function dynamicSurface(mask,low,high,roughness,metalness,glow=.15){
  const tint=Ri(Le(...low),Le(...high),eL(mask,0,1)).mul(b.materialColor);
  return ks({colorNode:tint,roughness,metalness,
    emissiveNode:KX.rgb.mul(eL(mask,0,1)).mul(dynamicAudio.mul(.25).add(glow))});
}
const dynamicMaterialEntries=[
  {name:'tidal glass',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const waves=dynamicWave(p.x.mul(2).add(t).add(pc(p.z.mul(2).sub(t.mul(.7)))));
    return dynamicSurface(waves,[.025,.12,.2],[.35,.95,1],.19,.32);
  }},
  {name:'pearl currents',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const folds=dynamicWave(p.y.mul(2.5).sub(t.mul(.6)).add(pc(p.x.add(p.z).mul(1.4).add(t)).mul(2)));
    return dynamicSurface(folds,[.24,.15,.32],[1,.85,.72],.28,.48,.05);
  }},
  {name:'mercury ribbons',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const warp=pc(p.z.mul(2).add(t.mul(.4)));
    const bands=cl(.35,.65,dynamicWave(p.x.mul(3).add(p.y).sub(t).add(warp)));
    return dynamicSurface(bands,[.035,.055,.09],[.85,.95,1],.16,.9,.07);
  }},
  {name:'biolume',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const dots=dynamicWave(p.x.mul(3).add(t)).mul(dynamicWave(p.y.mul(3.7).sub(t.mul(.8)))).mul(dynamicWave(p.z.mul(2).add(t.mul(.3))));
    const light=cl(.32,.8,dots).mul(dynamicAttack.mul(.5).add(.5));
    return dynamicSurface(light,[.015,.06,.08],[.2,1,.55],.45,.12,.65);
  }},
  {name:'oil slick',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const hue=p.x.mul(.12).add(p.z.mul(.09)).add(dynamicWave(p.y.add(t.mul(.4))).mul(.3)).add(t.mul(.08));
    return ks({colorNode:Yg(hue).mul(.8).add(.12).mul(b.materialColor),roughness:.22,metalness:.7,
      emissiveNode:KX.rgb.mul(dynamicAudio.mul(.18).add(.08))});
  }},
  {name:'silk shimmer',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const warp=dynamicWave(p.x.mul(4).add(pc(p.y.mul(1.2).sub(t))));
    const weft=dynamicWave(p.z.mul(4).add(t.mul(.7)));
    return dynamicSurface(warp.mul(weft).mul(.65).add(warp.mul(.35)),[.12,.025,.2],[1,.48,.7],.52,.15,.08);
  }},
  {name:'molten gold',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const streams=dynamicWave(p.y.mul(2).sub(t).add(pc(p.x.mul(1.8).add(t.mul(.6)))).add(pc(p.z.mul(1.3).sub(t.mul(.4)))));
    return dynamicSurface(streams,[.18,.035,.005],[1,.72,.12],.24,.72,.24);
  }},
  {name:'ripple rings',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const radius=RC(p.xz);
    const ring=dynamicWave(radius.mul(3).sub(t.mul(1.6)).add(p.y.mul(.7)).add(dynamicAttack.mul(.4)));
    return dynamicSurface(cl(.35,.8,ring),[.015,.07,.16],[.2,.65,1],.32,.38,.22);
  }},
  {name:'aurora weave',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const curtain=dynamicWave(p.x.mul(1.7).add(pc(p.y.mul(.8).add(t.mul(.6))).mul(2)).add(t.mul(.4)));
    const drift=dynamicWave(p.z.mul(1.5).sub(t.mul(.35)));
    return dynamicSurface(curtain.mul(.7).add(drift.mul(.3)),[.14,.015,.3],[.15,1,.62],.4,.2,.3);
  }},
  {name:'electric filaments',make:()=>{
    const p=ot.mul(dynamicScale),t=dynamicClock;
    const path=dynamicWave(p.y.mul(3).add(pc(p.x.mul(2).sub(t)).mul(2)).add(pc(p.z.mul(2).add(t.mul(.7)))));
    const filament=cl(.72,.96,path);
    return dynamicSurface(filament,[.025,.018,.08],[.6,.55,1],.35,.25,.5);
  }}
];
I_.push(...dynamicMaterialEntries);
