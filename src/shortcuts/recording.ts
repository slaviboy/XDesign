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
 * Whether a shortcut is being recorded right now.
 *
 * Three lines, and they exist because listener order is not something to rely
 * on. The shortcuts editor swallows every key while recording, including
 * Escape — but the dialog around it registered its own Escape handler when it
 * mounted, which is before the recording started, so on a shared capture-phase
 * listener the dialog wins and closes out from under the recorder.
 *
 * `stopImmediatePropagation` would not help: it only stops listeners
 * registered AFTER the one calling it. So instead of racing, the dialog asks.
 */

let recording = false

export function setShortcutRecording(on: boolean): void {
  recording = on
}

export function isShortcutRecording(): boolean {
  return recording
}
