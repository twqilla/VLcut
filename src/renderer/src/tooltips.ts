/** Tooltips that show a button's name and its keyboard shortcut as key caps, in place of the plain browser tooltip. */

/** Splits "Split at playhead (S)" into the text and the keys: ["S"]. Only a trailing bracket that looks like a shortcut counts. */
export function parseTip(title: string): { text: string; keys: string[] } {
  const m = /^(.*?)\s*\(([^()]{1,28})\)\s*$/.exec(title.trim())
  if (!m) return { text: title.trim(), keys: [] }
  const inner = m[2]
  const looksLikeKeys = /^(?:(?:Ctrl|Cmd|Shift|Alt|Option)\+)*(?:[A-Za-z0-9]|Space|Del|Delete|Home|End|Enter|Esc|Tab|F\d{1,2}|←|→|↑|↓|\+|−|-|=)(?:\s*(?:\/|or)\s*(?:(?:Ctrl|Shift|Alt)\+)*(?:[A-Za-z0-9]|Space|Del|Home|End|←|→|\+|−|-))*$/.test(inner)
  if (!m[1] || !looksLikeKeys) return { text: title.trim(), keys: [] }
  return { text: m[1], keys: inner.split(/\s*(?:\/|or)\s*/).flatMap((alt, i) => [...(i ? ['/'] : []), ...(alt.trim() === '+' ? ['+'] : alt.split('+').map((k) => k.trim()))]) }
}

let installed = false

export function installTooltips(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  let tip: HTMLDivElement | null = null
  let timer = 0
  let current: HTMLElement | null = null

  const hide = (): void => {
    window.clearTimeout(timer)
    tip?.remove()
    tip = null
    if (current?.dataset.tip !== undefined) {
      // Give the browser's own attribute back so the name is still available to assistive technology.
      // (unless the app has since given the element a newer title of its own)
      if (!current.hasAttribute('title')) current.setAttribute('title', current.dataset.tip)
      delete current.dataset.tip
    }
    current = null
  }

  const show = (el: HTMLElement): void => {
    const { text, keys } = parseTip(el.dataset.tip ?? '')
    if (!text) return
    tip = document.createElement('div')
    tip.className = 'tooltip'
    tip.setAttribute('role', 'tooltip')
    const label = document.createElement('span')
    label.textContent = text
    tip.append(label)
    for (const k of keys) {
      const kbd = document.createElement(k === '/' ? 'i' : 'kbd')
      kbd.textContent = k === '/' ? 'or' : k
      tip.append(kbd)
    }
    document.body.append(tip)
    const r = el.getBoundingClientRect()
    const t = tip.getBoundingClientRect()
    const left = Math.max(6, Math.min(window.innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2))
    const below = r.bottom + 8 + t.height < window.innerHeight
    tip.style.left = `${left}px`
    tip.style.top = `${below ? r.bottom + 8 : r.top - t.height - 8}px`
  }

  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[title]') as HTMLElement | null
    if (!el || el === current) return
    hide()
    const title = el.getAttribute('title')
    if (!title) return
    current = el
    el.dataset.tip = title
    el.removeAttribute('title')
    timer = window.setTimeout(() => current && show(current), 380)
  })
  document.addEventListener('mouseout', (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hide()
  })
  for (const type of ['pointerdown', 'keydown', 'wheel', 'blur']) window.addEventListener(type, hide, true)
}
