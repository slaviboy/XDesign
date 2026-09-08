/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
