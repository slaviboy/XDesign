import { describe, it, expect } from 'vitest'
import { radiusHandlePosition, cornerGeometry } from '@/tools/RadiusSession'
import { createTriangle, createStar } from '@/document/NodeFactory'
import { cornerRadiusOf } from '@/document/types'

describe('undefined radius handling', () => {
  it('handle position with an old node', () => {
    const tri = createTriangle({ width: 200, height: 200 })
    delete (tri as unknown as Record<string, unknown>).cornerRadius
    const r = cornerRadiusOf(tri)
    console.log('cornerRadiusOf ->', r)
    const p = radiusHandlePosition(tri, 'vertex', r, 13)
    console.log('handle pos ->', JSON.stringify(p))
    const star = createStar({ width: 200, height: 200 }, {}, 5, 0.5)
    delete (star as unknown as Record<string, unknown>).cornerRadius
    console.log('star handle ->', JSON.stringify(radiusHandlePosition(star, 'vertex', cornerRadiusOf(star), 13)))
    console.log('geo ->', JSON.stringify(cornerGeometry(tri, 'vertex')))
    expect(true).toBe(true)
  })
  it('NaN write path', () => {
    console.log('Math.max(0, NaN) =', Math.max(0, NaN))
    console.log('JSON.stringify({r:NaN}) =', JSON.stringify({ r: NaN }))
  })
})
