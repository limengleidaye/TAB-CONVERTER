import { describe, expect, it } from 'vitest'

import { M, computeBands } from '../src/core/layout'
import { compile } from '../src/core/pipeline'
import { renderPageSvg } from '../src/export/exporters'

function song(body: string): string {
  return `标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n${body}`
}

const notesOf = (body: string) =>
  compile(song(body)).score!.measures.flatMap((m) => m.notes)
const errorsOf = (body: string) =>
  compile(song(body)).issues.filter((i) => i.severity === 'error')
const svgOf = (body: string) => {
  const r = compile(song(body))
  return renderPageSvg(r.score!, r.layout!, 0, { watermark: '', ambiguousPolicy: '闭' })
}

describe('多段歌词的写法', () => {
  it('/ 分段，字和音仍然绑死', () => {
    const ns = notesOf('1长/韶 2亭/光 3外/逝 4 |')
    expect(ns.map((n) => n.lyrics)).toEqual([['长', '韶'], ['亭', '光'], ['外', '逝'], undefined])
    expect(compile(song('1长/韶 2亭/光 3外/逝 4 |')).score!.verseCount).toBe(2)
  })

  it('英文各段自己加引号', () => {
    expect(notesOf('1"la la"/"na na" 2 3 4 |')[0].lyrics).toEqual(['la la', 'na na'])
  })

  it('分隔符在引号外面，所以引号里的斜杠是歌词的一部分', () => {
    expect(notesOf('1"a/b" 2 3 4 |')[0].lyrics).toEqual(['a/b'])
    expect(notesOf('1"a/b"/"c/d" 2 3 4 |')[0].lyrics).toEqual(['a/b', 'c/d'])
  })

  it('中英可以混着来', () => {
    expect(notesOf('1长/"na na" 2 3 4 |')[0].lyrics).toEqual(['长', 'na na'])
  })

  it('段数不齐也行：没写的段那一格就空着', () => {
    const r = compile(song('1长/韶 2亭 3外 4 |'))
    expect(r.score!.verseCount).toBe(2)
    expect(r.score!.measures[0].notes[1].lyrics).toEqual(['亭'])
  })

  it('空引号跳过这一段：只有第二段有词', () => {
    expect(notesOf('1""/韶 2 3 4 |')[0].lyrics).toEqual(['', '韶'])
  })

  it('/ 后面没接词要报错', () => {
    const errs = errorsOf('1长/ 2 3 4 |')
    expect(errs).toHaveLength(1)
    expect(errs[0].message).toMatch(/"\/" 后面要接下一段歌词/)
  })

  it('休止符照样不能带词，几段都不行', () => {
    expect(errorsOf('0休/息 1 2 3 |')).toHaveLength(1)
  })

  it('一段词时不受影响', () => {
    const r = compile(song('1隐 2去 3了 4 |'))
    expect(r.score!.verseCount).toBe(1)
    expect(r.score!.measures[0].notes[0].lyrics).toEqual(['隐'])
  })
})

describe('多段歌词的排版', () => {
  const base = { maxBeams: 1, maxLowOctave: 0, maxHighOctave: 0, hasTempo: false, hasFermata: false }

  it('几段就几条基线，自上而下排', () => {
    const two = computeBands({ ...base, verseCount: 2 })
    expect(two.lyricBaselines).toHaveLength(2)
    expect(two.lyricBaselines[1]).toBeGreaterThan(two.lyricBaselines[0])
    expect(computeBands({ ...base, verseCount: 0 }).lyricBaselines).toEqual([])
  })

  it('多一段词，洞洞谱与整行都被顶下去', () => {
    const one = computeBands({ ...base, verseCount: 1 })
    const two = computeBands({ ...base, verseCount: 2 })
    expect(two.fingeringTop - one.fingeringTop).toBeCloseTo(M.lyricSize + M.lyricGap, 6)
    expect(two.systemHeight).toBeGreaterThan(one.systemHeight)
    // 歌词不能压到洞洞谱
    expect(two.lyricBaselines[1]).toBeLessThan(two.fingeringTop)
  })

  it('列宽取最长的那一段', () => {
    const short = compile(song('1长 2 3 4 |'))
    const long = compile(song('1长/好长一段词 2 3 4 |'))
    const x = (r: typeof short) => r.layout!.pages[0].systems[0].measures[0].notes[0].width
    expect(x(long)).toBeGreaterThan(x(short))
  })
})

describe('多段歌词的渲染', () => {
  it('两段词都画出来，各在各的基线上', () => {
    const svg = svgOf('1长/韶 2亭/光 3外/逝 4 |')
    const r = compile(song('1长/韶 2亭/光 3外/逝 4 |'))
    const [y1, y2] = r.layout!.bands.lyricBaselines
    expect(svg).toContain('>长<')
    expect(svg).toContain('>韶<')
    expect(svg).toContain(`y="${y1}"`)
    expect(svg).toContain(`y="${y2}"`)
  })

  it('多段时行首标段号，一段时不标', () => {
    expect(svgOf('1长/韶 2亭/光 3外/逝 4 |')).toMatch(/>1\.<\/text>[\s\S]*>2\.<\/text>/)
    expect(svgOf('1长 2亭 3外 4 |')).not.toContain('>2.</text>')
  })
})
