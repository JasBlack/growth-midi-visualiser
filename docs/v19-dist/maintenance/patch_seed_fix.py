"""Repair v0.17.0 reference endpoint anchors and distribute new strands.
Usage: python patch_seed_fix.py /path/to/v0170 /path/to/output
"""
from pathlib import Path
import hashlib
import shutil
import sys

def once(text,old,new):
    if text.count(old)!=1:raise ValueError(f'Expected one match: {old[:100]}')
    return text.replace(old,new,1)

def main():
    source,output=map(Path,sys.argv[1:3]);here=Path(__file__).resolve().parent
    if source.resolve()==output.resolve():raise ValueError('Use a separate output directory')
    asset='assets/index-BWYXfAkm.js';original=(source/asset).read_text()
    if hashlib.sha256(original.encode()).hexdigest()!='fb0a737a9ebf971f52d1c6a52e711b4686e6aa5d9461037749ee9a7815998414':raise ValueError('Expected unchanged v0.17.0 bundle')
    code=original
    for name in ['reference-field.js','reference-growth.js']:
        code=once(code,(source/'maintenance'/name).read_text(),(here/name).read_text())
    code=once(code,'const LM="0.17.0"','const LM="0.17.1"')
    code=once(code,'{key:"videoBuild",','{key:"videoScatter",label:"new strand spread (0 = favour details, 1 = anywhere)",group:"Video",min:0,max:1,step:.05,value:.7},{key:"videoBuild",')
    code=once(code,"[['refSize','videoSize',22],['refDepth','videoDepth',8]]","[['refSize','videoSize',22],['refDepth','videoDepth',8],['refScatter','videoScatter',.7]]")
    code+="\nY('refScatter').oninput=event=>referenceSet('videoScatter',+event.target.value);\n"
    def html_changes(html):
        mark='<p id="refHint" class="note"></p>'
        extra='<label class="slider" for="refScatter"><span>New strand spread</span><output id="refScatterValue" for="refScatter">0.7</output><input id="refScatter" type="range" min="0" max="1" step="0.05" value="0.7"></label><p class="note">Higher spread starts strands anywhere; lower spread favours image details.</p>'
        return once(html,mark,extra+mark)
    output.mkdir(parents=True,exist_ok=True)
    for file in source.rglob('*'):
        if file.is_file() and 'maintenance' not in file.relative_to(source).parts:
            dest=output/file.relative_to(source);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,dest)
    (output/asset).write_text(code)
    (output/'index.html').write_text(html_changes((source/'index.html').read_text()))
    inline=once((source/'growth-visualiser-v0.17.0.html').read_text(),original,code)
    (output/'growth-visualiser-v0.17.1.html').write_text(html_changes(inline))
    (output/'growth-visualiser-v0.17.0.html').unlink(missing_ok=True)
    for name in ['README.txt','start-mac.command','start-windows.cmd']:
        file=output/name;file.write_text(file.read_text().replace('0.17.0','0.17.1'))
    (output/'start-mac.command').chmod(0o755)
    print('Built v0.17.1 with corrected reference anchors and distributed seeds')

if __name__=='__main__':main()
