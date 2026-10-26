// Ten additional deforming species. All use one small, reusable parametric mesh.
const extraSoftSpecies=[
 ['jelly bell','🪼','jelly',.14],['kelp frond','🌿','kelp',.28],['manta sail','🪽','manta',.43],
 ['spiral streamer','🌀','spiral',.56],['breathing torus','⭕','torus',.7],['wave tube','🪈','tube',.82],
 ['anemone fan','🪸','fan',.06],['pleated silk','🪭','pleats',.36],['liquid droplet','💧','droplet',.62],
 ['ripple disc','💿','disc',.92]
];
for(const [name,icon,soft,hue] of extraSoftSpecies){
 js.push({...js[1],name,icon,soft,hue,skin:'smooth',node:'none',nodeScale:0,
  segLen:.24,thickness:.65,taper:.998,branch:.025,branchTaper:.92,branchAngle:[.12,.35],
  wiggle:.3,gravity:0,radial:0,maxTips:3,maxDepth:140,speed:.75,avoid:.1,join:.15,glow:0,turn:'smooth'});
}
// Write into a reused array; no per-vertex object allocation.
function softFormXYZ(kind,u,v,size,time,phase,wave,energy,out){
 const a=(u+.5)*Math.PI*2,b=v+.5,t=time+phase,amp=wave*(.15+energy*.4);
 let x=0,y=0,z=0,r;
 switch(kind){
  case 'jelly': {
   const lat=b*Math.PI*.52;r=Math.sin(lat)*(.65+.07*Math.sin(t*1.2));
   x=Math.cos(a)*r;y=Math.cos(lat)*.7;z=Math.sin(a)*r;
   y+=Math.pow(b,4)*amp*Math.sin(a*6-t)*.3;break;
  }
  case 'kelp': x=u*(.35+.6*b)*Math.sin(Math.PI*b);y=b*2;z=amp*Math.sin(b*7-t)+u*.3*Math.cos(t+b*4);break;
  case 'manta': x=u*2;y=v*.8+Math.abs(u)*.3;z=amp*Math.sin(Math.abs(u)*5-t)*(.3+Math.abs(u)*2)+v*v*.4;break;
  case 'spiral': {const angle=b*Math.PI*4+t*.25;r=.35+u*.22;x=Math.cos(angle)*r;y=b*1.8;z=Math.sin(angle)*r+amp*.15*Math.sin(a+t);break;}
  case 'torus': {const tube=.18*(1+amp*.3*Math.sin(t+b*6.283));const q=b*Math.PI*2;r=.6+tube*Math.cos(q);x=r*Math.cos(a);y=tube*Math.sin(q);z=r*Math.sin(a);break;}
  case 'tube': {r=.25+amp*.08*Math.sin(b*8-t);x=r*Math.cos(a)+amp*.3*Math.sin(b*5-t);y=b*1.8;z=r*Math.sin(a)+amp*.15*Math.cos(b*4-t);break;}
  case 'fan': {const angle=u*Math.PI*1.5;r=b*.95;x=Math.sin(angle)*r;y=Math.cos(angle)*r;z=amp*b*Math.sin(angle*6-t)*.4;break;}
  case 'pleats': x=u*1.6;y=v*1.3;z=(.06+amp*.25)*Math.sin(u*25+t*.6)+amp*.2*Math.sin(v*6-t);break;
  case 'droplet': {const lat=b*Math.PI;r=Math.sin(lat)*(.5-.25*Math.cos(lat));x=r*Math.cos(a);y=Math.cos(lat)*.9;z=r*Math.sin(a);x+=amp*.12*Math.sin(lat*2-t)*Math.sin(lat);break;}
  case 'disc': r=b*.85;x=r*Math.cos(a);y=r*Math.sin(a);z=amp*.3*Math.sin(r*12-t*1.4)*b;break;
 }
 out[0]=x*size;out[1]=y*size;out[2]=z*size;
}
