/**
 * The toolbar strip at the top of the property inspector: Repeat Grid on the
 * left, the four boolean operations on the right.
 *
 * Always visible, with buttons DISABLED rather than hidden when the selection
 * does not qualify. A control that vanishes teaches nothing; a greyed one with
 * a tooltip explains what selection it needs.
 */

import { useCallback, useMemo, useState } from 'react'
import { runBooleanOperation } from '../history/BooleanCommands'
import {
  canCreateRepeatGrid,
  createRepeatGridFromSelection,
  expandRepeatGrid,
} from '../history/RepeatGridCommands'
import { isShape } from '../document/types'
import { useDocument, useEditorStore } from '../state/hooks'
import { Tooltip } from './primitives'
import {
  ExcludeIcon,
  IntersectIcon,
  RepeatGridIcon,
  SubtractIcon,
  UnionIcon,
} from './icons'
import type { BooleanOperation } from '../geometry/BooleanOps'

const BOOLEAN_OPS: Array<{
  op: BooleanOperation
  label: string
  icon: React.ReactNode
}> = [
  { op: 'union', label: 'Union', icon: <UnionIcon /> },
  { op: 'subtract', label: 'Subtract', icon: <SubtractIcon /> },
  { op: 'intersect', label: 'Intersect', icon: <IntersectIcon /> },
  { op: 'exclude', label: 'Exclude', icon: <ExcludeIcon /> },
]

export function InspectorToolbar() {
  const doc = useDocument()
  const selection = useEditorStore((s) => s.selection)
  const [busy, setBusy] = useState(false)

  const shapeCount = useMemo(
    () => selection.filter((id) => isShape(doc.nodes[id])).length,
    [doc, selection],
  )
  const selectedGrid = useMemo(() => {
    if (selection.length !== 1) return null
    const node = doc.nodes[selection[0]!]
    return node?.type === 'repeat-grid' ? node : null
  }, [doc, selection])

  const canBoolean = shapeCount >= 2 && !busy
  const canRepeat = selection.length > 0 && canCreateRepeatGrid()

  const run = useCallback(async (op: BooleanOperation) => {
    // paper.js loads lazily into its worker on the first operation, so this can
    // take a moment. The busy flag is what stops a double-click firing the
    // operation twice against a selection the first run is about to replace.
    setBusy(true)
    try {
      await runBooleanOperation(op)
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <div className="inspector-toolbar">
      {selectedGrid ? (
        <Tooltip label="Turn each cell into an independent object">
          <button
            type="button"
            className="repeat-grid-button"
            data-testid="expand-repeat-grid"
            onClick={() => expandRepeatGrid(selectedGrid.id)}
          >
            <RepeatGridIcon />
            <span>Expand Grid</span>
          </button>
        </Tooltip>
      ) : (
        <Tooltip
          label={
            canRepeat
              ? 'Repeat the selection in a grid'
              : 'Select an object to repeat it in a grid'
          }
        >
          <button
            type="button"
            className="repeat-grid-button"
            data-testid="repeat-grid"
            disabled={!canRepeat}
            onClick={() => createRepeatGridFromSelection()}
          >
            <RepeatGridIcon />
            <span>Repeat Grid</span>
          </button>
        </Tooltip>
      )}

      <span className="spacer" />

      <div className="icon-row">
        {BOOLEAN_OPS.map(({ op, label, icon }) => (
          <Tooltip
            key={op}
            label={canBoolean ? label : `${label} — select two or more shapes`}
          >
            <button
              type="button"
              className="icon-button"
              aria-label={label}
              data-testid={`boolean-${op}`}
              disabled={!canBoolean}
              onClick={() => void run(op)}
            >
              {icon}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
