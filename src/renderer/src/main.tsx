import { createRoot } from 'react-dom/client'
import './styles.css'
import { startSettings } from './settings'
import { installTooltips } from './tooltips'

startSettings()
installTooltips()
// Errors in the interface are kept (without personal details) for the diagnostics report.
window.addEventListener('error', (e) => window.api?.diagnostics.log('renderer', `${e.message} (${e.filename?.split(/[\\/]/).pop() ?? ''}:${e.lineno})`))
window.addEventListener('unhandledrejection', (e) => window.api?.diagnostics.log('renderer', `Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`))

const renderJobId = new URLSearchParams(location.search).get('render')

if (renderJobId) {
  // Hidden render window: no interface, just draw frames.
  void import('./render/renderJob').then((m) => m.runRenderJob(renderJobId))
} else {
  void import('./App').then(({ App }) => createRoot(document.getElementById('root')!).render(<App />))
}
