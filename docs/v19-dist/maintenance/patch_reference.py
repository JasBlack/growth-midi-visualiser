"""Upgrade an extracted, unmodified v0.15.1 distribution to v0.16.0.
Usage: python patch_reference.py /path/to/v0151 /path/to/v0160
"""
from pathlib import Path
import hashlib
import shutil
import sys

def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'Expected exactly one fragment: {old[:100]}')
    return text.replace(old, new, 1)

def main():
    source, output = map(Path, sys.argv[1:3])
    if source.resolve() == output.resolve():
        raise ValueError('Use a separate output directory')
    maintenance = Path(__file__).resolve().parent
    asset = 'assets/index-BWYXfAkm.js'
    original = (source / asset).read_text()
    # Filled from the verified prior release; fail closed on a different bundle.
    expected = '8f1256641cea27a24e96dab38e30f503735e0a23b853cfc1a5bfa1feab78620b'
    if hashlib.sha256(original.encode()).hexdigest() != expected:
        raise ValueError('This patch needs the unchanged v0.15.1 bundle')
    code = original
    start = code.index('class aJ{')
    end = code.index('const LM=', start)
    code = once(code, code[start:end], (maintenance/'reference-field.js').read_text()+'\n'+(maintenance/'reference-growth.js').read_text()+'\n')
    code = once(code, '"0.15.1"', '"0.16.0"')
    code = once(code, 'label:"video / picture guides the growth"', 'label:"reference guides growth"')
    code = once(code, '"mimic — growth draws the picture in 3D"', '"3D shape — fill the reference relief"')
    code = once(code, '{key:"videoSize",', '{key:"videoBuild",label:"build the shape without music",group:"Video",min:0,max:1,step:1,value:0},{key:"videoFollow",label:"existing growth follows live frames",group:"Video",min:0,max:1,step:1,value:1},{key:"videoInvert",label:"invert relief depth",group:"Video",min:0,max:1,step:1,value:0},{key:"videoSize",')
    code = once(code, 'this.lastG=t,this.lastGTime=e.time;', 'this.lastG=t,this.lastGTime=e.time;this.updateReference(e,t);')
    code = once(code, 'this.field&&(this.field.update(n),this.videoOn&&!this.backdrop&&G(this.controls,"videoShow")>0&&this.rebuildBackdrop()),', '')
    code = once(code, 'this.center.lerp(Lr,1-Math.exp(-s*.8));', 'this.videoOn&&Ls===0&&Lr.set(0,0,0),this.center.lerp(Lr,1-Math.exp(-s*.8));')
    code = once(code, 'let ab=this.shell?G(this.controls,"shellSize")**2*.6:4;if(Ls!==2)',
        'let ab=this.shell?G(this.controls,"shellSize")**2*.6:4;if(this.videoOn){const refSize=this.fieldSize();ab=Math.max(4,this.referenceFrameRadius??(refSize.w**2+refSize.h**2+G(this.controls,"videoDepth")**2)/4)}if(Ls!==2&&!(this.videoOn&&Ls===0))')
    # Reference guidance wins over shell projection at birth, as it already does at each new segment.
    code = once(code, 'if(c.dir0&&(T.x+=Be()*6),this.skin&&!r.root)', 'if(c.dir0&&!this.videoOn&&(T.x+=Be()*6),this.skin&&!this.videoOn&&!r.root)')
    # Finished auto-built branches remain until Reset, recycling or budget eviction.
    code = once(code, 'let ne=c*2.2;const Pe=t.decay*this.seasonF.decay;',
        'if(!ge&&q.referenceAuto&&!q.dying&&!this.reversing)continue;let ne=c*2.2;const Pe=t.decay*this.seasonF.decay;')
    code = once(code, 'xn.active&&e&&e.set(4)}Y("videoImage")', 'xn.active&&e&&e.set(4),xn.active&&activateReference()}Y("videoImage")')
    code = once(code, 'xn.active&&e&&e.c.value===0&&e.set(3)}Y("videoFile")', 'xn.active&&e&&e.c.value===0&&e.set(4),xn.active&&activateReference()}Y("videoFile")')
    code += '\n'+(maintenance/'reference-ui.js').read_text()
    markup = '''
          <div id="referenceTools" style="border:1px solid #384b43;border-radius:8px;padding:10px;margin:10px 0">
            <strong>3D reference</strong>
            <div class="row"><button id="refEnable" type="button">Use as 3D shape</button><button id="refFit" type="button">Fit view</button></div>
            <div class="row">
              <button id="refBuild" type="button" aria-pressed="false">Build shape</button>
              <button id="refFollow" type="button" aria-pressed="true">Follow live</button>
              <button id="refVisible" type="button" aria-pressed="true">Show reference</button>
              <button id="refInvert" type="button" aria-pressed="false">Invert depth</button>
            </div>
            <label class="slider" for="refSize"><span>Size</span><output id="refSizeValue" for="refSize">22</output><input id="refSize" type="range" min="4" max="60" step="1" value="22"></label>
            <label class="slider" for="refDepth"><span>Depth</span><output id="refDepthValue" for="refDepth">8</output><input id="refDepth" type="range" min="0" max="25" step="0.5" value="8"></label>
            <p id="refHint" class="note"></p>
            <p class="note">Depth comes from image brightness. Middle-drag to orbit and see the relief.</p>
          </div>
'''
    def html_changes(html):
        needle='<div id="videoStatus" class="note">'
        start=html.index(needle);end=html.index('</div>',start)+len('</div>')
        html=html[:end]+markup+html[end:]
        html=once(html,'</style>','button:disabled {opacity:.45;cursor:default;}\n#referenceTools output {text-align:right;color:#aee6c8;}\n</style>')
        return html
    output.mkdir(parents=True,exist_ok=True)
    for file in source.rglob('*'):
        if file.is_file() and 'maintenance' not in file.relative_to(source).parts:
            dest=output/file.relative_to(source);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,dest)
    (output/asset).write_text(code)
    (output/'index.html').write_text(html_changes((source/'index.html').read_text()))
    standalone=once((source/'growth-visualiser-v0.15.1.html').read_text(),original,code)
    (output/'growth-visualiser-v0.16.0.html').write_text(html_changes(standalone))
    (output/'growth-visualiser-v0.15.1.html').unlink(missing_ok=True)
    for name in ['README.txt','start-mac.command','start-windows.cmd']:
        file=output/name;file.write_text(file.read_text().replace('0.15.1','0.16.0'))
    (output/'start-mac.command').chmod(0o755)
    print('Built v0.16.0 folder and standalone release.')

if __name__ == '__main__':
    main()
