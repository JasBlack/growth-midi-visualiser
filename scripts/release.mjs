// Release packaging, run after `vite build`:
//   dist/growth-visualiser-vX.html   one self-contained file (everything except webcam gestures)
//   dist/README.txt + launchers      folder version with a tiny local server (enables gestures)
//   growth-visualiser-vX.zip         the dist folder
import { rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, openSync, writeSync, closeSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

const VERSION = /VERSION = '([^']+)'/.exec(readFileSync('src/midi/version.ts', 'utf8'))[1]
const out = 'dist'

// Single-file build: inline the one JS bundle into the page.
const html = readFileSync(`${out}/index.html`, 'utf8')
const js = readdirSync(`${out}/assets`).find((f) => /^index-.*\.js$/.test(f))
const tag = new RegExp(`<script type="module"[^>]*src="\\./assets/${js.replace('.', '\\.')}"[^>]*></script>`)
if (!tag.test(html)) throw new Error('bundle script tag not found in index.html')
const singleName = `growth-visualiser-v${VERSION}.html`
writeFileSync(`${out}/${singleName}`, html.replace(tag, () => `<script type="module">${readFileSync(`${out}/assets/${js}`, 'utf8')}</script>`))

writeFileSync(
  `${out}/README.txt`,
  `Growth v${VERSION} — MIDI / music visualiser
=======================================

Chrome, Edge or Brave (2023+) on macOS or Windows give the full-speed WebGPU
path. Safari 26+ and current Firefox run it through WebGL2 (slower, same look).

TWO WAYS TO RUN

A) One file, no server: double-click "${singleName}".
   Everything works from a plain file open except webcam gestures (needs the
   MediaPipe files, see B).

B) Folder + tiny local server (enables gestures):
   macOS    double-click "start-mac.command" (first time: right-click → Open)
   Windows  double-click "start-windows.cmd"
   or in a terminal: python3 launch.py
   The browser opens http://localhost:8765/ once the server is ready; keep the
   window open, Ctrl+C stops it. It serves this computer only. Needs Python 3
   (on a Mac without it, "python3" offers to install the developer tools).
   If port 8765 is taken: python3 launch.py --port 8766

Keys: 1–5 pattern · Enter performance mode · F2 hide UI · Esc show UI ·
Tab next control · Backspace reset · [ ] palette · Space play/pause ·
R record · Q still · C camera · Shift+1…8 presets · letters play the keyboard piano.
Shortcuts work unless you are typing in a text field. Use "Find a setting" at
the top of the panel to locate a control.
`,
)
copyFileSync('scripts/launch.py', `${out}/launch.py`)
writeFileSync(
  `${out}/start-mac.command`,
  `#!/bin/bash
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  python3 launch.py
else
  echo "Python 3 is needed for webcam gestures. Otherwise open ${singleName} directly."
  read -r -p "Press Enter to close."
fi
`,
)
writeFileSync(
  `${out}/start-windows.cmd`,
  [
    '@echo off',
    'cd /d "%~dp0"',
    'py -3 --version >nul 2>&1',
    'if not errorlevel 1 (',
    '  py -3 launch.py',
    '  if errorlevel 1 pause',
    '  exit /b',
    ')',
    'python --version >nul 2>&1',
    'if not errorlevel 1 (',
    '  python launch.py',
    '  if errorlevel 1 pause',
    '  exit /b',
    ')',
    `echo Python 3 is needed for webcam gestures. Otherwise open ${singleName} directly.`,
    'pause',
    '',
  ].join('\r\n'),
)

// ------------------------------------------------------------ zip
// Written here rather than with PowerShell's Compress-Archive, whose entries
// use backslashes (macOS unpacks them as flat files named "assets\index-….js")
// and carry no unix mode (start-mac.command would lose its exec bit).

const EXECUTABLE = new Set(['start-mac.command'])

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** Every file and folder under dir, as forward-slash paths relative to it, folders first. */
function walk(dir, prefix = '') {
  const entries = []
  for (const name of readdirSync(dir).sort()) {
    const full = `${dir}/${name}`
    const rel = prefix + name
    if (statSync(full).isDirectory()) entries.push({ name: `${rel}/`, full, dir: true }, ...walk(full, `${rel}/`))
    else entries.push({ name: rel, full, dir: false })
  }
  return entries
}

function writeZip(zipPath, dir) {
  const fd = openSync(zipPath, 'w')
  const central = []
  let offset = 0
  const put = (buf) => {
    writeSync(fd, buf)
    offset += buf.length
  }
  for (const e of walk(dir)) {
    if (e.name.includes('\\')) throw new Error(`zip entry with a backslash: ${e.name}`)
    const name = Buffer.from(e.name, 'utf8')
    const raw = e.dir ? Buffer.alloc(0) : readFileSync(e.full)
    const packed = e.dir ? raw : deflateRawSync(raw, { level: 9 })
    const stored = packed.length >= raw.length // incompressible (or empty): store as is
    const data = stored ? raw : packed
    const crc = crc32(raw)
    const { time, date } = dosTime(statSync(e.full).mtime)
    const mode = e.dir ? 0o40755 : EXECUTABLE.has(e.name) ? 0o100755 : 0o100644
    const flags = /[^\x20-\x7e]/.test(e.name) ? 0x0800 : 0 // bit 11: the name is UTF-8
    const method = stored ? 0 : 8
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed: 2.0
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE((3 << 8) | 20, 4) // made by: unix, so the mode below is honoured
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(flags, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE((((mode << 16) >>> 0) | (e.dir ? 0x10 : 0)) >>> 0, 38) // unix mode + MS-DOS directory bit
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    put(local)
    put(name)
    put(data)
  }
  const cdStart = offset
  for (const b of central) put(b)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(central.length / 2, 8)
  end.writeUInt16LE(central.length / 2, 10)
  end.writeUInt32LE(offset - cdStart, 12)
  end.writeUInt32LE(cdStart, 16)
  put(end)
  closeSync(fd)
}

const zip = `growth-visualiser-v${VERSION}.zip`
if (existsSync(zip)) rmSync(zip)
writeZip(zip, out)
console.log(`release: ${out}/${singleName} (single file) and ${zip}`)
