import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { closeMenu, useMenu } from '../contextMenu'

/** A right-click menu. Closes on a click anywhere else, on Escape, on scroll, and after an item runs. */
export function ContextMenu() {
  const { at, items } = useMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!at || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(at.x, window.innerWidth - r.width - 6), y: Math.min(at.y, window.innerHeight - r.height - 6) })
  }, [at, items])
  useEffect(() => {
    if (!at) return
    const away = (e: Event): void => { if (!ref.current?.contains(e.target as Node)) closeMenu() }
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu() } }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('wheel', closeMenu, true)
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', closeMenu); window.removeEventListener('wheel', closeMenu, true) }
  }, [at])
  if (!at) return null
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it.separator ? <hr key={i} /> : (
        <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { closeMenu(); it.run?.() }}>
          <span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
        </button>
      ))}
    </div>
  )
}
