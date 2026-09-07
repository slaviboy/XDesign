/**
 * The layers tree.
 *
 * Rendered in REVERSE child order, because `children` is paint order (last =
 * front) while a layers panel shows the frontmost item at the top. Getting that
 * backwards makes reordering feel inverted, so the conversion happens once, here.
 *
 * Rows support rename, visibility, lock, mark-for-export, and drag reordering
 * including reparenting into groups and artboards.
 */

import { memo, useCallback, useMemo, useState } from 'react'
import {
  duplicateSelection,
  deleteSelection,
  groupSelection,
  moveNodeInTree,
  renameNode,
  setMarkedForExport,
  toggleLock,
  toggleVisibility,
  ungroupSelection,
} from '../history/Commands'
import { isContainer, type DesignNode, type NodeId } from '../document/types'
import { addToSelection, editorStore, setSelection } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import {
  ArtboardIcon, ChevronDownIcon, ChevronRightIcon, EllipseIcon, ExportBadgeIcon,
  EyeIcon, EyeOffIcon, GroupIcon, ImageIcon, LineIcon, LockIcon, PathIcon,
  PenIcon, PolygonIcon, RectIcon, RepeatGridIcon, StarIcon, TextIcon, TrashIcon,
  TriangleIcon, UnlockIcon,
} from './icons'
import { IconButton } from './primitives'

type DropPosition = 'before' | 'after' | 'inside'

interface DragState {
  id: NodeId
  overId: NodeId | null
  position: DropPosition
}

