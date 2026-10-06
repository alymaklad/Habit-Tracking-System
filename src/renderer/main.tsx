import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource-variable/plus-jakarta-sans/wght.css'
// Installs window.api before any screen asks for data.
import './lib/webApi'
import App from './App'
import './styles.css'

const el = document.getElementById('root')
if (!el) throw new Error('root element missing')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
)
