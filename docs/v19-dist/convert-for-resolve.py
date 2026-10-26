#!/usr/bin/env python3
"""Convert browser recordings to a new editor-oriented file; requires FFmpeg."""
import argparse,json,shutil,subprocess
from pathlib import Path

def command(source,dest,mode,fps,ffmpeg='ffmpeg'):
    args=[ffmpeg,'-hide_banner','-nostdin','-n','-i',str(source),'-map','0:v:0','-map','0:a:0?']
    if mode=='remux':return args+['-c','copy','-movflags','+faststart',str(dest)]
    args+=['-vf',f'fps={fps},pad=ceil(iw/2)*2:ceil(ih/2)*2','-fps_mode','cfr']
    if mode=='prores':args+=['-c:v','prores_ks','-profile:v','1','-pix_fmt','yuv422p10le','-c:a','pcm_s24le','-ar','48000']
    else:args+=['-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-ar','48000']
    return args+['-movflags','+faststart',str(dest)]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files',nargs='+',type=Path);parser.add_argument('--format',choices=['prores','h264','remux'],default='prores');parser.add_argument('--fps',choices=[24,25,30,50,60],type=int,default=30)
    opts=parser.parse_args();ffmpeg=shutil.which('ffmpeg')
    if not ffmpeg:parser.error('FFmpeg is required for conversion, but is not installed or is not on PATH. The visualiser itself does not need it.')
    for file in opts.files:
        file=file.resolve()
        if not file.is_file():parser.error(f'File not found: {file}')
        ext='.mov' if opts.format=='prores' else '.mp4'
        dest=file.with_name(file.stem+'-resolve-'+opts.format+ext)
        if dest.exists():parser.error(f'Will not overwrite: {dest}')
        probe=shutil.which('ffprobe')
        if probe:
            result=subprocess.run([probe,'-v','error','-show_streams','-show_format','-of','json',str(file)],capture_output=True,text=True)
            if result.returncode==0:
                report=dest.with_suffix('.source-info.json')
                if not report.exists():report.write_text(result.stdout)
        subprocess.run(command(file,dest,opts.format,opts.fps,ffmpeg),check=True)
        print(f'Saved {dest}')
if __name__=='__main__':main()
