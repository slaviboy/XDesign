/**
 * Non-blocking notifications.
 *
 * Errors here are informational, never modal: a malformed SVG or an unsupported
 * file must not interrupt what the user is doing.
 */

import { dismissNotification } from '../state/EditorStore'
import { useEditorStore } from '../state/hooks'
import { CloseIcon } from './icons'

export function Notifications() {
  const notifications = useEditorStore((s) => s.notifications)
  if (notifications.length === 0) return null

  return (
    <div className="notifications" role="status" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} className={`notification ${n.kind}`}>
          <span style={{ flex: 1 }}>
            {n.message}
            {n.detail && <span className="notification-detail">{n.detail}</span>}
          </span>
          <button
            type="button"
            className="notification-close"
            aria-label="Dismiss"
            onClick={() => dismissNotification(n.id)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
