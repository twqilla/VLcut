import { useCallback, useEffect, useState } from 'react'

/** A panel size the user can drag, remembered between sessions. */
export function usePanelSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    const stored = Number(localStorage.getItem(`panel:${key}`))
    return stored >= min && stored <= max ? stored : initial
  })
  useEffect(() => localStorage.setItem(`panel:${key}`, String(size)), [key, size])
  const resize = useCallback((delta: number) => setSize((s) => Math.min(max, Math.max(min, s + delta))), [min, max])
  return [size, resize] as const
}

interface ResizerProps {
  direction: 'horizontal' | 'vertical'
  /** Called with the pointer movement in pixels since the last event. */
  onResize(delta: number): void
  label: string
}

export function Resizer({ direction, onResize, label }: ResizerProps) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    onResize(direction === 'horizontal' ? e.movementX : e.movementY)
  }
  const step = (e: React.KeyboardEvent) => {
    const keys = direction === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    if (e.key === keys[0]) onResize(-16)
    if (e.key === keys[1]) onResize(16)
  }
  return (
    <div
      className={`resizer ${direction}`}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={step}
    />
  )
}
