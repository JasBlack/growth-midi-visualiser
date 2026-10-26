import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MAX_TIPS, TIP_SHAPES, TipMarkers, parseTipObj } from './tips'

const TRI = 'v 0 0 0\nv 1 0 0\nv 0 1 0\n'
const positions = (g: THREE.BufferGeometry) => Array.from(g.getAttribute('position').array)
const triangles = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3

/** n vertices on a circle and one n-gon face over them */
function ngon(n: number) {
  let s = ''
  for (let i = 0; i < n; i++) s += `v ${Math.cos((i / n) * 6.283)} ${Math.sin((i / n) * 6.283)} 0\n`
  return s + `f ${Array.from({ length: n }, (_, i) => i + 1).join(' ')}\n`
}

describe('parseTipObj', () => {
  it('one triangle: centred, scaled to ±1 on its longest side, with normals', () => {
    const g = parseTipObj(TRI + 'f 1 2 3')
    expect(triangles(g)).toBe(1)
    g.computeBoundingBox()
    const box = g.boundingBox!
    expect(box.getCenter(new THREE.Vector3()).length()).toBeCloseTo(0, 6)
    expect(box.max.x - box.min.x).toBeCloseTo(2, 6)
    expect(g.getAttribute('normal')).toBeDefined()
  })

  it('keeps proportions: only the longest extent reaches ±1', () => {
    const g = parseTipObj('v 0 0 0\nv 10 0 0\nv 0 4 0\nf 1 2 3')
    g.computeBoundingBox()
    expect(g.boundingBox!.max.toArray().map((v) => +v.toFixed(6))).toEqual([1, 0.4, 0])
    expect(g.boundingBox!.min.toArray().map((v) => +v.toFixed(6))).toEqual([-1, -0.4, 0])
  })

  it('negative indices count back from the vertices read so far', () => {
    const pos = positions(parseTipObj(TRI + 'f 1 2 3'))
    expect(positions(parseTipObj(TRI + 'f -3 -2 -1'))).toEqual(pos)
    // a second object's relative face uses its own vertices, not the first ones
    const two = parseTipObj(TRI + 'f -3 -2 -1\nv 5 5 5\nv 6 5 5\nv 5 6 5\nf -3 -2 -1')
    const p = positions(two)
    expect(triangles(two)).toBe(2)
    expect(p.slice(9)).not.toEqual(p.slice(0, 9))
  })

  it('n-gons are fanned into n - 2 triangles', () => {
    const quad = parseTipObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4')
    expect(triangles(quad)).toBe(2)
    // fan from the first corner: (1 2 3) and (1 3 4)
    const p = positions(quad)
    expect(p.slice(0, 3)).toEqual(p.slice(9, 12))
    expect(p.slice(6, 9)).toEqual(p.slice(12, 15))
    expect(triangles(parseTipObj(ngon(5)))).toBe(3)
    expect(triangles(parseTipObj(ngon(64)))).toBe(62)
  })

  it('reads real-world OBJ text: v/vt/vn faces, comments, CRLF, tabs, other statements', () => {
    const text = [
      '# exported',
      'o thing',
      'v 0 0 0 1.0',
      'v\t1 0 0',
      'v 0 1 0  # trailing comment',
      'vt 0 0',
      'vn 0 0 1',
      'usemtl none',
      's off',
      '',
      'f 1/1/1 2//1 3/1',
    ].join('\r\n')
    expect(triangles(parseTipObj(text))).toBe(1)
  })

  it('rejects malformed input with a readable message', () => {
    const cases: [string, string, string][] = [
      ['a vertex with two coordinates', 'v 1 2\n', 'invalid OBJ vertex'],
      ['a vertex that is not a number', 'v 1 x 3\n', 'invalid OBJ vertex'],
      ['a face with two corners', TRI + 'f 1 2', 'invalid OBJ face'],
      ['a face past the vertices read', TRI + 'f 1 2 4', 'invalid OBJ face'],
      ['index 0', TRI + 'f 0 1 2', 'invalid OBJ face'],
      ['a relative index before the start', TRI + 'f -4 -2 -1', 'invalid OBJ face'],
      ['a fractional index', TRI + 'f 1.5 2 3', 'invalid OBJ face'],
      ['a 65-gon', ngon(65), 'invalid OBJ face'],
      ['no faces', TRI, 'the OBJ has no faces'],
      ['an empty file', '', 'the OBJ has no faces'],
      ['all corners in one point', 'v 1 1 1\nv 1 1 1\nv 1 1 1\nf 1 2 3', 'the OBJ has no usable extent'],
    ]
    for (const [name, text, message] of cases) expect(() => parseTipObj(text), name).toThrow(message)
  })

  it('caps: 10,000 vertices and 2,048 triangles', () => {
    const verts = (n: number) => Array.from({ length: n }, (_, i) => `v ${i} ${i % 7} ${i % 3}`).join('\n') + '\n'
    expect(triangles(parseTipObj(verts(10000) + 'f 1 2 3'))).toBe(1)
    expect(() => parseTipObj(verts(10001) + 'f 1 2 3')).toThrow('at most 10,000 vertices')
    const faces = (n: number) => Array.from({ length: n }, () => 'f 1 2 3').join('\n')
    expect(triangles(parseTipObj(TRI + faces(2048)))).toBe(2048)
    expect(() => parseTipObj(TRI + faces(2049))).toThrow('at most 2,048 triangles')
  })
})

describe('tip shapes', () => {
  it('every shape builds a drawable geometry', () => {
    for (const s of TIP_SHAPES) {
      const g = s.make()
      expect(g.getAttribute('position').count, s.name).toBeGreaterThan(0)
      g.computeBoundingSphere()
      expect(g.boundingSphere!.radius, s.name).toBeGreaterThan(0.5)
      expect(g.boundingSphere!.radius, s.name).toBeLessThan(2)
      g.dispose()
    }
  })

  it('uploads sit at the indices saved settings use; the marker limit never passes the allocation', () => {
    expect(TIP_SHAPES[9].name).toBe('custom image')
    expect(TIP_SHAPES[10].name).toBe('custom OBJ')
    const tips = new TipMarkers({
      instanced: () => {
        throw new Error('not mounted in a test')
      },
      changed: () => {},
      status: () => {},
    })
    const limit = tips.controls.find((c) => c.key === 'tipLimit')!
    expect(limit.max).toBe(MAX_TIPS)
    expect(limit.value).toBeLessThanOrEqual(MAX_TIPS)
    expect(tips.controls.find((c) => c.key === 'tipShape')!.options).toEqual(TIP_SHAPES.map((s) => s.name))
  })
})
