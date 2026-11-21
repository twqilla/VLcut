/** Dragging an effect, an effect stack, a transition or a colour look from the library onto a clip in the timeline. */
import { create } from 'zustand'
import type { DragEvent } from 'react'
import { applyLook } from '@shared/agent/tools2'
import { useEditor } from './store'

export const APPLY_MIME = 'application/x-vlcut-apply'

export interface ApplyPayload {
  kind: 'effect' | 'stack' | 'transition' | 'look'
  id: string
  name: string
  /** For a stack: its effects. */
  effects?: { type: string; params: Record<string, number> }[]
  /** For a look: how strongly it is applied (0 to 1). */
  intensity?: number
}

/** The clip under the pointer while something is dragged over the timeline (it is outlined). */
export const useApplyTarget = create<{ clipId: string | null }>(() => ({ clipId: null }))
export const clearApplyTarget = (): void => useApplyTarget.setState({ clipId: null })

/** Props that make a library tile draggable onto clips. */
export function applyDragProps(payload: ApplyPayload): { draggable: true; onDragStart: (e: DragEvent) => void; onDragEnd: () => void } {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(APPLY_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    onDragEnd: clearApplyTarget
  }
}

/** Applies what was dropped to that one clip (it becomes the selection, so the usual undo step and properties follow it). */
export function applyToClip(payload: ApplyPayload, clipId: string): void {
  const editor = useEditor.getState()
  editor.select([clipId])
  switch (payload.kind) {
    case 'effect':
      return editor.addEffect(payload.id)
    case 'stack':
      return editor.addEffectStack(payload.name, payload.effects ?? [])
    case 'transition':
      return editor.setTransition(payload.id)
    case 'look':
      return editor.apply(`Apply the ${payload.name} look`, (p) => applyLook(p, payload.id, payload.intensity ?? 1, [clipId]).project)
  }
}

/** Reads the payload of a drop (null when the drop is something else). */
export function readApplyPayload(e: DragEvent): ApplyPayload | null {
  try {
    const raw = e.dataTransfer.getData(APPLY_MIME)
    const p = raw ? (JSON.parse(raw) as ApplyPayload) : null
    return p && typeof p.id === 'string' && ['effect', 'stack', 'transition', 'look'].includes(p.kind) ? p : null
  } catch {
    return null
  }
}
