// Mic capture for voice replies — from the `asr` template pattern.
//
// The G2 mic emits PCM s16le @ 16 kHz, mono. `bridge.audioControl(true)`
// starts the host pushing PCM frames through
// `event.audioEvent.audioPcm`; `audioControl(false)` stops it. The app
// batches frames and POSTs them to /api/stt when recording stops (batch,
// not streaming — the backend transcribes the whole clip at once).
//
// The headless simulator has no live mic: audioControl is a no-op there
// and no frames arrive, so stopRecording returns an empty buffer and the
// app asks the backend for the scripted demo transcript instead.

export class PcmRecorder {
  private chunks: Uint8Array[] = []
  private totalBytes = 0
  private active = false

  /** audioControl may be sync or async depending on the SDK build;
   * swallow both sync throws and async rejections (simulator mic). */
  private safeControl(fn: (on: boolean) => unknown, on: boolean): void {
    try {
      const r = fn(on)
      if (r instanceof Promise) r.catch(() => {})
    } catch {
      // Mic unavailable (simulator): recording proceeds with zero frames
      // and the backend demo transcript fills in at stop time.
    }
  }

  /** Start capture. Never throws — a missing mic (simulator) just means
   * no frames will arrive. */
  start(audioControl: (on: boolean) => unknown): void {
    this.chunks = []
    this.totalBytes = 0
    this.active = true
    this.safeControl(audioControl, true)
  }

  push(chunk: Uint8Array): void {
    if (!this.active) return
    this.chunks.push(chunk)
    this.totalBytes += chunk.length
  }

  get frameCount(): number {
    return this.chunks.length
  }

  /** Stop capture and return the batched PCM (possibly empty). */
  stop(audioControl: (on: boolean) => unknown): Uint8Array {
    this.active = false
    this.safeControl(audioControl, false)
    const out = new Uint8Array(this.totalBytes)
    let offset = 0
    for (const c of this.chunks) {
      out.set(c, offset)
      offset += c.length
    }
    this.chunks = []
    this.totalBytes = 0
    return out
  }

  get isActive(): boolean {
    return this.active
  }
}

/** Base64-encode a PCM buffer for the /api/stt JSON body. */
export function toBase64(pcm: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < pcm.length; i += CHUNK) {
    binary += String.fromCharCode(...pcm.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
