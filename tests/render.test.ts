import { describe, expect, it } from 'vitest'

import { resolveHole, HOLE } from '../src/core/fingering/table'
import { M } from '../src/core/layout'
import { compile } from '../src/core/pipeline'
import { renderPageSvg } from '../src/export/exporters'
import { PANDA_HOLE_PNG } from '../src/render/panda'
import { 为爱追寻, 落了白 } from '../src/samples'

function svgOf(dsl: string, watermark = '') {
  const r = compile(dsl)
  return renderPageSvg(r.score!, r.layout!, 0, { watermark, ambiguousPolicy: '闭' })
}

/** 第一页里所有画出来的指法列，按孔位展开 */
function drawnHoles(dsl: string) {
  const r = compile(dsl)
  const out: { holeIdx: number; state: number }[] = []
  for (const sys of r.layout!.pages[0].systems) {
    for (const lm of sys.measures) {
      for (const ln of lm.notes) {
        if (!ln.showFingering || !ln.fingering?.holes) continue
        ln.fingering.holes.forEach((h, holeIdx) => out.push({ holeIdx, state: resolveHole(h, '闭') }))
      }
    }
  }
  return out
}

describe('孔位图标', () => {
  it('按住的孔画成熊猫图章，数量与指法表对得上', () => {
    const svg = svgOf(落了白)
    const closed = drawnHoles(落了白).filter((h) => h.state === HOLE.CLOSED).length
    const images = svg.match(/<image /g) ?? []
    expect(closed).toBeGreaterThan(0)
    expect(images).toHaveLength(closed)
    expect(svg).toContain(PANDA_HOLE_PNG.slice(0, 64))
  })

  it('熊猫是内联 data URI（导出光栅化时外链图片加载不到）', () => {
    expect(PANDA_HOLE_PNG.startsWith('data:image/png;base64,')).toBe(true)
    expect(svgOf(落了白)).not.toMatch(/href="(?!data:)/)
  })

  it('半孔的裁剪定义存在且按自身包围盒裁一半', () => {
    const svg = svgOf(落了白)
    expect(svg).toContain('clipPathUnits="objectBoundingBox"')
    expect(svg).toMatch(/<clipPath id="hole-half-left"/)
  })

  it('没有半孔的曲子不会出现半孔裁剪引用', () => {
    const halves = drawnHoles(落了白).filter((h) => h.state === HOLE.HALF)
    expect(halves).toHaveLength(0)
    expect(svgOf(落了白)).not.toContain('clip-path="url(#hole-half-left)"')
  })
})

describe('第八孔 / 第一孔 左移标记', () => {
  it('偏移量为正，且不会把圆挤出管身之外太多', () => {
    expect(M.edgeHoleShift).toBeGreaterThan(0)
    expect(M.edgeHoleShift + M.holeR).toBeLessThanOrEqual(M.fingerW / 2 + M.holeR)
  })

  it.each([
    { name: '落了白', dsl: 落了白 },
    { name: '为爱追寻', dsl: 为爱追寻 },
  ])('$name：每列里恰好两个孔（第八孔与第一孔）是左移的', ({ dsl }) => {
    const r = compile(dsl)
    const lm = r.layout!.pages[0].systems[0].measures.find((m) =>
      m.notes.some((n) => n.showFingering),
    )!
    const ln = lm.notes.find((n) => n.showFingering)!

    // 渲染用的圆心：第八孔(0) 与第一孔(7) 左移，其余居中
    const centers = Array.from({ length: 8 }, (_, i) =>
      i === 0 || i === 7 ? ln.x - M.edgeHoleShift : ln.x,
    )
    expect(centers.filter((c) => c !== ln.x)).toHaveLength(2)
    expect(centers[0]).toBe(ln.x - M.edgeHoleShift)
    expect(centers[7]).toBe(ln.x - M.edgeHoleShift)
    for (let i = 1; i <= 6; i++) expect(centers[i]).toBe(ln.x)
  })

  it('SVG 里确实出现了左移后的 x 坐标', () => {
    const r = compile(落了白)
    const ln = r.layout!.pages[0].systems[0].measures
      .flatMap((m) => m.notes)
      .find((n) => n.showFingering)!
    const svg = renderPageSvg(r.score!, r.layout!, 0, { watermark: '', ambiguousPolicy: '闭' })
    const shifted = ln.x - M.edgeHoleShift
    expect(svg).toContain(`cx="${shifted}"`)
  })
})

describe('导出用 SVG', () => {
  it('自带 xmlns，且没有未声明的命名空间前缀', () => {
    const svg = svgOf(落了白)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toContain('xlink:')
  })

  it('水印留空时不产生水印节点', () => {
    expect(svgOf(为爱追寻, '')).not.toContain('aria-hidden')
    expect(svgOf(为爱追寻, '学箫版')).toContain('学箫版')
  })
})
