import { describe, expect, it } from 'vitest'

import { parseMeter } from '../src/core/commands'
import { M } from '../src/core/layout'
import { compile } from '../src/core/pipeline'
import { buildTimeline } from '../src/core/playback'
import { renderPageSvg } from '../src/export/exporters'

/** 拼一首最小的曲子；♩=60 时一拍正好一秒，便于口算 */
function song(body: string, meter = '4/4'): string {
  return `标题: 测试\n箫调: G\n筒音作: 2\n拍号: ${meter}\n速度: 60\n\n${body}`
}

const errorsOf = (dsl: string) => compile(dsl).issues.filter((i) => i.severity === 'error')
const warningsOf = (dsl: string) => compile(dsl).issues.filter((i) => i.severity === 'warning')

describe('\\meter 写法', () => {
  it('3/4 这类分数能认出来', () => {
    expect(parseMeter('3/4')).toEqual({ beats: 3, unit: 4 })
    expect(parseMeter(' 6 / 8 ')).toEqual({ beats: 6, unit: 8 })
  })

  it('分母只能是 2 的幂——简谱的时值体系里没有「三分音符」', () => {
    expect(parseMeter('4/3')).toBeNull()
    expect(parseMeter('4/5')).toBeNull()
    expect(parseMeter('0/4')).toBeNull()
    expect(parseMeter('3')).toBeNull()
    expect(parseMeter(undefined)).toBeNull()
  })

  it('写法不对时报错，并指出正确写法', () => {
    const errs = errorsOf(song('\\meter=3 1 2 3 4 |'))
    expect(errs).toHaveLength(1)
    expect(errs[0].message).toMatch(/\\meter 要带拍号/)
  })
})

describe('曲中变拍号', () => {
  it('谱头拍号是起点，\\meter 之后的小节跟着换', () => {
    const r = compile(song('1 2 3 4 | \\meter=3/4 1 2 3 | 1 2 3 |', '4/4'))
    const ms = r.score!.measures
    expect(ms.map((m) => `${m.meter.beats}/${m.meter.unit}`)).toEqual(['4/4', '3/4', '3/4'])
    // 只有变拍号那一小节要在谱面上画出拍号
    expect(ms.map((m) => m.meterChanged)).toEqual([false, true, false])
    expect(r.issues).toEqual([])
  })

  it('拍数按各自的拍号校验，不会把另一种拍号整片标成错', () => {
    // 转 3/4 之后每小节 3 拍：旧的全局校验会把这三小节全警告一遍
    expect(warningsOf(song('1 2 3 4 | \\meter=3/4 1 2 3 | 1 2 3 | 1 2 3 |'))).toEqual([])
    // 真写错了仍然要报：3/4 的小节里塞了 4 拍
    const warns = warningsOf(song('1 2 3 4 | \\meter=3/4 1 2 3 4 | 1 2 3 |'))
    expect(warns).toHaveLength(1)
    expect(warns[0].message).toMatch(/第 2 小节拍数为 4，超出拍号 1 拍/)
  })

  it('转成 6/8 后，一小节装 3 个四分音符的量', () => {
    // 6 个八分 = 3 个四分，两种写法都满拍
    expect(warningsOf(song('1 2 3 4 | \\meter=6/8 (1 2 3) (4 5 6) |'))).toEqual([])
    expect(warningsOf(song('1 2 3 4 | \\meter=6/8 1 2 3 |'))).toEqual([])
    // 多写一个四分就超了
    const warns = warningsOf(song('1 2 3 4 | \\meter=6/8 1 2 3 4 |'))
    expect(warns).toHaveLength(1)
    expect(warns[0].message).toMatch(/超出拍号 1 拍/)
  })

  it('写在小节中间会给警告，但仍按整小节生效', () => {
    const r = compile(song('1 2 3 4 | 1 2 \\meter=3/4 3 |'))
    expect(r.score!.measures[1].meter).toEqual({ beats: 3, unit: 4 })
    const warns = r.issues.filter((i) => i.severity === 'warning')
    expect(warns).toHaveLength(1)
    expect(warns[0].message).toMatch(/写在了小节中间/)
  })

  it('弱起判定用第一小节自己的拍号', () => {
    // 2 拍弱起 + 4/4；末小节补足 2 拍，两头都不该警告
    expect(warningsOf(song('3 4 | 1 2 3 4 | \\meter=3/4 1 2 3 | 1 2 |'))).toEqual([])
  })
})

describe('变拍号的排版', () => {
  it('变拍号的小节更宽，音符往右让出字位', () => {
    const plain = compile(song('1 2 3 4 | 1 2 3 4 |'))
    const meterd = compile(song('1 2 3 4 | \\meter=4/4 1 2 3 4 |'))
    const m2 = (r: typeof plain) => r.layout!.pages[0].systems[0].measures[1]

    expect(m2(meterd).width).toBeCloseTo(m2(plain).width + M.meterW, 6)
    // 第一个音的中心被推到拍号右边
    expect(m2(meterd).notes[0].x - m2(meterd).x).toBeGreaterThan(
      m2(plain).notes[0].x - m2(plain).x,
    )
  })

  it('谱面上画出了上下叠的两个数字', () => {
    const r = compile(song('1 2 3 4 | \\meter=3/4 1 2 3 |'))
    const svg = renderPageSvg(r.score!, r.layout!, 0, { watermark: '', ambiguousPolicy: '闭' })
    const bands = r.layout!.bands
    // 分母压在数字基线上，分子紧贴其上
    expect(svg).toContain(`y="${bands.digitBaseline - M.meterSize}"`)
    expect(svg).toMatch(/>3<\/text>[\s\S]*?>4<\/text>/)
  })

  it('没变拍号的谱子不会凭空多出字位', () => {
    const a = compile(song('1 2 3 4 | 1 2 3 4 |'))
    expect(a.score!.measures.every((m) => !m.meterChanged)).toBe(true)
  })
})

describe('变拍号与播放', () => {
  it('每小节的拍点数跟着它自己的拍号走', () => {
    const r = compile(song('1 2 3 4 | \\meter=3/4 1 2 3 | 1 2 3 |'))
    const tl = buildTimeline(r.score!, r.layout!)
    // 4 + 3 + 3 拍，♩=60 每拍一秒
    expect(tl.beats.map((b) => b.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(tl.beats.map((b) => b.strong)).toEqual([
      true, false, false, false,
      true, false, false,
      true, false, false,
    ])
  })

  it('6/8 里按八分音符打拍，重拍仍落在小节头', () => {
    const r = compile(song('1 2 3 4 | \\meter=6/8 (1 2 3) (4 5 6) | (1 2 3) (4 5 6) |'))
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.beats).toHaveLength(4 + 6 + 6)
    expect(tl.beats.filter((b) => b.strong).map((b) => b.time)).toEqual([0, 4, 7])
  })

  it('弱起第一小节不敲重拍，其余小节照敲', () => {
    const r = compile(song('3 4 | 1 2 3 4 | \\meter=2/4 1 2 |'))
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.beats.filter((b) => b.strong).map((b) => b.time)).toEqual([2, 6])
  })

  it('预备拍按第一小节的拍号给', () => {
    const r = compile(song('1 2 3 | \\meter=4/4 1 2 3 4 |', '3/4'))
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.beatsPerMeasure).toBe(3)
    expect(tl.quartersPerBeat).toBe(1)
  })
})
