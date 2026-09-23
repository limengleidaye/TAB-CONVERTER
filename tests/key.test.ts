import { describe, expect, it } from 'vitest'

import { parseKey } from '../src/core/commands'
import { keyShifts } from '../src/core/fingering/derive'
import { compile } from '../src/core/pipeline'
import { buildTimeline } from '../src/core/playback'
import { renderPageSvg } from '../src/export/exporters'

/** G 调箫筒音作2 → 起始调 1=C；♩=60 */
function song(body: string, head = '箫调: G\n筒音作: 2'): string {
  return `标题: 测试\n${head}\n拍号: 4/4\n速度: 60\n\n${body}`
}

const errorsOf = (dsl: string) => compile(dsl).issues.filter((i) => i.severity === 'error')
const warningsOf = (dsl: string, jianpu = false) =>
  compile(dsl, { omitFingering: jianpu }).issues.filter((i) => i.severity === 'warning')

describe('\\key 写法', () => {
  it('升降号写在字母前后、ASCII 或乐谱符号都认，统一规范成 1=♭E', () => {
    expect(parseKey('G')).toBe('1=G')
    expect(parseKey('bE')).toBe('1=♭E')
    expect(parseKey('Eb')).toBe('1=♭E')
    expect(parseKey('♭E')).toBe('1=♭E')
    expect(parseKey('#C')).toBe('1=♯C')
    expect(parseKey('c')).toBe('1=C')
  })

  it('认不出的调名返回 null', () => {
    expect(parseKey('H')).toBeNull()
    expect(parseKey('bEb')).toBeNull()
    expect(parseKey('')).toBeNull()
    expect(parseKey(undefined)).toBeNull()
  })

  it('写法不对时报错，并指出正确写法', () => {
    for (const bad of ['\\key 1 2 3 4 |', '\\key=3 1 2 3 4 |', '\\key=Hb 1 2 3 4 |']) {
      const errs = errorsOf(song(bad))
      expect(errs.length, bad).toBeGreaterThan(0)
      expect(errs.map((e) => e.message).join(), bad).toMatch(/\\key 要带调名/)
    }
  })

  it('\\key=G 后面紧跟音符时，调名不会把音符吞掉', () => {
    const r = compile(song('\\key=G 1 2 3 4 |'))
    expect(r.issues).toEqual([])
    expect(r.score!.measures[0].notes).toHaveLength(4)
  })
})

describe('曲中转调', () => {
  it('转调挂在写它的那一小节上，只有那一小节带', () => {
    const r = compile(song('1 2 3 4 | \\key=bE 1 2 3 4 | 1 2 3 4 |'))
    expect(r.score!.measures.map((m) => m.keyChange)).toEqual([undefined, '1=♭E', undefined])
  })

  it('就近换算：1=F 转 G 是 +2，转 ♭E 是 −2，不是 +10', () => {
    const r = compile(
      song('1 - - - | \\key=G 1 - - - | 1 - - - | \\key=bE 1 - - - |', '箫调: F\n筒音作: 5'),
    )
    expect(keyShifts(r.score!, r.layout!.keySignature)).toEqual([0, 2, 2, -2])
  })

  it('简谱播放：主音跟着挪', () => {
    const src = `标题: 测试\n调号: 1=F\n箫调: F\n筒音作: 5\n拍号: 4/4\n速度: 60\n\n1 - - - | \\key=G 1 - - - | \\key=bE 1 - - - |`
    const r = compile(src, { omitFingering: true })
    const tl = buildTimeline(r.score!, r.layout!, { mode: 'jianpu' })
    const freqs = tl.steps.map((s) => s.freq!)
    expect(freqs[0]).toBeCloseTo(349.23, 1) // F4
    expect(freqs[1]).toBeCloseTo(392.0, 1) // G4
    expect(freqs[2]).toBeCloseTo(311.13, 1) // ♭E4
  })

  it('箫播放与指法：唱名折回起始调再查表，实际音高和简谱口径一致', () => {
    // G 调箫筒音作2（1=C），转 1=G 后的 1 就是起始调的 5
    const r = compile(song('5 - - - | \\key=G 1 - - - |'))
    const [a, b] = r.layout!.pages[0].systems[0].measures.map((lm) => lm.notes[0].fingering!)
    expect(b.index).toBe(a.index - 12) // 就近：G 在 C 下方纯四度，1=G 的 1 比 1=C 的 5 低八度
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.steps[1].freq!).toBeCloseTo(tl.steps[0].freq! / 2, 1)
  })

  it('音域校验也按转调后的实际音高算', () => {
    // 1=C 起，转 1=♭E（+3）：中音 1 仍在音域内，倍高音 6 则超出
    expect(warningsOf(song('1 2 3 4 | \\key=bE 1 2 3 4 |'))).toEqual([])
    const w = warningsOf(song('1 2 3 4 | \\key=bE 6^^ 6^^ 6^^ 6^^ |'))
    expect(w.map((i) => i.message).join()).toMatch(/超出八孔箫音域/)
  })

  it('写在小节中间给警告，按整小节生效', () => {
    const r = compile(song('1 2 \\key=G 3 4 | 1 2 3 4 |'))
    expect(r.issues.map((i) => i.message).join()).toMatch(/转调写在了小节中间/)
    expect(r.score!.measures[0].keyChange).toBe('1=G')
  })

  it('谱面在转调那一小节标出新调号', () => {
    const r = compile(song('1 2 3 4 | \\key=bE 1 2 3 4 |'))
    const svg = renderPageSvg(r.score!, r.layout!, 0, { watermark: '', ambiguousPolicy: '闭' })
    expect(svg).toContain('1=♭E')
  })
})

describe('调号一致性按音高比', () => {
  it('1=♯C 与箫调推出的 1=♭D 是同一个调，不报不一致', () => {
    // ♭B 调箫筒音 F，筒音作3 → 1=♭D
    const head = '箫调: bB\n筒音作: 3\n调号: 1=#C'
    expect(warningsOf(song('1 2 3 4 |', head))).toEqual([])
  })
})
