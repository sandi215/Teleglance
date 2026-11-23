// Speech-to-text for the TeleGlance backend.
//
// The glasses mic emits PCM s16le @ 16 kHz, mono (see the `asr`
// template: `bridge.audioControl(true)` + `event.audioEvent.audioPcm`).
// The app batches the PCM and POSTs it here when recording stops.
//
// Two paths:
//   1. Live (real): STT_ENDPOINT env is set -> the PCM is wrapped in a
//      WAV container and forwarded to a Whisper-compatible
//      /v1/audio/transcriptions endpoint (model STT_MODEL, default
//      "whisper-1", bearer STT_API_KEY). No key ships in the repo.
//   2. Demo (default): no endpoint configured -> a scripted transcript
//      is returned and flagged `demo: true`. The headless simulator has
//      no live mic, so this is the path the demo video uses. The app
//      shows the transcript as-is; the README documents both paths.
//
// Xingchi is NOT used here: the custom.xingchiapi connector states chat
// completions are blocked by the provider for direct connections, so
// there is no LLM STT path to fall back to either.

const DEMO_TRANSCRIPTS: Record<string, string> = {
  'demo-crypto-news':
    "Thanks for the update — I'll keep an eye on the Bitcoin ETF flows and let you know what I think.",
  'demo-build-night':
    'Got it — the demo video is almost done, I just need one more evening to finish the edit.',
  'demo-teleglance': 'Perfect, the digest is ready. Thanks!',
}

const GENERIC_DEMO_TRANSCRIPT =
  'Thanks — got your message, I will get back to you soon.'

/** 44-byte WAV header for PCM s16le, mono, 16 kHz. */
function wavHeader(pcmBytes: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcmBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM format chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(16000, 24) // sample rate
  header.writeUInt32LE(16000 * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(pcmBytes, 40)
  return header
}

export interface Transcription {
  transcript: string
  demo: boolean
}

export async function transcribePcm(
  pcm: Buffer,
  chatId?: string,
): Promise<Transcription> {
  const endpoint = process.env.STT_ENDPOINT
  if (!endpoint) {
    return {
      transcript: (chatId && DEMO_TRANSCRIPTS[chatId]) ?? GENERIC_DEMO_TRANSCRIPT,
      demo: true,
    }
  }
  const wav = Buffer.concat([wavHeader(pcm.length), pcm])
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'reply.wav')
  form.append('model', process.env.STT_MODEL ?? 'whisper-1')
  const res = await fetch(`${endpoint.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: process.env.STT_API_KEY
      ? { Authorization: `Bearer ${process.env.STT_API_KEY}` }
      : {},
    body: form,
  })
  if (!res.ok) {
    throw new Error(`STT endpoint failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { text?: string }
  const transcript = (data.text ?? '').trim()
  if (!transcript) throw new Error('STT endpoint returned an empty transcript')
  return { transcript, demo: false }
}
