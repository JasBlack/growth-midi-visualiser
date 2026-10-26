"""Build v0.19.0 from verified v0.18.0. Output must be separate."""
from pathlib import Path
import hashlib, shutil, sys

def once(text, old, new):
    count=text.count(old)
    if count != 1: raise ValueError(f'Expected one match ({count}): {old[:100]}')
    return text.replace(old,new,1)

def main():
    source,output=map(Path,sys.argv[1:3]);here=Path(__file__).resolve().parent
    if source.resolve()==output.resolve(): raise ValueError('Use a separate output directory')
    if not output.exists(): shutil.copytree(source,output)
    if here.resolve()!=(output/'maintenance').resolve(): shutil.copytree(here,output/'maintenance',dirs_exist_ok=True)
    asset='assets/index-BWYXfAkm.js';original=(source/asset).read_text()
    if hashlib.sha256(original.encode()).hexdigest()!='3593b73a28ac47a8d99ef7c3bd732f80b0082b0b3483fa28432bd3f2d07e2fd5': raise ValueError('Expected verified v0.18.0 bundle')
    code=once(original,'const LM="0.18.0"','const LM="0.19.0"')
    camera=(here/'calm-camera.js').read_text()
    music=(source/'maintenance/music-focus.js').read_text()
    code=once(code,music,music+'\n'+camera)
    code=once(code,'{key:"camMode",label:"camera",','{key:"calmCamera",label:"stable presentation camera",min:0,max:1,step:1,value:1},{key:"camMode",label:"camera",')
    code=once(code,'const Ls=G(this.controls,"camMode");if(!this.cameraLockPose){',
      'const Ls=G(this.controls,"camMode"),calm=G(this.controls,"calmCamera")>0;if(!this.cameraLockPose){')
    code=once(code,'const Pl=Math.sqrt(ab),C5=1+.03*e.energy+.05*e.onset,xa=',
      'const Pl=Math.sqrt(ab),C5=calm?1:1+.03*e.energy+.05*e.onset,xa=')
    code=once(code,'const ge=this.theta+this.manTheta+t.rotNow*.5+Math.sin(n*.37)*.04,ne=Math.max(-1.4,Math.min(1.4,.3+.25*Math.sin(n*.11)+this.manPhi)),Pe=',
      'const ge=this.theta+this.manTheta+t.rotNow*.5+(calm?0:Math.sin(n*.37)*.04),ne=Math.max(-1.4,Math.min(1.4,.3+(calm?0:.25*Math.sin(n*.11))+this.manPhi)),Pe=')
    code=once(code,'const q=G(this.controls,"react"),ge=G(this.controls,"kick")*q,ne=G(this.controls,"shake")*q;',
      'const q=G(this.controls,"react")*(calm?0:1),ge=G(this.controls,"kick")*q,ne=G(this.controls,"shake")*q;')
    fog='this.scene.fog.density=(Ls===0||Ls>=6?.55/(this.camPos.distanceTo(this.center)+(this.focusCameraExtent??2)+4):.05)*(1+.8*this.sustain*Tu)*(G(this.controls,"env")===2?1.6:1)'
    code=once(code,fog,'this.scene.fog.density=calm?.002:'+fog.split('=',1)[1])
    audio_old='const x=[...this.fluxHist].sort((w,S)=>w-S),T=(x[x.length>>1]??0)*1.9+.001;let v=0;if(f>T&&t-this.lastOnsetT>.12&&this.features.energy>.04&&'
    audio_new='const x=[...this.fluxHist].sort((w,S)=>w-S),sensitivity=globalThis.__growthAudioSensitivity??.45,T=(x[x.length>>1]??0)*(2.55-1.45*sensitivity)+.0015;let v=0;if(f>T&&t-this.lastOnsetT>.18-.1*sensitivity&&this.features.energy>.055-.025*sensitivity&&'
    code=once(code,audio_old,audio_new)
    # A reference starts in depth+edge trace mode, but remains music-led.
    code=once(code,"referenceSet('videoMode',4);referenceSet('videoStick',1);",
      "referenceSet('videoMode',3);referenceSet('videoStick',1);")
    ref=(source/'maintenance/reference-ui.js').read_text()
    (output/'maintenance/reference-ui.js').write_text(ref.replace("referenceSet('videoMode',4);", "referenceSet('videoMode',3);"))
    code+='\n'+(here/'simple-ui.js').read_text()

    style='''<style id="simpleUiStyle">
body.simple-ui #controlSearch,body.simple-ui #searchHelp,body.simple-ui #camCycle,
body.simple-ui #sec-specialist-motion,body.simple-ui #sec-specialist-materials,
body.simple-ui #sec-pattern,body.simple-ui #engineControls,body.simple-ui #sec-fluid,
body.simple-ui #sec-global,body.simple-ui #sec-presets,body.simple-ui #sec-play,
body.simple-ui #sec-output,body.simple-ui #sec-keys,body.simple-ui #referenceTools,
body.simple-ui #stemsRow{display:none!important}
#uiMode{margin-left:auto}#simpleHome .look-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
#simpleHome .look-grid button{min-width:0}#simpleHome .look-grid button.active{background:#285440;border-color:#84dbad}
#simpleHome h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8d98a8;margin:12px 0 6px}
#simpleHome .intent-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px}
body.simple-ui #panel{width:340px}body.simple-ui #sec-input>summary{font-size:12px;color:#9da7b8}
body.simple-ui #sec-input .note{font-size:11px}body.simple-ui #simpleHome{display:block}
@media(max-width:600px){body.simple-ui #panel{width:calc(100% - 16px)}}
</style>'''
    card='''<details class="sec" id="simpleHome" open><summary>Make something</summary><div class="body">
<button id="simpleSurprise" class="primary" type="button">✨ Surprise me — coherent look</button><span id="simpleLookName" class="note">Roots</span>
<h3>Look</h3><div class="look-grid">
<button type="button" data-simple-look="roots">Roots</button><button type="button" data-simple-look="coral">Coral</button><button type="button" data-simple-look="neural">Neural</button>
<button type="button" data-simple-look="crystal">Crystal</button><button type="button" data-simple-look="liquid">Liquid</button><button type="button" data-simple-look="silk">Silk</button></div>
<h3>Response</h3><label class="slider" for="simpleGrowth"><span>How much the music grows</span><output id="simpleGrowthValue">0.42</output><input id="simpleGrowth" type="range" min="0.1" max="1.2" step="0.05" value="0.42"></label>
<label class="slider" for="simpleDetail"><span>Branching detail</span><output id="simpleDetailValue">0.60</output><input id="simpleDetail" type="range" min="0" max="1" step="0.05" value="0.6"></label>
<label class="slider" for="simpleAudio"><span>Audio attack sensitivity</span><output id="simpleAudioValue">0.45</output><input id="simpleAudio" type="range" min="0" max="1" step="0.05" value="0.45"></label>
<h3>Camera</h3><label>Movement <select id="simpleCamera"><option value="still">Still — growth moves</option><option value="gentle">Very slow orbit</option><option value="manual">Manual only</option></select></label>
<h3>Draw a source</h3><div class="intent-grid"><button id="simpleTrace" type="button">Trace details</button><button id="simpleRelief" type="button">Grow over relief</button><button id="simpleModel" type="button">Skin 3D model</button><button id="simpleFree" type="button">Music only</button></div>
<label>Load 3D model <input id="simpleModelFile" type="file" accept=".glb,.gltf,.obj,.stl"></label><p id="simpleModelStatus" class="note">GLB is best; OBJ and STL geometry also work.</p>
<div class="row"><button id="simpleReferenceVisible" type="button">Show / hide source</button><button id="simpleFit" type="button">Fit source</button></div>
<p class="note">Load a picture, video, camera or model in Input below. Music starts and extends strands; automatic background filling stays off.</p>
</div></details>'''
    def html_changes(html):
      html=once(html,'</head>',style+'</head>')
      html=once(html,'<button id="hideUi" title="F2">hide UI</button>','<button id="hideUi" title="F2">hide UI</button><button id="uiMode" type="button" aria-pressed="false">Advanced controls</button>')
      html=once(html,'<!-- 1. where the music comes from -->',card+'<!-- 1. where the music comes from -->')
      html=once(html,'<details class="sec" open><summary>Screen bounce &amp; tip shapes</summary>','<details class="sec" id="sec-specialist-motion"><summary>Screen bounce &amp; tip shapes</summary>')
      html=once(html,'<details class="sec" open><summary>Animated materials</summary>','<details class="sec" id="sec-specialist-materials"><summary>Animated materials</summary>')
      html=html.replace('<summary>Presets <span class="hint">','<summary>Saved slots <span class="hint">',1)
      html=html.replace('🎲 random mix','✨ curated surprise',1)
      return html
    (output/asset).write_text(code)
    (output/'index.html').write_text(html_changes((source/'index.html').read_text()))
    inline=once((source/'growth-visualiser-v0.18.0.html').read_text(),original,code)
    (output/'growth-visualiser-v0.19.0.html').write_text(html_changes(inline))
    (output/'growth-visualiser-v0.18.0.html').unlink(missing_ok=True)
    for name in ['README.txt','start-mac.command','start-windows.cmd','maintenance/validate.py']:
      file=output/name;file.write_text(file.read_text().replace('0.18.0','0.19.0'))
    (output/'start-mac.command').chmod(0o755)
    print('Built v0.19.0 consolidation UI and calm camera')

if __name__=='__main__':main()
