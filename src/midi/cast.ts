// Cast: publish the stage canvas over WHIP (non-trickle ICE, H264 first) to a
// mediamtx path. The compositor then pulls it as a `whep` clip and can feed it
// into StreamDiffusion — the organism becomes an AI-restyled layer. Mirrors
// src/state/whipPublish.ts but self-contained (no rail / store).

export type CastStatus = 'idle' | 'connecting' | 'live' | 'error' | 'stopped'

export class Caster {
  status: CastStatus = 'idle'
  detail = ''
  onStatus: (s: CastStatus, detail: string) => void = () => {}
  private pc: RTCPeerConnection | null = null
  private location: string | null = null
  private stream: MediaStream | null = null

  private set(s: CastStatus, detail = '') {
    this.status = s
    this.detail = detail
    this.onStatus(s, detail)
  }

  /** whipUrl e.g. http://host:8889/growth/whip — mediamtx serves the WHEP side at .../growth/whep */
  async start(canvas: HTMLCanvasElement, whipUrl: string, fps = 30, maxKbps = 6000) {
    this.stop()
    this.set('connecting')
    const stream = canvas.captureStream(fps)
    this.stream = stream
    const track = stream.getVideoTracks()[0]
    try {
      track.contentHint = 'motion'
    } catch {
      /* older engines */
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    this.pc = pc
    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return
      const st = pc.iceConnectionState
      if (st === 'connected' || st === 'completed') this.set('live', whipUrl)
      else if (st === 'failed' || st === 'disconnected') this.set('error', `ICE ${st}`)
    }
    const tr = pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] })
    try {
      const caps = RTCRtpSender.getCapabilities?.('video')
      if (caps?.codecs?.length) {
        const h264 = caps.codecs.filter((c) => /video\/h264/i.test(c.mimeType))
        const rest = caps.codecs.filter((c) => !/video\/h264/i.test(c.mimeType))
        if (h264.length) tr.setCodecPreferences?.([...h264, ...rest])
      }
    } catch {
      /* best-effort */
    }
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await new Promise<void>((res) => {
        if (pc.iceGatheringState === 'complete') return res()
        const t = setTimeout(res, 2000)
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(t)
            res()
          }
        }
      })
      const r = await fetch(whipUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp })
      if (!r.ok) throw new Error(`WHIP ${r.status} ${r.statusText}`)
      this.location = r.headers.get('Location')
      if (this.location && !/^https?:/.test(this.location)) this.location = new URL(this.location, whipUrl).toString()
      await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() })
      try {
        const p = tr.sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string }
        p.degradationPreference = 'maintain-framerate'
        if (!p.encodings?.length) p.encodings = [{}]
        p.encodings[0].maxBitrate = Math.max(300, maxKbps) * 1000
        await tr.sender.setParameters(p as RTCRtpSendParameters)
      } catch {
        /* best-effort */
      }
    } catch (e) {
      this.set('error', (e as Error).message)
      this.stop(false)
    }
  }

  stop(report = true) {
    const pc = this.pc
    this.pc = null
    if (this.location) void fetch(this.location, { method: 'DELETE' }).catch(() => {})
    this.location = null
    pc?.close()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (report && this.status !== 'idle') this.set('stopped')
  }
}
