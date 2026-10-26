"""Check distribution parity, preserved assets and launcher behavior."""
from html.parser import HTMLParser
from pathlib import Path
import re
import signal
import subprocess
import sys
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent
bundle = (root / 'assets/index-BWYXfAkm.js').read_text()


class HTMLCheck(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'script' and 'src' in attrs:
            self.scripts.append(attrs['src'])


for filename in ['index.html', 'growth-visualiser-v0.19.0.html']:
    html = (root / filename).read_text()
    parser = HTMLCheck()
    parser.feed(html)
    assert len(parser.ids) == len(set(parser.ids)), 'Duplicate DOM IDs'
    assert not set(re.findall(r'Y\("([\w-]+)"\)', bundle)) - set(parser.ids), 'Missing app controls'
    assert '[hidden] { display: none !important; }' in html
    for script in parser.scripts:
        assert (root / script).is_file()
    if filename.startswith('growth-'):
        assert not parser.scripts, 'Standalone has an external script'
        assert bundle in html, 'Standalone bundle differs'
    assert 'id="camCycle"' in html, 'Camera-cycle control must remain'
print('PASS: HTML IDs, controls, hidden rule, assets and standalone parity')

with zipfile.ZipFile(sys.argv[1]) as original:
    for entry in original.infolist():
        name = entry.filename.replace('\\', '/')
        if name.startswith('mediapipe/') or (name.startswith('assets/') and name != 'assets/index-BWYXfAkm.js'):
            assert (root / name).read_bytes() == original.read(entry), name
print('PASS: all supplied MediaPipe model and runtime assets preserved byte-for-byte')

server = subprocess.Popen([sys.executable, str(root / 'launch.py'), '--port', '0', '--no-browser'],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    line = server.stdout.readline()
    url = re.search(r'http://\S+', line).group()
    with urllib.request.urlopen(url, timeout=5) as response:
        assert response.status == 200 and b'controlSearch' in response.read()
    with urllib.request.urlopen(url + 'assets/index-BWYXfAkm.js', timeout=5) as response:
        assert response.read().decode() == bundle
    port = url.rstrip('/').rsplit(':', 1)[1]
    conflict = subprocess.run([sys.executable, str(root / 'launch.py'), '--port', port, '--no-browser'],
                              capture_output=True, text=True, timeout=5)
    assert conflict.returncode == 1 and 'Could not start Growth' in conflict.stdout
finally:
    server.send_signal(signal.SIGINT)
    server.communicate(timeout=5)
    assert server.returncode == 0
print('PASS: launcher serves app/bundle, handles occupied ports and stops cleanly')
