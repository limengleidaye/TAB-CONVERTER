import { describe, expect, it } from 'vitest'

import { M, computeBands, layout } from '../src/core/layout'
import { parse } from '../src/core/parser'
import { compile } from '../src/core/pipeline'
import { 为爱追寻, 落了白 } from '../src/samples/reference'

/** 一个音的低音点最低能到哪 */
function lowDotBottom(beams: number, lowOctave: number, digitBaseline: number): number {
  return (
    digitBaseline + M.beamGap + beams * M.beamStep + 5 + (lowOctave - 1) * M.octaveDotStep + M.octaveDotR
  )
}

describe('竖向分带不重叠', () => {
  it.each([
    { name: '落了白', dsl: 落了白 },
    { name: '为爱追寻', dsl: 为爱追寻 },
  ])('$name：低音点不压到歌词/洞洞谱', ({ dsl }) => {
    const r = compile(dsl)
    const { bands } = r.layout!
    const notes = r.score!.measures.flatMap((m) => m.notes)

    const lyricTop = bands.lyricBaseline - M.lyricSize
    for (const n of notes) {
      if (n.octave >= 0) continue
      const bottom = lowDotBottom(n.beams, -n.octave, bands.digitBaseline)
      expect(bottom, '低音点不得越过简谱行底线').toBeLessThanOrEqual(bands.digitsBottom + 0.01)
      if (r.layout!.hasLyrics) {
        expect(bottom, '低音点不得压到歌词字形').toBeLessThanOrEqual(lyricTop)
      }
      expect(bottom, '低音点不得压到洞洞谱').toBeLessThan(bands.fingeringTop)
    }
  })

  it.each([
    { name: '落了白', dsl: 落了白 },
    { name: '为爱追寻', dsl: 为爱追寻 },
  ])('$name：减时线不压到歌词', ({ dsl }) => {
    const r = compile(dsl)
    const { bands } = r.layout!
    const maxBeams = Math.max(...r.score!.measures.flatMap((m) => m.notes.map((n) => n.beams)))
    const beamBottom = bands.digitBaseline + M.beamGap + maxBeams * M.beamStep + M.beamThickness
    expect(beamBottom).toBeLessThanOrEqual(bands.digitsBottom + 0.01)
    if (r.layout!.hasLyrics) {
      expect(beamBottom).toBeLessThanOrEqual(bands.lyricBaseline - M.lyricSize)
    }
  })

  it('带高音点时，弧线带被顶高，不压到高音点', () => {
    const plain = computeBands({
      maxBeams: 1,
      maxLowOctave: 0,
      maxHighOctave: 0,
      hasTempo: false,
      hasFermata: false,
      hasLyrics: false,
    })
    const high = computeBands({
      maxBeams: 1,
      maxLowOctave: 0,
      maxHighOctave: 2,
      hasTempo: false,
      hasFermata: false,
      hasLyrics: false,
    })
    expect(high.digitBaseline).toBeGreaterThan(plain.digitBaseline)

    const topHighDot = high.digitBaseline - M.digitSize - 3 - (2 - 1) * M.octaveDotStep - M.octaveDotR
    expect(high.arcY).toBeLessThan(topHighDot)
    expect(high.arcY).toBeGreaterThan(0)
  })

  it('有变速记号时才给它留位置', () => {
    const without = computeBands({
      maxBeams: 0, maxLowOctave: 0, maxHighOctave: 0, hasTempo: false, hasFermata: false, hasLyrics: false,
    })
    const withTempo = computeBands({
      maxBeams: 0, maxLowOctave: 0, maxHighOctave: 0, hasTempo: true, hasFermata: false, hasLyrics: false,
    })
    expect(withTempo.digitBaseline - without.digitBaseline).toBe(M.tempoBand)
    expect(withTempo.tempoY).toBeLessThan(withTempo.arcY)
  })

  it('减时线越多、低音点越多，行越高', () => {
    const base = { maxHighOctave: 0, hasTempo: false, hasFermata: false, hasLyrics: true }
    const shallow = computeBands({ ...base, maxBeams: 1, maxLowOctave: 1 })
    const deep = computeBands({ ...base, maxBeams: 3, maxLowOctave: 2 })
    expect(deep.systemHeight).toBeGreaterThan(shallow.systemHeight)
    expect(deep.lyricBaseline).toBeGreaterThan(shallow.lyricBaseline)
  })
})

describe('分页', () => {
  it('《落了白》单页 5 行放得下（与原图一致）', () => {
    const r = compile(落了白)
    expect(r.layout!.pages).toHaveLength(1)
    expect(r.layout!.pages[0].systems).toHaveLength(5)
  })

  it('每行小节数落在合理区间，不会挤成一行也不会稀到两小节以下', () => {
    for (const dsl of [落了白, 为爱追寻]) {
      const systems = compile(dsl).layout!.pages.flatMap((p) => p.systems)
      for (const s of systems) {
        expect(s.measures.length).toBeGreaterThanOrEqual(2)
        expect(s.measures.length).toBeLessThanOrEqual(5)
      }
    }
  })

  it('《为爱追寻》单页 3 行（与原图一致）', () => {
    const r = compile(为爱追寻)
    expect(r.layout!.pages).toHaveLength(1)
    expect(r.layout!.pages[0].systems).toHaveLength(3)
  })

  it('每行都不超出页面可用高度', () => {
    for (const dsl of [落了白, 为爱追寻]) {
      const r = compile(dsl)
      for (const page of r.layout!.pages) {
        const last = page.systems.at(-1)!
        expect(last.y + last.height).toBeLessThanOrEqual(M.pageH - M.marginBottom)
      }
    }
  })
})

describe('不带洞洞谱的布局（播放窗用）', () => {
  it('一行谱矮一大截，一页能多放好几行，折行位置不变', () => {
    const src = 落了白
    const full = compile(src)
    const plain = layout(parse(src).score!, full.layout!.keySignature, { omitFingering: true })

    expect(plain.omitFingering).toBe(true)
    expect(plain.bands.fingerH).toBe(0)
    expect(plain.bands.systemHeight).toBeLessThan(full.layout!.bands.systemHeight * 0.55)

    // 竖着矮了但横着一模一样：每行的小节数与打印谱一致
    const rowsOf = (l: typeof plain) =>
      l.pages.flatMap((p) => p.systems.map((s) => s.measures.map((m) => m.measure.index).join(',')))
    expect(rowsOf(plain)).toEqual(rowsOf(full.layout!))
  })
})
