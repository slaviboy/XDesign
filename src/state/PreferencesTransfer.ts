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
 * A preferences transfer in progress.
 *
 * Importing is two steps that cannot be collapsed: pick the file, then choose
 * what to take from it. The choosing has to come second, because until the
 * file is read there is nothing to choose between — offering a checkbox for a
 * section the file does not contain would be a promise nothing can keep.
 *
 * So the parsed file waits here between the picker closing and the dialog
 * opening. Session state, not document state, and deliberately not in
 * EditorStore: it lives for two seconds and nothing renders from it except the
 * one dialog that consumes it.
 */

import type { PreferencesFile } from '../persistence/Preferences'

let pending: PreferencesFile | null = null

export function setPendingPreferences(file: PreferencesFile | null): void {
  pending = file
}

export function pendingPreferences(): PreferencesFile | null {
  return pending
}
