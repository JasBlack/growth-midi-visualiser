"""Upgrade the unchanged v0.16.0 distribution to v0.17.0.
Usage: python patch_performance.py INPUT_DIRECTORY OUTPUT_DIRECTORY
"""
from pathlib import Path
import hashlib
import shutil
import sys

def once(text,old,new):
    if text.count(old)!=1: raise ValueError(f'Expected one fragment: {old[:100]}')
    return text.replace(old,new,1)

def main():
    source,output=map(Path,sys.argv[1:3]);maintenance=Path(__file__).resolve().parent
    if source.resolve()==output.resolve():raise ValueError('Use a separate output directory')
    asset='assets/index-BWYXfAkm.js';original=(source/asset).read_text()
    if hashlib.sha256(original.encode()).hexdigest()!='4641ab070623599cdf004a5b7f27060344d770b72d2712520a242e6e2f694e6f':raise ValueError('Expected unchanged v0.16.0 bundle')
    code=original
    start=code.index('class rZ{');end=code.index('function oZ(',start)
    code=once(code,code[start:end],(maintenance/'recorder-native.js').read_text()+'\n')
    start=code.index('async function Vw(){');end=code.index('Y("recMode").value=',start)
    code=once(code,code[start:end],(maintenance/'recording-ui.js').read_text()+'\n')
    code=once(code,'recordStream(){return Gw()}',
        'recordStream(){this.ensureCtx();if(!this.captureDestination){this.captureDestination=this.ctx.createMediaStreamDestination();this.analyser.connect(this.captureDestination)}return this.captureDestination.stream}')
    code=once(code,'if(this.dragX=l.clientX,this.dragY=l.clientY,this.dragBtn===1)',
        'if(this.dragX=l.clientX,this.dragY=l.clientY,this.dragBtn===1&&!l.shiftKey)')
    code=once(code,'f=this.dist*.0012;this.pan.addScaledVector(d,-c*f).addScaledVector(Pa,u*f)',
        'f=this.camPos.distanceTo(this.camLook)*.0012;const panUp=new A().crossVectors(d,h).normalize();this.pan.addScaledVector(d,-c*f).addScaledVector(panUp,u*f)')
    code=once(code,'o.addEventListener("pointercancel",a),', 'o.addEventListener("pointercancel",a),o.addEventListener("lostpointercapture",a),')
    code=once(code,'{key:"camMode",label:"camera",min:0,max:5,step:1,value:0,options:["orbit","weave through","tunnel","drift inside","sit inside","chase the newest growth"]}',
        '{key:"camMode",label:"camera",min:0,max:8,step:1,value:0,options:["orbit","weave through","tunnel","drift inside","sit inside","chase the newest growth","tip glide","cinematic tour","wide pulse"]},{key:"camDistance",label:"camera shot distance",group:"Camera",min:2,max:40,step:.5,value:9},{key:"camSmooth",label:"camera tracking response",group:"Camera",min:0,max:1,step:.05,value:.35},{key:"softWave",label:"soft wave amplitude",group:"Soft motion",min:0,max:3,step:.05,value:1},{key:"softReact",label:"soft audio response",group:"Soft motion",min:0,max:3,step:.05,value:1},{key:"softSpeed",label:"soft flow speed",group:"Soft motion",min:0,max:3,step:.05,value:.8}')
    code=once(code,'label:e.name,icon:e.icon,min:0,max:1,step:1,value:1', 'label:e.name,icon:e.icon,min:0,max:1,step:1,value:e.soft?0:1')
    code=once(code,'this.lastG=t,this.lastGTime=e.time;this.updateReference(e,t);',
        'this.lastG=t,this.lastGTime=e.time;this.performanceState=e;this.updateReference(e,t);')
    code=once(code,'draw(){if(this.canvas.width<2', 'draw(){this.updateSoftGrowth(this.performanceState);if(this.canvas.width<2')
    code=once(code,'else this.theta+=s*ya*.3,xa.copy(this.center)', 'else if(Ls===4)this.theta+=s*ya*.3,xa.copy(this.center)')
    code=once(code,'this.repel=null;const Gd=this.gesture;', 'this.updateCinematic(e,t);this.repel=null;const Gd=this.gesture;')
    code=once(code,'(Ls===0?.55/(this.camPos.distanceTo(this.center)+Pl+4):.05)', '(Ls===0||Ls>=6?.55/(this.camPos.distanceTo(this.center)+Pl+4):.05)')
    code=once(code,'G(this.controls,"camMode")>0&&G(this.controls,"growAtCam")>0?T.multiplyScalar',
        'G(this.controls,"camMode")>0&&G(this.controls,"camMode")<6&&G(this.controls,"growAtCam")>0?T.multiplyScalar')
    code=once(code,'async function Fm(i){var t;if(tT)return;',
        'async function Fm(i){var t;if((hl.recording||recordingBusy)&&te?.id!==i){vs("Stop recording before switching patterns");return}if(tT)return;')
    code=once(code,'const LM="0.16.0"',
        (maintenance/'soft-growth.js').read_text()+'\n'+(maintenance/'cinematic-camera.js').read_text()+'\nconst LM="0.17.0"')
    code=once(code,'"MP4 opens in Quick Look, QuickTime, VLC, Premiere and Resolve — anywhere a MOV would."',
        '"Capture uses browser-synchronised audio/video. If MP4 capture is unavailable, the take is saved as WebM."')
    code+='\n'+(maintenance/'performance-ui.js').read_text()
    capture='''
          <div class="row"><label>audio <select id="recAudio"><option value="input">Input only (MIDI: instrument mix)</option><option value="mix">Full mix, including generated sounds</option></select></label></div>
          <div class="row"><label>resolution <select id="recResolution"><option value="1080">1080 px tall</option><option value="1440">1440 px tall</option><option value="0">Current canvas</option></select></label></div>
          <div class="row"><label>frame rate <select id="recFps"><option value="60">60 fps target</option><option value="30">30 fps target</option></select></label></div>
          <div class="row"><label>quality <select id="recQuality"><option value="24000000">High · 24 Mbps</option><option value="40000000">Maximum · 40 Mbps</option><option value="12000000">Smaller · 12 Mbps</option></select></label></div>
          <p class="note">Resolution is rendered before capture (up to 3840 px wide). Actual frame rate depends on your GPU. Input only excludes generated sounds from audio-file, microphone and tab recordings.</p>
'''
    soft='''
      <details class="sec" id="sec-fluid" open>
        <summary>Flow &amp; camera</summary><div class="body">
          <div class="row"><select id="softChoice" aria-label="Soft species"><option value="all">All soft species</option><option value="liquid">Liquid</option><option value="ribbon">Silk ribbon</option><option value="blanket">Wave blanket</option></select><button id="softOnly">Use soft species</button></div>
          <p class="note">Select, then play notes. Soft motion controls tune waves, speed and audio response. Existing species remain in Species.</p>
          <label>camera <select id="cameraPreset"><option value="0">Orbit</option><option value="6">Tip glide</option><option value="7">Cinematic tour</option><option value="8">Wide pulse</option><option value="5">Chase newest</option></select></label>
          <p class="note">Middle-drag to orbit · Shift + middle-drag to pan · wheel to zoom. C cycles camera modes.</p>
        </div>
      </details>
'''
    def html_changes(html):
        html=once(html,'<div id="recFormatNote" class="note"></div>', '<div id="recFormatNote" class="note"></div>'+capture)
        html=once(html,'<div id="engineControls"></div>','<div id="engineControls"></div>'+soft)
        html=html.replace('mouse: middle-drag orbit · right-drag pan · wheel zoom','mouse: middle-drag orbit · Shift + middle-drag or right-drag pan · wheel zoom')
        return html
    output.mkdir(parents=True,exist_ok=True)
    for file in source.rglob('*'):
        if file.is_file() and 'maintenance' not in file.relative_to(source).parts:
            dest=output/file.relative_to(source);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,dest)
    (output/asset).write_text(code)
    (output/'index.html').write_text(html_changes((source/'index.html').read_text()))
    inline=once((source/'growth-visualiser-v0.16.0.html').read_text(),original,code)
    (output/'growth-visualiser-v0.17.0.html').write_text(html_changes(inline))
    (output/'growth-visualiser-v0.16.0.html').unlink(missing_ok=True)
    for name in ['README.txt','start-mac.command','start-windows.cmd']:
        file=output/name;file.write_text(file.read_text().replace('0.16.0','0.17.0'))
    (output/'start-mac.command').chmod(0o755)
    print('Built v0.17.0 folder and standalone distribution')

if __name__=='__main__':main()
