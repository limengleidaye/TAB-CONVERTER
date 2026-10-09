import { describe, expect, it } from 'vitest'

import { buildDsl, splitDsl } from '../src/core/dsl'
import { DIZI } from '../src/core/fingering/instruments'
import { keyShifts } from '../src/core/fingering/derive'
import { compile } from '../src/core/pipeline'
import { buildTimeline } from '../src/core/playback'
import { retuneFields } from '../src/core/transpose'
import { 假如爱有天意 } from '../src/samples/catalog'
import { ScoreMode } from '../src/store/library'

const rangeWarnings = (dsl: string) =>
  compile(dsl, { instrument: DIZI }).issues.filter((i) => i.message.includes('音域'))

describe('换箫调 / 笛调时 \\key 一起挪', () => {
  it('《假如爱有天意》F 调笛换 C 调笛：三处 \\key 跟着降纯四度，不再超音域', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    fields.调号 = ''
    const next = retuneFields(fields, body, 'C')
    expect(next.fields.箫调).toBe('C')
    expect(next.body).toContain('\\key=bB')
    expect(next.body).toContain('\\key=D')
    expect(next.body).toContain('\\key=C')
    expect(next.body).not.toMatch(/\\key=(bE|G|F)\b/)
    expect(rangeWarnings(buildDsl(next.fields, next.body, '笛调'))).toEqual([])
  })

  it('不挪 \\key 时就是截图里的那 4 条超音域警告（对照组）', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    fields.调号 = ''
    expect(rangeWarnings(buildDsl({ ...fields, 箫调: 'C' }, body, '笛调'))).toHaveLength(4)
  })

  it('谱头手写的调号跟着挪', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    expect(fields.调号).toBe('1=F')
    expect(retuneFields(fields, body, 'C').fields.调号).toBe('1=C')
    expect(retuneFields(fields, body, 'G').fields.调号).toBe('1=G')
  })

  it('换过去再换回来，原样复原', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    const there = retuneFields(fields, body, 'C')
    const back = retuneFields(there.fields, there.body, 'F')
    expect(back.body).toBe(body)
    expect(back.fields).toEqual(fields)
  })

  it('注释里的 \\key 不动；认不出的调只改这一项', () => {
    const fields = { ...splitDsl('标题: x\n箫调: F\n筒音作: 5\n拍号: 4/4\n\n1 |').fields }
    const body = '// 这里 \\key=G 只是备注\n1 2 3 4 | \\key=G 5 6 7 1^ |\n'
    const next = retuneFields(fields, body, 'C')
    expect(next.body).toBe('// 这里 \\key=G 只是备注\n1 2 3 4 | \\key=D 5 6 7 1^ |\n')

    const odd = retuneFields(fields, body, 'H')
    expect(odd.fields.箫调).toBe('H')
    expect(odd.body).toBe(body)
  })
})

describe('筒音作变化时保留曲中转调的音程', () => {
  const modulatingScore = `标题: 转调测试
笛调: A
筒音作: 1
调号: 1=E
拍号: 4/4
速度: 60

5 - - - | \\key=F 5 - - - | 1 2 3 4 |
`

  it.each([
    ['先换笛调', false, false],
    ['先换筒音作', true, false],
    ['自动调号，先换笛调', false, true],
    ['自动调号，先换筒音作', true, true],
  ])('%s：A 调作 1 → E 调作 5，仍然 E → F 升半音', (_, toneFirst, autoKey) => {
    const { fields, body } = splitDsl(modulatingScore)
    if (autoKey) fields.调号 = ''
    const first = toneFirst
      ? retuneFields(fields, body, 'A', '5')
      : retuneFields(fields, body, 'E')
    const next = retuneFields(first.fields, first.body, 'E', '5')
    expect(next.fields.调号).toBe(autoKey ? '' : '1=E')
    expect(next.body).toBe(body)

    const r = compile(buildDsl(next.fields, next.body), { omitFingering: true })
    expect(r.issues).toEqual([])
    expect(r.layout!.keySignature).toBe('1=E')
    expect(r.score!.measures[1].keyChange).toBe('1=F')
    expect(keyShifts(r.score!, r.layout!.keySignature)).toEqual([0, 1, 1])

    const original = compile(buildDsl(fields, body), { omitFingering: true })
    const pitches = (result: typeof r) => buildTimeline(result.score!, result.layout!, {
      mode: ScoreMode.Jianpu,
    }).steps.map(s => s.freq)
    expect(pitches(r)).toEqual(pitches(original))
  })

  it('两项同时改变但起始调相同，不改正文或显式调号', () => {
    const { fields, body } = splitDsl(modulatingScore)
    const next = retuneFields(fields, body, 'E', '5')
    expect(next).toEqual({ fields: { ...fields, 箫调: 'E', 筒音作: '5' }, body })
  })

  it('E 调笛作 5 的实际播放在转调处升半音', () => {
    const { fields, body } = splitDsl(modulatingScore)
    const pipeChanged = retuneFields(fields, body, 'E')
    const next = retuneFields(pipeChanged.fields, pipeChanged.body, 'E', '5')
    const r = compile(buildDsl(next.fields, next.body, '笛调'), { instrument: DIZI })
    const tl = buildTimeline(r.score!, r.layout!, { mode: ScoreMode.Dizi })
    // 两处都从中音 5 开始；转调后音高应升一个半音。
    const before = tl.steps.find(s => s.measureIndex === 1 && s.freq !== null)!
    const after = tl.steps.find(s => s.measureIndex === 2 && s.freq !== null)!
    expect(after.freq! / before.freq!).toBeCloseTo(2 ** (1 / 12), 10)
  })

  it('降音筒音作参与推导，往返恢复正文，注释不变', () => {
    const { fields } = splitDsl(modulatingScore)
    fields.箫调 = 'E'
    fields.筒音作 = '5'
    const body = '// 备注 \\key=F\n1 - - - | \\key=F 1 - - - |'
    const next = retuneFields(fields, body, 'E', 'b7')
    expect(next.fields.调号).toBe('1=bD')
    expect(next.body).toBe('// 备注 \\key=F\n1 - - - | \\key=D 1 - - - |')
    expect(retuneFields(next.fields, next.body, 'E', '5')).toEqual({ fields, body })
  })

  it('无法识别筒音作时只更新字段，不破坏正文', () => {
    const { fields, body } = splitDsl(modulatingScore)
    expect(retuneFields(fields, body, 'A', '8')).toEqual({
      fields: { ...fields, 筒音作: '8' }, body,
    })
  })
})
