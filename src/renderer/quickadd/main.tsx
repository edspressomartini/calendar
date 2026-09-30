import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/styles/index.css'
import { QuickAddApp } from './QuickAddApp.tsx'

const container = document.getElementById('root')
if (!container) {
  throw new Error('quick add root element is missing')
}

createRoot(container).render(
  <StrictMode>
    <QuickAddApp />
  </StrictMode>,
)