export function LayersPanel() {
  const doc = useDocument()
  const selection = useEditorStore((s) => s.selection)
  const [collapsed, setCollapsed] = useState<Set<NodeId>>(() => new Set())
  const [renaming, setRenaming] = useState<NodeId | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const root = doc.nodes[doc.rootId]
  const topLevel = useMemo(
    () => (root && 'children' in root ? [...root.children].reverse() : []),
    [root],
  )

  const toggleCollapse = useCallback((id: NodeId) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleDrop = useCallback(() => {
    if (!drag?.overId || drag.id === drag.overId) {
      setDrag(null)
      return
    }
    const target = doc.nodes[drag.overId]
    if (!target) {
      setDrag(null)
      return
    }

    if (drag.position === 'inside' && isContainer(target)) {
      moveNodeInTree(drag.id, target.id, target.children.length)
    } else {
      const parentId = target.parentId ?? doc.rootId
      const parent = doc.nodes[parentId]
      if (parent && 'children' in parent) {
        const index = parent.children.indexOf(target.id)
        // The panel is reversed, so "before" in the list means a HIGHER index.
        const insertAt = drag.position === 'before' ? index + 1 : index
        moveNodeInTree(drag.id, parentId, insertAt)
      }
    }
    setDrag(null)
  }, [doc, drag])

  const hasGroupSelected = selection.some((id) => doc.nodes[id]?.type === 'group')

  return (
    <div className="layers-panel">
      <div className="layers-header">
        <h3 className="section-title" style={{ margin: 0 }}>Layers</h3>
        <div className="icon-row">
          <IconButton
            icon={<GroupIcon />}
            label="Group"
            shortcut="⌘G"
            disabled={selection.length < 2}
            onClick={() => groupSelection()}
          />
          <IconButton
            icon={<GroupIcon style={{ opacity: 0.5 }} />}
            label="Ungroup"
            shortcut="⇧⌘G"
            disabled={!hasGroupSelected}
            onClick={() => ungroupSelection()}
          />
          <IconButton
            icon={<TrashIcon />}
            label="Delete"
            disabled={selection.length === 0}
            onClick={() => deleteSelection()}
          />
        </div>
      </div>

      <div
        className="layers-list"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onDragEnd={() => setDrag(null)}
      >
        {topLevel.length === 0 ? (
          <div className="empty-state">No layers yet.<br />Draw something to begin.</div>
        ) : (
          topLevel.map((id) => (
            <LayerBranch
              key={id}
              id={id}
              depth={0}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              renaming={renaming}
              setRenaming={setRenaming}
              drag={drag}
              setDrag={setDrag}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface BranchProps {
  id: NodeId
  depth: number
  collapsed: Set<NodeId>
  onToggleCollapse: (id: NodeId) => void
  renaming: NodeId | null
  setRenaming: (id: NodeId | null) => void
  drag: DragState | null
  setDrag: (d: DragState | null) => void
}

const LayerBranch = memo(function LayerBranch(props: BranchProps) {
  const doc = useDocument()
  const node = doc.nodes[props.id]
  const isOpen = !props.collapsed.has(props.id)

  if (!node) return null
  const children = isContainer(node) ? [...node.children].reverse() : []

  return (
    <>
      <LayerRow {...props} node={node} hasChildren={children.length > 0} isOpen={isOpen} />
      {isOpen &&
        children.map((childId) => (
          <LayerBranch key={childId} {...props} id={childId} depth={props.depth + 1} />
        ))}
    </>
  )
})

function LayerRow({
  node,
  depth,
  hasChildren,
  isOpen,
  onToggleCollapse,
  renaming,
  setRenaming,
  drag,
  setDrag,
}: BranchProps & { node: DesignNode; hasChildren: boolean; isOpen: boolean }) {
  const selected = useEditorStore((s) => s.selection.includes(node.id))
  const [draftName, setDraftName] = useState(node.name)

  const isDropTarget = drag?.overId === node.id
  const dropClass = isDropTarget ? ` drop-${drag.position}` : ''

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!drag || drag.id === node.id) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    // The middle third of a container row means "drop inside".
    const position: DropPosition =
      isContainer(node) && ratio > 0.3 && ratio < 0.7 ? 'inside' : ratio < 0.5 ? 'before' : 'after'
    if (drag.overId !== node.id || drag.position !== position) {
      setDrag({ ...drag, overId: node.id, position })
    }
  }

  return (
    <div
      className={`layer-row${selected ? ' selected' : ''}${node.visible ? '' : ' hidden-layer'}${dropClass}`}
      style={{ paddingLeft: 6 + depth * 13 }}
      draggable={renaming !== node.id}
      data-layer-id={node.id}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', node.id)
        setDrag({ id: node.id, overId: null, position: 'before' })
      }}
      onDragOver={onDragOver}
      onPointerDown={(e) => {
        if (renaming === node.id) return
        if (e.shiftKey || e.metaKey || e.ctrlKey) addToSelection([node.id])
        else if (!selected) setSelection([node.id])
      }}
      onDoubleClick={() => {
        setDraftName(node.name)
        setRenaming(node.id)
      }}
    >
      <span
        className={`layer-disclosure${hasChildren ? '' : ' empty'}`}
        onPointerDown={(e) => {
          e.stopPropagation()
          onToggleCollapse(node.id)
        }}
      >
        {isOpen ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
      </span>

      <span className="layer-icon">{iconFor(node)}</span>

      <span className="layer-name">
        {renaming === node.id ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                renameNode(node.id, draftName)
                setRenaming(null)
              }
              if (e.key === 'Escape') setRenaming(null)
            }}
            onBlur={() => {
              renameNode(node.id, draftName)
              setRenaming(null)
            }}
          />
        ) : (
          node.name
        )}
      </span>

      {node.markedForExport && (
        <span
          className="layer-action export-badge always"
          title="Marked for export"
          onPointerDown={(e) => {
            e.stopPropagation()
            setMarkedForExport([node.id], false)
          }}
        >
          <ExportBadgeIcon size={11} />
        </span>
      )}

      <span className={`layer-actions${node.locked || !node.visible ? ' always' : ''}`}>
        <button
          type="button"
          className={`layer-action${node.locked ? ' on' : ''}`}
          title={node.locked ? 'Unlock' : 'Lock'}
          onPointerDown={(e) => {
            e.stopPropagation()
            toggleLock(node.id)
          }}
        >
          {node.locked ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
        </button>
        <button
          type="button"
          className="layer-action"
          title={node.visible ? 'Hide' : 'Show'}
          onPointerDown={(e) => {
            e.stopPropagation()
            toggleVisibility(node.id)
          }}
        >
          {node.visible ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
        </button>
      </span>
    </div>
  )
}

function iconFor(node: DesignNode) {
  const size = 13
  switch (node.type) {
    case 'artboard': return <ArtboardIcon size={size} />
    case 'group': return <GroupIcon size={size} />
    case 'repeat-grid': return <RepeatGridIcon size={size} />
    case 'rect': return <RectIcon size={size} />
    case 'ellipse': return <EllipseIcon size={size} />
    // One node type, three recognisable shapes — the glyph follows the params so
    // the tree still reads at a glance.
    case 'polygon':
      if (node.starRatio < 1) return <StarIcon size={size} />
      return node.sides === 3 ? <TriangleIcon size={size} /> : <PolygonIcon size={size} />
    case 'line': return <LineIcon size={size} />
    case 'path': return <PathIcon size={size} />
    case 'text': return <TextIcon size={size} />
    case 'image': return <ImageIcon size={size} />
    case 'svg': return <PenIcon size={size} />
    default: return <RectIcon size={size} />
  }
}

export { duplicateSelection, editorStore }
