/**
 * Optional local language model through Ollama (https://ollama.com, MIT licence),
 * if the user happens to run it. The app never requires it and never talks to
 * anything but localhost here.
 */
/** Ollama's own OLLAMA_HOST setting is respected, e.g. "127.0.0.1:11434". */
const HOST = ((): string => {
  const host = process.env.OLLAMA_HOST?.trim() || '127.0.0.1:11434'
  return /^https?:\/\//.test(host) ? host.replace(/\/$/, '') : `http://${host}`
})()

/** Model names known to accept images. */
const VISION = /llava|vision|moondream|minicpm-v|qwen[\d.]*-?vl|gemma3|bakllava/i

async function models(): Promise<string[]> {
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(800) })
    return ((await res.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? []
  } catch {
    return []
  }
}

export async function visionModel(): Promise<string | null> {
  return (await models()).find((m) => VISION.test(m)) ?? null
}

/** One short sentence about what is in a JPEG frame. */
export async function describeImage(jpegBase64: string): Promise<string> {
  const model = await visionModel()
  if (!model) throw new Error('No local vision model is running.')
  const res = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'Describe this video frame in one short sentence: the main subjects, objects, place and what is happening. No preamble.', images: [jpegBase64], stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(120000)
  })
  if (!res.ok) throw new Error(`Local vision model error ${res.status}`)
  return (((await res.json()) as { response?: string }).response ?? '').trim().replace(/\s+/g, ' ').slice(0, 300)
}

export async function llmStatus(): Promise<{ available: boolean; model: string | null }> {
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(800) })
    const data = (await res.json()) as { models?: { name: string }[] }
    const model = data.models?.[0]?.name ?? null
    return { available: Boolean(model), model }
  } catch {
    return { available: false, model: null }
  }
}

export async function llmComplete(prompt: string): Promise<string> {
  const { model } = await llmStatus()
  if (!model) throw new Error('No local model is running.')
  const res = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(60000)
  })
  if (!res.ok) throw new Error(`Local model error ${res.status}`)
  return ((await res.json()) as { response?: string }).response ?? ''
}
