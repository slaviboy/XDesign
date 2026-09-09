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
 * The frame every dialog is drawn in.
 *
 * Its own module because two files now need it, and because the Escape
 * handling below is a real decision rather than boilerplate: a dialog closes
 * on Escape, EXCEPT while a shortcut is being recorded inside it, when Escape
 * belongs to the recorder. The listener is registered in the capture phase
 * when the dialog mounts, which is before any recording starts — so it cannot
 * win that race by ordering and asks instead.
 */

import { useEffect, type ReactNode } from 'react'
import { isShortcutRecording } from '../shortcuts/recording'

export function DialogShell({
  title,
  width = 420,
  onClose,
  footer,
  children,
}: {
  title: string
  width?: number
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a shortcut is being recorded, Escape belongs to the recorder:
      // it cancels the recording, and closing the dialog as well would take
      // the thing being edited off screen. See shortcuts/recording.ts.
      if (e.key === 'Escape' && !isShortcutRecording()) { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="dialog" style={{ width }} role="dialog" aria-label={title}>
        <div className="dialog-header">{title}</div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  )
}
