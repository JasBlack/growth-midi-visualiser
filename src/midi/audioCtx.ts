// One AudioContext for everything that makes or listens to sound — the file /
// mic / tab input, the instrument you play, and the sound-back plucks. They
// used to own a context each, which meant a recording could only ever contain
// the input, never the notes you played.
//
// Two recording buses hang off it: `input` (whatever the analyser hears: file,
// mic or tab) and `mix` (input + instrument + sound-back, i.e. what the room
// heard). The recorder taps either one inside the graph; neither reaches the
// speakers, so a microphone never feeds back.

export type RecordBus = 'input' | 'mix'

let ctx: AudioContext | null = null
let inputBus: GainNode | null = null
let mixBus: GainNode | null = null
let recordDest: MediaStreamAudioDestinationNode | null = null
let inputDest: MediaStreamAudioDestinationNode | null = null
let gestureHooked = false

export function audioContext(): AudioContext {
  if (!ctx) {
    // 48 kHz whatever the device runs at: Opus only takes 48 k, and it keeps recordings uniform
    ctx = new AudioContext({ sampleRate: 48000 })
    inputBus = ctx.createGain()
    mixBus = ctx.createGain()
    inputBus.connect(mixBus)
    // A destination with nothing connected emits no samples at all in Chrome,
    // and MediaRecorder then waits for audio that never comes and writes an
    // empty file. A silent constant source keeps both buses ticking over.
    const silence = ctx.createConstantSource()
    silence.offset.value = 0
    silence.connect(inputBus)
    silence.start()
    recordDest = ctx.createMediaStreamDestination()
    mixBus.connect(recordDest)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  if (!gestureHooked) {
    // autoplay policy: a context created outside a gesture stays suspended
    gestureHooked = true
    const kick = () => {
      if (ctx && ctx.state === 'suspended') void ctx.resume()
    }
    window.addEventListener('pointerdown', kick)
    window.addEventListener('keydown', kick)
  }
  return ctx
}

/** Send a node to the speakers and to the full-mix recording bus. */
export function toOutput(node: AudioNode) {
  const c = audioContext()
  node.connect(c.destination)
  node.connect(mixBus!)
}

/** Send the input (file / mic / tab) to the recording buses only — never to the speakers. */
export function toInputBus(node: AudioNode) {
  audioContext()
  node.connect(inputBus!)
}

/** The node a recording taps for this bus. */
export function busNode(bus: RecordBus): AudioNode {
  audioContext()
  return bus === 'input' ? inputBus! : mixBus!
}

/** A bus as a MediaStream (MediaRecorder fallback, debugging). Null while the context is not running. */
export function recordingStream(bus: RecordBus = 'mix'): MediaStream | null {
  // A suspended context still produces no samples, and MediaRecorder would
  // write nothing at all — a silent video is fine, an empty file is not.
  const c = audioContext()
  if (c.state !== 'running') return null
  if (bus === 'mix') return recordDest?.stream ?? null
  if (!inputDest) {
    inputDest = c.createMediaStreamDestination()
    inputBus!.connect(inputDest)
  }
  return inputDest.stream
}
