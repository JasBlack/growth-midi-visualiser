"""Apply reviewed, exact-match patches to the supplied v0.15.0 release.

Usage: python maintenance/patch_release.py ORIGINAL.zip OUTPUT_DIRECTORY
The archive is a build, not TypeScript source. Every changed bundle fragment
must occur exactly once; fail rather than silently patch another version.
"""
from pathlib import Path
import sys
import hashlib
import zipfile


def once(text, old, new):
    count = text.count(old)
    if count != 1:
        raise ValueError(f'Expected one match, found {count}: {old[:90]}')
    return text.replace(old, new, 1)


def main():
    archive, output = Path(sys.argv[1]), Path(sys.argv[2])
    maintenance = Path(__file__).resolve().parent
    with zipfile.ZipFile(archive) as source:
        expected = "287c8ed604928a5940d5fd2ef1beafc7c6acbea2f6e14f47ac34c710059ae350"
        if hashlib.sha256(source.read("assets\\index-BWYXfAkm.js")).hexdigest() != expected:
            raise ValueError("This patch requires the original v0.15.0 bundle")
        for entry in source.infolist():
            relative = Path(entry.filename.replace('\\', '/'))
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe archive path')
            path = output / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(source.read(entry))
    asset = output / 'assets/index-BWYXfAkm.js'
    original = asset.read_text()
    code = original
    code = once(code,
        'window.addEventListener("blur",()=>this.releaseAll())',
        'window.addEventListener("blur",()=>this.releaseAll()),document.addEventListener("visibilitychange",()=>{document.hidden&&this.releaseAll()})')
    code = once(code,
        'isTyping(e){const t=e.target;return!!t&&(t.tagName==="INPUT"||t.tagName==="SELECT"||t.tagName==="TEXTAREA")}',
        'isTyping(e){const t=e.target;return!!t&&(t.isContentEditable||!!t.closest?.("input,select,textarea"))}')
    code = once(code,
        'window.addEventListener("keydown",i=>{var s,n;const e=i.target;if(e&&(e.tagName==="INPUT"||e.tagName==="SELECT"||e.tagName==="TEXTAREA"))return;const t=i.key;',
        'window.addEventListener("keydown",i=>{var s,n;if(i.ctrlKey||i.metaKey||i.altKey||i.isComposing||i.defaultPrevented)return;const t=i.key;if(i.repeat&&!t.startsWith("Arrow"))return;if(t==="Escape"){pd(!1);return}if(t==="F2"){pd(!document.body.classList.contains("hide-ui")),i.preventDefault();return}const e=i.target;if(e&&(e.isContentEditable||e.closest?.("input,select,textarea,button,summary,a,[role=button]")))return;')
    code = once(code,
        ':t==="Tab"?(pd(!document.body.classList.contains("hide-ui")),i.preventDefault())', '')
    code = once(code,
        'function pd(i){document.body.classList.toggle("hide-ui",i),',
        'function pd(i){Y("panel").inert=i,document.body.classList.toggle("hide-ui",i),')
    code = once(code,
        'c.style.gridColumn="1 / span 2",t.options.forEach',
        'c.setAttribute("aria-label",t.label),c.style.gridColumn="1 / span 2",t.options.forEach')
    code = once(code,
        'u.type="range",u.min=String(t.min)',
        'u.setAttribute("aria-label",t.label),u.type="range",u.min=String(t.min)')
    code = once(code,
        'i.addEventListener("toggle",()=>{he.openSecs[e]=i.open,Hi()})',
        'i.addEventListener("toggle",()=>{if(document.getElementById("controlSearch")?.value.trim())return;he.openSecs[e]=i.open,Hi()})')
    code = once(code,
        'function IK(i){localStorage.setItem(dL,JSON.stringify(i))}',
        'function IK(i){try{localStorage.setItem(dL,JSON.stringify(i));return!0}catch{return!1}}')
    code = once(code,
        'function gJ(i){Rx[i]=dJ(),IK(Rx),rm=i,PM(),Y("presetStatus").textContent=`saved slot ${i+1}`}',
        'function gJ(i){Rx[i]=dJ();const saved=IK(Rx);rm=i,PM(),Y("presetStatus").textContent=saved?`saved slot ${i+1}`:`slot ${i+1} kept for this session only — browser storage is unavailable`}')
    code = once(code,
        'aR=window.setTimeout(()=>localStorage.setItem(a5,JSON.stringify(he)),250)',
        'aR=window.setTimeout(()=>{try{localStorage.setItem(a5,JSON.stringify(he))}catch{vs("Settings apply for this session only — browser storage is unavailable")}},250)')
    methods_text = (maintenance / 'audio-methods.js').read_text()
    methods = {}
    for part in methods_text.split('// @method ')[1:]:
        name, body = part.split('\n', 1)
        methods[name.strip()] = body.strip() + '\n'
    for name, end_marker in [('loadTrack', 'next(){'), ('startMic', 'stopMic(){'), ('startTabCapture', 'stopTab(){')]:
        start = code.index('async ' + name + '(')
        end = code.index(end_marker, start)
        code = once(code, code[start:end], methods[name])
    code = once(code, 'async loadTrack(index)', methods['beginInputRequest'] + 'async loadTrack(index)')
    code = once(code, 'stop(){this.pause(),this.stopMic(),this.stopTab(),this.active=!1',
        'stop(){this.inputRequest=(this.inputRequest||0)+1;this.pause(),this.stopMic(),this.stopTab(),this.active=!1')
    code = once(code, 'je.source!=="file"?vs("choose an mp3 / wav / ogg (or drop one on the page)")',
        'je.source!=="file"?(je.stop(),vs("choose an mp3 / wav / ogg (or drop one on the page)"))')
    code = once(code, '"0.15.0"', '"0.15.1"')
    code += '\n' + (maintenance / 'interface.js').read_text()
    asset.write_text(code)

    def improve_html(html):
        html = once(html, '</style>', (maintenance / 'interface.css').read_text() + '\n</style>')
        html = once(html, '<button id="hideUi" title="Tab">', '<button id="hideUi" title="F2">')
        html = once(html, '<kbd>Tab</kbd> hide UI', '<kbd>F2</kbd> hide UI · <kbd>Tab</kbd> next control')
        html = once(html, '<div id="panel">', '<button id="returnUi" type="button" title="Esc">Show controls · Esc</button>\n    <div id="panel" role="region" aria-label="Growth controls">')
        html = once(html, '      </div>\n\n      <!-- 1.',
            '        <input id="controlSearch" type="text" aria-label="Find a setting" placeholder="Find a setting…" autocomplete="off" aria-describedby="searchHelp" />\n        <p id="searchHelp" role="status"></p>\n      </div>\n\n      <!-- 1.')
        labels = {'midiDevice': 'MIDI input', 'micDevice': 'Microphone input', 'file': 'Audio files',
                  'seek': 'Track position', 'videoDevice': 'Camera input', 'textIn': 'Words to grow',
                  'castUrl': 'WHIP stream address', 'playBtn': 'Play or pause', 'prevBtn': 'Previous track',
                  'nextBtn': 'Next track'}
        for identifier, label in labels.items():
            html = once(html, f'id="{identifier}"', f'id="{identifier}" aria-label="{label}"')
        html = once(html, '<div id="status">', '<div id="status" role="status">')
        return html

    index = output / 'index.html'
    index.write_text(improve_html(index.read_text()))
    standalone = output / 'growth-visualiser-v0.15.0.html'
    # The supplied inline bundle is byte-for-byte identical to the folder bundle.
    html = once(standalone.read_text(), original, code)
    (output / 'growth-visualiser-v0.15.1.html').write_text(improve_html(html))
    standalone.unlink()
    (output / 'launch.py').write_bytes((maintenance.parent / 'launch.py').read_bytes())
    (output / 'start-mac.command').write_text('''#!/bin/bash
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  python3 launch.py
else
  echo "Python 3 is needed for webcam gestures. Otherwise open growth-visualiser-v0.15.1.html directly."
  read -r -p "Press Enter to close."
fi
''')
    (output / 'start-mac.command').chmod(0o755)
    (output / 'start-windows.cmd').write_text('''@echo off
cd /d "%~dp0"
py -3 --version >nul 2>&1
if not errorlevel 1 (
  py -3 launch.py
  if errorlevel 1 pause
  exit /b
)
python --version >nul 2>&1
if not errorlevel 1 (
  python launch.py
  if errorlevel 1 pause
  exit /b
)
echo Python 3 is needed for webcam gestures. Otherwise open growth-visualiser-v0.15.1.html directly.
pause
''')
    readme = output / 'README.txt'
    readme.write_text(readme.read_text().replace('0.15.0', '0.15.1').replace('Tab hide UI', 'F2 hide UI').replace('Q still ·', 'Q still · C camera ·').replace('Both use Python 3;', 'Both wait for the server before opening the browser and use Python 3;') + '\nSee NOTES_FOR_CLAUDE.md for improvements, validation and source limitations.\nTab now moves focus between controls. Use Find a setting to locate controls.\n')
    print('Patched folder and standalone releases successfully.')


if __name__ == '__main__':
    main()
