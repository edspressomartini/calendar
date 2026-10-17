import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/styles/index.css'
import { WidgetApp } from './WidgetApp.tsx'

const container = document.getElementById('root')
if (!container) {
  throw new Error('widget root element is missing')
}

// index.css is shared with the settings, alert and quick-add windows, which are
// opaque. Only this window is transparent over a vibrancy material, so only it
// opts in to the glass rules.
document.documentElement.dataset.surface = 'glass'

createRoot(container).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>,
)
