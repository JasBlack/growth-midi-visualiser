"""Build v0.17.2 from verified v0.17.1 distribution; use separate directories."""
from pathlib import Path
import sys,hashlib,shutil

def once(s,a,b):
 if s.count(a)!=1: raise ValueError(f'Expected exactly one match ({s.count(a)}): {a[:100]}')
 return s.replace(a,b,1)

def main():
 src,out=map(Path,sys.argv[1:3]);here=Path(__file__).resolve().parent
 if src.resolve()==out.resolve():raise ValueError('Separate output required')
 if not out.exists():shutil.copytree(src,out)
 if here.resolve()!=(out/'maintenance').resolve():shutil.copytree(here,out/'maintenance',dirs_exist_ok=True)
 original=(src/'assets/index-BWYXfAkm.js').read_text()
 assert hashlib.sha256(original.encode()).hexdigest()=='b9067159de802144c3bedacab3c18b3ecea243ef75be1799ab66b674a726cb91'
 s=original
 s=once(s,'const LM="0.17.1"','const LM="0.17.2"')
 controls='''{key:"musicAmount",label:"music growth amount",min:.1,max:1.5,step:.05,value:.45},{key:"musicFocus",label:"highlight music / dim old growth",min:0,max:1,step:.05,value:.8},{key:"musicTrail",label:"fresh growth trail (seconds)",min:.5,max:8,step:.5,value:2},{key:"videoBuildPace",label:"background starts per second",min:.2,max:3,step:.1,value:.8},'''
 s=once(s,'{key:"videoScatter",',controls+'{key:"videoScatter",')
 s=once(s,'min:0,max:10,step:.1,value:1.5},{key:"fillRate"','min:0,max:10,step:.1,value:.25},{key:"fillRate"')
 s=once(s,'min:0,max:8e3,step:100,value:1500','min:0,max:8e3,step:100,value:300')
 s=once(s,"referenceSet('videoFollow',1);referenceSet('videoBuild',1);","referenceSet('videoFollow',1);referenceSet('videoBuild',0);")
 s=once(s,"'Filling the shape. Music can add more growth; Reset starts it again.'","'Background fill is on: it grows without music. Turn Build shape off for music-only growth.'")
 s=once(s,"'Play notes to grow into the reference, or enable Build shape.'","'Music-led: play notes or audio to grow. Build shape adds independent background growth.'")
 ref=(src/'maintenance/reference-growth.js').read_text()
 new=ref.replace('Math.min(16,G(this.controls,\'maxLive\'))','Math.min(4,G(this.controls,\'maxLive\'))').replace("if(time-(this.referenceSeedT??-Infinity)<.16)return;","if(this.referenceSeedT==null||!Number.isFinite(this.referenceSeedT)){this.referenceSeedT=time;return;}\n    if(time-this.referenceSeedT<1/Math.max(.2,G(this.controls,'videoBuildPace')||.8))return;").replace('time+5','time+2').replace('this.referenceSeedT=-Infinity','this.referenceSeedT=null')
 new=new.replace("const follow=G(this.controls,'videoFollow')>0;", """const follow=G(this.controls,'videoFollow')>0;
    if(follow&&((this.field.isStill&&this.referenceRevision!==this.field.revision)||!this.referenceWasFollowing)){
      this.referenceRevision=this.field.revision;this.referenceResizePending=true;this.referenceCursor=0;
    }
    this.referenceWasFollowing=follow;""")
 new=new.replace("G(this.controls,'videoInvert')].join(':')","G(this.controls,'videoInvert'),this.field.request].join(':')")
 new=new.replace('(follow||this.referenceResizePending)', '((follow&&!this.field.isStill)||this.referenceResizePending)')
 new=new.replace('let cursor=this.referenceCursor||0;', 'let cursor=this.referenceCursor||0,completed=false;')
 new=new.replace('if(cursor>=count)cursor=0;', 'if(cursor>=count){cursor=0;completed=true;if(this.referenceResizePending)break;}')
 new=new.replace('if(cursor>=count)this.referenceResizePending=false;', 'if(cursor>=count||completed)this.referenceResizePending=false;')
 s=once(s,ref,new+'\n'+(here/'music-focus.js').read_text())
 (out/'maintenance/reference-growth.js').write_text(new)
 s=once(s,'m=1-.7*Math.min(1,Math.max(0,(p-.6)/.35))','m=1')
 s=once(s,'let x=g>0?Math.max(1,g*s):1/0;','let x=this.segmentAllowance(g,s);')
 s=once(s,'const ge=r*m*this.seasonF.speed','const ge=G(this.controls,"musicAmount")*r*m*this.seasonF.speed')
 s=once(s,'const _=e.active.size===0;','if(g>0)this.musicCredit=Math.max(0,this.musicCredit-(Math.floor(this.musicCredit)-x));const _=e.active.size===0;')
 # Camera simulation is skipped while locked, including tunnel culling and gesture movement.
 s=once(s,'const Ls=G(this.controls,"camMode"),ya=','const Ls=G(this.controls,"camMode");if(!this.cameraLockPose){const ya=')
 s=once(s,'this.camera.lookAt(this.camLook);const Tu=','this.camera.lookAt(this.camLook);}else this.applyCameraLock();const Tu=')
 s=once(s,'if(this.dragBtn<0)return;','if(this.cameraLockPose||this.dragBtn<0)return;')
 s=once(s,'"pointerdown",l=>{if(!(l.button','"pointerdown",l=>{if(this.cameraLockPose)return;if(!(l.button')
 s=once(s,'"wheel",l=>{this.zoomMul','"wheel",l=>{if(this.cameraLockPose){l.preventDefault();return;}this.zoomMul')
 # Retain the calculated extent when the locked camera skips automatic framing.
 s=once(s,'this.updateCinematic(e,t);','this.focusCameraExtent=Pl;this.updateCinematic(e,t);')
 s=once(s,'this.camPos.distanceTo(this.center)+Pl+4','this.camPos.distanceTo(this.center)+(this.focusCameraExtent??2)+4')
 s=once(s,'draw(){this.updateSoftGrowth(this.performanceState);','draw(){this.refreshMusicFocus();this.updateSoftGrowth(this.performanceState);')
 s=once(s,'q.sp.glow<=0','(q.sp.glow<=0&&G(this.controls,"musicFocus")<=0)||(q.referenceAuto&&G(this.controls,"musicFocus")>0)')
 s=once(s,'Pe=ge.r*(1.5+.8*e.onset)*Dt*q.sp.glow','Pe=Math.max(ge.r*(1.5+.8*e.onset)*Dt*Math.max(q.sp.glow,G(this.controls,"musicFocus")),G(this.controls,"musicFocus")>0?Math.min(.5,Math.max(.06,this.camPos.distanceTo(this.camLook)*.0025)):0)')
 s=once(s,'this.tmpColor.copy(q.color).multiplyScalar(1.6).addScalar(.35)','this.tmpColor.copy(q.color).lerp(new Se(.4,1,1),G(this.controls,"musicFocus")*.8).multiplyScalar(1.6).addScalar(.35)')
 soft=(src/'maintenance/soft-growth.js').read_text()
 newsoft=soft.replace('item.mesh.material.color?.copy(plant.color);',"item.mesh.material.color?.copy(plant.color).multiplyScalar(this.focusLevel(plant.segs[plant.segs.length-1]||{plant,born:plant.birth}));")
 s=once(s,soft,newsoft);(out/'maintenance/soft-growth.js').write_text(newsoft)
 s+='\n'+(here/'music-focus-ui.js').read_text()
 def html(h):
  h=once(h,'</body>','<button id="cameraLock" type="button" aria-pressed="false">🔓 Lock camera</button></body>')
  h=once(h,'</head>','<style>#cameraLock{position:fixed;top:12px;right:12px;z-index:1000;cursor:pointer;background:#171d26;border:1px solid #7799aa;padding:9px 12px;border-radius:8px;color:#eefaff}#cameraLock[aria-pressed="true"]{background:#254c40;border-color:#8cdeb7}</style></head>')
  panel='<section aria-label="Music growth"><h3>Music growth</h3><button id="musicLed" type="button">♪ Music-led settings</button>'
  for key,label,mn,mx,step,value in [('musicAmount','Growth amount',.1,1.5,.05,.45),('musicFocus','Highlight new / dim old',0,1,.05,.8),('musicTrail','Fresh trail (seconds)',.5,8,.5,2),('buildPace','Background starts / second',.2,3,.1,.8)]:
   panel+=f'<label class="slider" for="{key}"><span>{label}</span><output id="{key}Value">{value}</output><input id="{key}" type="range" min="{mn}" max="{mx}" step="{step}" value="{value}"></label>'
  panel+='<p class="note">Music-led settings switches background fill off. Cyan tips mark musical growth, even behind the older structure. Highlight 0 restores normal colours and depth.</p></section>'
  return once(h,'<p id="refHint" class="note"></p>','<p id="refHint" class="note"></p>'+panel)
 (out/'assets/index-BWYXfAkm.js').write_text(s)
 (out/'index.html').write_text(html((src/'index.html').read_text()))
 (out/'growth-visualiser-v0.17.2.html').write_text(html(once((src/'growth-visualiser-v0.17.1.html').read_text(),original,s)))
 (out/'growth-visualiser-v0.17.1.html').unlink(missing_ok=True)
 for name in ['README.txt','start-mac.command','start-windows.cmd','maintenance/validate.py']:
  p=out/name;p.write_text(p.read_text().replace('0.17.1','0.17.2'))
 print('Built v0.17.2')
if __name__=='__main__':main()
