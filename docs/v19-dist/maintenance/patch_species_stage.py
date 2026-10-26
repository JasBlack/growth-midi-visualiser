"""Build v0.18.0 from v0.17.3; use a separate output directory."""
from pathlib import Path
import sys,shutil,hashlib

def once(s,a,b):
 if s.count(a)!=1:raise ValueError(f'Expected exactly one match ({s.count(a)}): {a[:100]}')
 return s.replace(a,b,1)
def main():
 src,out=map(Path,sys.argv[1:3]);here=Path(__file__).resolve().parent
 if src.resolve()==out.resolve():raise ValueError('Separate output required')
 if not out.exists():shutil.copytree(src,out)
 if here.resolve()!=(out/'maintenance').resolve():shutil.copytree(here,out/'maintenance',dirs_exist_ok=True)
 original=(src/'assets/index-BWYXfAkm.js').read_text()
 assert hashlib.sha256(original.encode()).hexdigest()=='3d04730e7196b7df66581e89c668a575f72cf3f9ec18590021356e755f3aca3a'
 s=once(original,'const LM="0.17.3"','const LM="0.18.0"')
 for name in ['recorder-native.js','recording-ui.js']:
  s=once(s,(src/'maintenance'/name).read_text(),(here/name).read_text())
 soft=(here/'soft-growth.js').read_text()
 soft=once(soft,'Object.assign(tw.prototype,{',(here/'soft-species-extra.js').read_text()+'\nObject.assign(tw.prototype,{')
 s=once(s,(src/'maintenance/soft-growth.js').read_text(),soft)
 extra=(here/'stage-motion.js').read_text()+'\n'+(here/'tip-shapes.js').read_text()+'''
const stageDraw=tw.prototype.draw;
tw.prototype.draw=function(){
 if(!this.camera||!this.renderer)return stageDraw.call(this);
 const original=this.beginScreenBounce();
 try{return stageDraw.call(this);}finally{this.endScreenBounce(original);}
};
'''
 s=once(s,(src/'maintenance/dynamic-material-runtime.js').read_text(),(src/'maintenance/dynamic-material-runtime.js').read_text()+'\n'+extra)
 controls='''{key:"screenBounce",label:"bounce sculpture around screen",min:0,max:1,step:1,value:0},{key:"bounceSpeed",label:"screen bounce speed",min:0,max:.5,step:.01,value:.08},{key:"bounceSize",label:"bouncing sculpture screen size",min:.2,max:.85,step:.05,value:.55},{key:"tipShape",label:"tip marker shape",min:0,max:10,step:1,value:0,options:tipShapeNames},{key:"tipSize",label:"tip marker size",min:.1,max:3,step:.1,value:1},{key:"tipBrightness",label:"tip marker brightness",min:0,max:2,step:.05,value:1},{key:"tipLimit",label:"visible tip limit",min:32,max:512,step:32,value:256},'''
 s=once(s,'{key:"glow",label:"tip glow",min:0,max:2,step:.05,value:1},{key:"budget",',controls+'{key:"glow",label:"tip glow",min:0,max:2,step:.05,value:1},{key:"budget",')
 s=once(s,'const Dt=G(this.controls,"glow");','this.syncTipShape();const Dt=G(this.controls,"glow");')
 s=once(s,'if(Hs>=XC)break;','if(Hs>=Math.min(XC,G(this.controls,"tipLimit"),G(this.controls,"tipShape")===10?128:512))break;')
 s=once(s,'this.dummy.position.copy(ne),this.dummy.quaternion.identity(),this.dummy.scale.set(Pe,Pe,Pe)', 'this.dummy.position.copy(ne),this.orientTip(),this.dummy.scale.set(Pe*G(this.controls,"tipSize"),Pe*G(this.controls,"tipSize"),Pe*G(this.controls,"tipSize"))')
 s=once(s,'.multiplyScalar(1.6).addScalar(.35)),Hs++','.multiplyScalar(1.6).addScalar(.35).multiplyScalar(G(this.controls,"tipBrightness"))),Hs++')
 s=once(s,'this.tipMesh.setColorAt(Hs,this.tmpColor.copy(q.color)', 'this.tipMesh.setColorAt(Hs,G(this.controls,"tipShape")===9?this.tmpColor.setRGB(1,1,1).multiplyScalar(G(this.controls,"tipBrightness")):this.tmpColor.copy(q.color)')
 s=once(s,'Capture uses browser-synchronised audio/video. If MP4 capture is unavailable, the take is saved as WebM.','MP4 editor compatibility requests H.264 + AAC explicitly. If unavailable, turn compatibility off and convert the recording using the supplied helper.')
 s+='\n'+(here/'extra-controls.js').read_text()
 def html(h):
  card='<details class="sec" open><summary>Screen bounce &amp; tip shapes</summary><button type="button" id="screenBounceToggle" aria-pressed="false">Bounce around screen</button>'
  for key,label,mn,mx,step,value in [('bounceSpeed','Bounce speed',0,.5,.01,.08),('bounceSize','Sculpture screen size',.2,.85,.05,.55),('tipSize','Marker size',.1,3,.1,1),('tipBrightness','Marker brightness',0,2,.05,1),('tipLimit','Visible marker limit',32,512,32,256)]:
   card+=f'<label class="slider" for="{key}"><span>{label}</span><output id="{key}Value">{value}</output><input id="{key}" type="range" min="{mn}" max="{mx}" step="{step}" value="{value}"></label>'
  card+='<label>Tip shape <select id="tipShapeSelect"></select></label><label>Custom marker <input id="tipFile" type="file" accept=".png,.webp,.jpg,.jpeg,.obj"></label><p id="tipUploadStatus" class="note">Transparent PNG/WebP = flat icon. OBJ = solid 3D shape, up to 2,048 triangles. Images use a square 256 px tile. Uploads last for this session.</p><p class="note">Bounce moves the whole sculpture in the view, including in recordings. Lock the camera for a steady DVD-style path. Screen size leaves space to travel.</p></details>'
  i=h.index('<details class="sec"');h=h[:i]+card+h[i:]
  mark='<div id="recFormatNote"'
  if mark not in h:mark='<p id="recFormatNote"'
  i=h.index(mark)
  rec='<div class="row"><button id="recEditor" type="button">Editor MP4 settings</button><button id="recReport" type="button">Recording report</button></div><label><input id="recCompat" type="checkbox" checked> MP4 editor compatibility (H.264 + AAC)</label><p class="note">This requests explicit codecs; it does not guarantee import into every editor. The ZIP includes a Resolve conversion helper for existing recordings.</p>'
  return h[:i]+rec+h[i:]
 (out/'assets/index-BWYXfAkm.js').write_text(s)
 (out/'index.html').write_text(html((src/'index.html').read_text()))
 (out/'growth-visualiser-v0.18.0.html').write_text(html(once((src/'growth-visualiser-v0.17.3.html').read_text(),original,s)))
 (out/'growth-visualiser-v0.17.3.html').unlink(missing_ok=True)
 for name in ['README.txt','start-mac.command','start-windows.cmd','maintenance/validate.py']:
  p=out/name;p.write_text(p.read_text().replace('0.17.3','0.18.0'))
 print('Built v0.18.0')
if __name__=='__main__':main()
