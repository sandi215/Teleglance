// AI draft for a voice reply — extractive implementation.
//
// The draft polishes the user's own spoken transcript into a send-ready
// message: filler words trimmed, first letter capitalised, terminal
// punctuation added. It does NOT invent content — the reply stays the
// user's words.
//
// Why extractive: the Xingchi LLM path is unavailable — the
// custom.xingchiapi connector states chat completions are blocked by the
// provider for direct connections — so (as with the digest) the
// extractive implementation IS the real implementation, not a fallback.
//
// Variants (Rewrite cycles 0 -> 1 -> 2 -> 0):
//   0: polished transcript as-is.
//   1: friendly opener — "Thanks — " + polished (lowercased first word).
//   2: first sentence only (short version).

const FILLERS = /^(um|uh|er|hmm|eh|yeah|like|so|well)[,\s]+/i

function polish(transcript: string): string {
  let text = transcript.trim().replace(/\s+/g, ' ')
  // Strip leading fillers (repeat: "um, uh, so ...").
  let prev = ''
  while (prev !== text) {
    prev = text
    text = text.replace(FILLERS, '')
  }
  if (!text) return ''
  text = text.charAt(0).toUpperCase() + text.slice(1)
  if (!/[.!?…]$/.test(text)) text += '.'
  return text
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?…](\s|$)/)
  return m ? m[0].trim() : text
}

export function makeDraft(transcript: string, variant = 0): string {
  const polished = polish(transcript)
  if (!polished) return ''
  switch (variant % 3) {
    case 1: {
      const lower = polished.charAt(0).toLowerCase() + polished.slice(1)
      // Don't double the thanks: "Thanks — thanks for the update."
      if (/^thanks\b/i.test(polished)) return `Sounds good — ${lower}`
      return `Thanks — ${lower}`
    }
    case 2:
      return firstSentence(polished)
    default:
      return polished
  }
}
