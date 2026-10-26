"""Build v0.17.3 from v0.17.2, using a separate output folder."""
from pathlib import Path
import sys,shutil,hashlib

def once(s,a,b):
 if s.count(a)!=1:raise ValueError(f'Expected one match ({s.count(a)}): {a[:90]}')
 return s.replace(a,b,1)
def main():
 src,out=map(Path,sys.argv[1:3]);here=Path(__file__).resolve().parent
 if src.resolve()==out.resolve():raise ValueError('Separate output required')
 if not out.exists():shutil.copytree(src,out)
 if here.resolve()!=(out/'maintenance').resolve():shutil.copytree(here,out/'maintenance',dirs_exist_ok=True)
 original=(src/'assets/index-BWYXfAkm.js').read_text()
 assert hashlib.sha256(original.encode()).hexdigest()=='8d746408f830270af355952ebc2f4263ddfd8c352446ad32ec3497e88b6c804a'
 s=once(original,'const LM="0.17.2"','const LM="0.17.3"')
 s=once(s,'function _j(i){', (here/'dynamic-materials.js').read_text()+'\nfunction _j(i){')
 s=once(s,(src/'maintenance/music-focus.js').read_text(),(src/'maintenance/music-focus.js').read_text()+'\n'+(here/'dynamic-material-runtime.js').read_text())
 s=once(s,'this.performanceState=e;','this.performanceState=e;this.updateDynamicMaterials(e);')
 s=once(s,'{key:"shader",','{key:"materialSpeed",label:"new materials: motion speed",min:0,max:3,step:.05,value:.8},{key:"materialScale",label:"new materials: pattern scale",min:.25,max:3,step:.05,value:1},{key:"materialReact",label:"new materials: audio response",min:0,max:2,step:.05,value:1},{key:"shader",')
 soft=(src/'maintenance/soft-growth.js').read_text()
 new=soft.replace('this.group.remove(item.mesh);item.mesh.geometry.dispose();item.mesh.material.dispose();','this.disposeSoftItem(item);')
 new=new.replace('if(state.time-item.last<1/30)continue;', 'this.syncSoftMaterial(plant,item);\n      if(state.time-item.last<1/30)continue;')
 s=once(s,soft,new);(out/'maintenance/soft-growth.js').write_text(new)
 s+='\n'+(here/'dynamic-material-ui.js').read_text()
 def html(h):
  card='<details class="sec" open><summary>Animated materials</summary><div class="row"><select id="dynamicMaterial" aria-label="Growth material" style="flex:1;min-width:0"></select><button id="dynamicNext" type="button">Next new</button></div>'
  for key,label,mn,mx,step,value in [('materialSpeed','Motion speed',0,3,.05,.8),('materialScale','Pattern scale',.25,3,.05,1),('materialReact','Audio response',0,2,.05,1)]:
   card+=f'<label class="slider" for="{key}"><span>{label}</span><output id="{key}Value">{value}</output><input id="{key}" type="range" min="{mn}" max="{mx}" step="{step}" value="{value}"></label>'
  card+='<p class="note">Next new explores ten animated surfaces, including on soft species. These three controls affect the new materials. Set motion and audio response to 0 for a still surface.</p></details>'
  # Place after the pinned header, before the original first settings section.
  mark='<details class="sec"'
  i=h.index(mark)
  return h[:i]+card+h[i:]
 (out/'assets/index-BWYXfAkm.js').write_text(s)
 (out/'index.html').write_text(html((src/'index.html').read_text()))
 (out/'growth-visualiser-v0.17.3.html').write_text(html(once((src/'growth-visualiser-v0.17.2.html').read_text(),original,s)))
 (out/'growth-visualiser-v0.17.2.html').unlink(missing_ok=True)
 for name in ['README.txt','start-mac.command','start-windows.cmd','maintenance/validate.py']:
  p=out/name;p.write_text(p.read_text().replace('0.17.2','0.17.3'))
 print('Built v0.17.3: ten animated GPU materials')
if __name__=='__main__':main()
