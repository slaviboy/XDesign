/**
 * Entry point.
 *
 * Font CSS is imported statically: these are @font-face DECLARATIONS, so the
 * browser does not fetch a woff2 until a rendered element actually uses that
 * family. Declaring all of them costs a few KB of CSS, not megabytes of fonts,
 * and the service worker precaches the files so every family stays available
 * offline.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { documentStore } from './state/DocumentStore'
import './styles/tokens.css'
import './styles/fonts'
import './styles/app.css'

// The beforeunload guard reads this; keeping it on window avoids a store
// subscription whose only job is to feed one boolean to an event handler.
documentStore.subscribe((state) => {
  ;(window as unknown as { __xdesignDirty?: boolean }).__xdesignDirty = state.dirty
})

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker so a hard reload with no network still boots.
//
// The path is relative to the DOCUMENT, not to this module: `new URL('sw.js',
// import.meta.url)` would resolve against the hashed chunk in /assets/ and 404.
// A document-relative './sw.js' is also what makes a GitHub Pages project
// subpath work without configuration, and it keeps the worker's scope at the
// app root so it controls every page.
//
// Updates are picked up on the user's next visit rather than applied mid-edit:
// silently swapping the app out from under an unsaved document is
// data-loss-adjacent.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // Without a worker the app still runs; it just loses the offline boot.
    })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
