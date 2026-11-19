import { useEffect } from 'react'
import { useEditor } from './store'
import { ProjectHome } from './components/ProjectHome'
import { Workspace } from './components/Workspace'
import { dropTargetAt } from './components/Timeline'

const query = new URLSearchParams(location.search)
/** True in the clip-prep window of split view. */
export const IS_PREP = query.get('prep') === '1'

export function App() {
  const project = useEditor((s) => s.project)
  useEffect(() => {
    const id = query.get('project')
    if (id) void useEditor.getState().openProject(id)
    // Both halves of split view accept clips sent from the other.
    return window.api.split.onReceive((items, at) => {
      if (!useEditor.getState().project) return
      useEditor.getState().receiveClips(items, at ? dropTargetAt(at) ?? undefined : undefined)
    })
  }, [])
  if (IS_PREP && !project) return <p className="empty">Opening clip prep…</p>
  return project ? <Workspace /> : <ProjectHome />
}
