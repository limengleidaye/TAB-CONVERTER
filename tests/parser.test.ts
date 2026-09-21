import { describe, expect, it } from 'vitest'

import { parse } from '../src/core/parser'
import { compile } from '../src/core/pipeline'
import { 为爱追寻, 落了白 } from '../src/samples/reference'

const HEAD = `标题: T
箫调: G
筒音作: 2
拍号: 4/4

`

function notesOf(dsl: string) {
  const { score } = parse(HEAD + dsl)
  if (!score) throw new Error('解析失败')
  return score.measures.flatMap((m) => m.notes)
}

describe('头部', () => {
  it('必填字段缺失时报错', () => {
    const { score, issues } = parse('标题: T\n\n1 2 3 4 |\n')
    expect(score).toBeNull()
    expect(issues.some((i) => i.message.includes('箫调'))).toBe(true)
  })

  it('接受中文冒号', () => {
    const { score } = parse('标题：T\n箫调：G\n筒音作：2\n拍号：4/4\n\n1 2 3 4 |\n')
    expect(score?.header.标题).toBe('T')
  })

  it('速度可省略', () => {
    const { score } = parse(HEAD + '1 2 3 4 |\n')
    expect(score?.header.速度).toBeUndefined()
  })
})

describe('时值与减时线', () => {
  it('默认四分音符', () => {
    expect(notesOf('1 2 3 4 |').map((n) => n.duration)).toEqual([1, 1, 1, 1])
  })

  it('一层括号 = 八分，两层 = 十六分', () => {
    expect(notesOf('(1 2) |').map((n) => n.duration)).toEqual([0.5, 0.5])
    expect(notesOf('((1 2)) |').map((n) => n.duration)).toEqual([0.25, 0.25])
    expect(notesOf('(1 2) |').map((n) => n.beams)).toEqual([1, 1])
    expect(notesOf('((1 2)) |').map((n) => n.beams)).toEqual([2, 2])
  })

  it('混合嵌套：附点八分 + 十六分 = 一拍', () => {
    const ns = notesOf('(2. (3)) |')
    expect(ns.map((n) => n.duration)).toEqual([0.75, 0.25])
    expect(ns.map((n) => n.beams)).toEqual([1, 2])
    expect(ns.reduce((s, n) => s + n.duration, 0)).toBe(1)
  })

  it('括号决定梁分组：(1 6) (5) 与 (1 6 5) 不同', () => {
    const split = notesOf('(1 6_) (5_) |')
    expect(split[0].groupPath[0]).toBe(split[1].groupPath[0])
    expect(split[1].groupPath[0]).not.toBe(split[2].groupPath[0])

    const joined = notesOf('(1 6_ 5_) |')
    expect(joined[0].groupPath[0]).toBe(joined[2].groupPath[0])
  })

  it('延音横线跟随当前层时值', () => {
    expect(notesOf('1 - |').map((n) => n.duration)).toEqual([1, 1])
    expect(notesOf('(1 -) |').map((n) => n.duration)).toEqual([0.5, 0.5])
  })

  it('附点 ×1.5', () => {
    expect(notesOf('1. |')[0].duration).toBe(1.5)
  })
})

describe('音高', () => {
  it('八度后缀可叠加', () => {
    expect(notesOf('5^ 5 5_ 5__ |').map((n) => n.octave)).toEqual([1, 0, -1, -2])
  })

  it('升降还原前缀', () => {
    expect(notesOf('#5 b5 n5 |').map((n) => n.accidental)).toEqual(['#', 'b', 'n'])
  })

  it('休止符', () => {
    const ns = notesOf('0 1 |')
    expect(ns[0].type).toBe('rest')
    expect(ns[1].type).toBe('note')
  })
})

describe('歌词', () => {
  it('内联中文紧跟音符', () => {
    expect(notesOf('1隐 2去 |').map((n) => n.lyrics?.[0])).toEqual(['隐', '去'])
  })

  it('一个音可带多字', () => {
    expect(notesOf('5离别 |')[0].lyrics).toEqual(['离别'])
  })

  it('引号包裹拉丁词块', () => {
    expect(notesOf('5"la la" |')[0].lyrics).toEqual(['la la'])
  })

  it('拖腔：后续音不写字', () => {
    const ns = notesOf('(1解 6_) |')
    expect(ns[0].lyrics).toEqual(['解'])
    expect(ns[1].lyrics).toBeUndefined()
  })

  it('休止符带歌词报错', () => {
    const { issues } = parse(HEAD + '0隐 |')
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('休止符'))).toBe(true)
  })
})

describe('延音线与圆滑线', () => {
  it('后缀 ~ 连到下一个同音：后者不重新起吹', () => {
    const ns = notesOf('3~ 3 |')
    expect(ns[0].tieToNext).toBe(true)
    expect(ns[1].tiedFromPrev).toBe(true)
  })

  it('~ 可跨梁分组', () => {
    const ns = notesOf('(2. (3~)) (3 6_) |')
    expect(ns[1].tieToNext).toBe(true)
    expect(ns[2].tiedFromPrev).toBe(true)
  })

  it('~ 连接不同音高时告警且不当 tie', () => {
    const { issues } = parse(HEAD + '3~ 5 |')
    expect(issues.some((i) => i.message.includes('音高不同'))).toBe(true)
  })

  it('大括号内相邻同音自动按 tie 处理', () => {
    const ns = notesOf('{3 3} |')
    expect(ns[1].tiedFromPrev).toBe(true)
  })

  it('大括号内不同音高是圆滑线，两个音都照常起吹', () => {
    const ns = notesOf('{6_ 5_} |')
    expect(ns[0].slurStart).toBe(true)
    expect(ns[1].slurEnd).toBe(true)
    expect(ns[1].tiedFromPrev).toBe(false)
  })

  it('大括号未闭合报错', () => {
    const { issues } = parse(HEAD + '{3 3 |')
    expect(issues.some((i) => i.message.includes('"{" 未闭合'))).toBe(true)
  })
})

describe('倚音', () => {
  it('挂在主音上且不占时值', () => {
    const ns = notesOf('<3 2>3 - - |')
    expect(ns).toHaveLength(3)
    expect(ns[0].graces?.map((g) => g.degree)).toEqual([3, 2])
    expect(ns.reduce((s, n) => s + n.duration, 0)).toBe(3)
  })
})

describe('三连音', () => {
  it('一拍内均分', () => {
    const ns = notesOf('3:{1 2 3} |')
    expect(ns.map((n) => n.duration)).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(ns[0].tupletStart).toBe(3)
  })

  it('外层括号降一档时值', () => {
    const ns = notesOf('(3:{1 2 3}) |')
    expect(ns[0].duration).toBeCloseTo(1 / 6)
  })

  it('音数不符报错', () => {
    const { issues } = parse(HEAD + '3:{1 2} |')
    expect(issues.some((i) => i.message.includes('3 连音组'))).toBe(true)
  })
})

describe('变速', () => {
  it('速度=88 挂在其后第一个音上', () => {
    const ns = notesOf('1 速度=88 2 |')
    expect(ns[0].tempoMark).toBeUndefined()
    expect(ns[1].tempoMark).toEqual({ kind: 'bpm', bpm: 88 })
  })

  it('渐慢 / 原速 / rit. 等价识别', () => {
    expect(notesOf('渐慢 1 |')[0].tempoMark?.kind).toBe('rit')
    expect(notesOf('rit. 1 |')[0].tempoMark?.kind).toBe('rit')
    expect(notesOf('原速 1 |')[0].tempoMark?.kind).toBe('atempo')
    expect(notesOf('渐快 1 |')[0].tempoMark?.kind).toBe('accel')
  })

  it('延长记号作用在前一个音上', () => {
    const ns = notesOf('1 延长 2 |')
    expect(ns[0].fermata).toBe(true)
    expect(ns[1].fermata).toBeFalsy()
  })

  it('变速不占拍数', () => {
    const { score } = parse(HEAD + '1 渐慢 2 3 4 |')
    expect(score!.measures[0].beats).toBe(4)
  })
})

describe('小节与结构记号', () => {
  it('终止线', () => {
    const { score } = parse(HEAD + '1 2 3 4 ||')
    expect(score!.measures[0].closeBarline).toBe('final')
  })

  it('反复记号', () => {
    const { score } = parse(HEAD + '|: 1 2 3 4 :|')
    expect(score!.measures[0].openBarline).toBe('repeatStart')
    expect(score!.measures[0].closeBarline).toBe('repeatEnd')
  })

  it('房子', () => {
    const { score } = parse(HEAD + '[1. 1 2 3 4 | [2. 5 6 7 1^ |')
    expect(score!.measures[0].volta).toBe(1)
    expect(score!.measures[1].volta).toBe(2)
  })

  it('注释被忽略', () => {
    const { score } = parse(HEAD + '// 这行是注释\n1 2 3 4 |')
    expect(score!.measures[0].notes).toHaveLength(4)
  })

  it('无法识别的记号报错', () => {
    const { issues } = parse(HEAD + '1 2 XYZ 4 |')
    expect(issues.some((i) => i.message.includes('无法识别'))).toBe(true)
  })
})

describe('校验', () => {
  it('中间小节拍数不符给警告', () => {
    const r = compile(HEAD + '1 2 3 4 | 1 2 3 | 1 2 3 4 |')
    expect(r.issues.some((i) => i.severity === 'warning' && i.message.includes('第 2 小节拍数为 3'))).toBe(
      true,
    )
  })

  it('弱起：首小节不足 + 末小节不足，都不提示', () => {
    const r = compile(HEAD + '1 2 | 1 2 3 4 | 1 2 |')
    expect(r.issues.filter((i) => i.message.includes('小节拍数'))).toHaveLength(0)
  })

  it('超出拍号一律警告，首尾也不豁免', () => {
    const first = compile(HEAD + '1 2 3 4 5 | 1 2 3 4 |')
    expect(first.issues.some((i) => i.message.includes('第 1 小节拍数为 5，超出拍号 1 拍'))).toBe(true)

    const last = compile(HEAD + '1 2 3 4 | 5 3 2 1 1 - - - ||')
    expect(last.issues.some((i) => i.message.includes('第 2 小节拍数为 8，超出拍号 4 拍'))).toBe(true)
  })

  it('开头不是弱起时，末小节不足也要警告', () => {
    const r = compile(HEAD + '1 2 3 4 | 1 2 3 4 | 5 2 1 ||')
    const w = r.issues.find((i) => i.message.includes('第 3 小节'))
    expect(w?.message).toContain('应为 4')
    expect(w?.message).toContain('开头不是弱起')
  })

  it('有弱起时，末小节不足不提示', () => {
    const r = compile(HEAD + '1 | 1 2 3 4 | 5 2 1 ||')
    expect(r.issues.filter((i) => i.message.includes('小节拍数'))).toHaveLength(0)
  })

  it('单小节乐谱：少拍豁免，多拍照样警告', () => {
    expect(compile(HEAD + '1 2 |').issues.filter((i) => i.message.includes('小节拍数'))).toHaveLength(0)
    expect(compile(HEAD + '1 2 3 4 5 |').issues.some((i) => i.message.includes('超出拍号'))).toBe(true)
  })

  it('标黄的小节号跟着警告走', () => {
    const r = compile(HEAD + '1 2 3 4 | 1 2 3 4 | 5 2 1 ||')
    expect(r.warnMeasures.has(3)).toBe(true)
    expect(r.warnMeasures.has(1)).toBe(false)
  })

  it('调号与箫调+筒音作不符时告警', () => {
    const r = compile('标题: T\n箫调: G\n筒音作: 2\n调号: 1=D\n拍号: 4/4\n\n1 2 3 4 |')
    expect(r.issues.some((i) => i.message.includes('不一致'))).toBe(true)
  })

  it('音域越界告警', () => {
    const r = compile(HEAD + '1__ 2 3 4 |')
    expect(r.issues.some((i) => i.message.includes('音域'))).toBe(true)
  })
})

describe('验收样例', () => {
  it('《落了白》：17 小节，有歌词，末小节终止线', () => {
    const r = compile(落了白)
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.score!.measures).toHaveLength(17)
    expect(r.score!.verseCount).toBe(1)
    expect(r.score!.measures.at(-1)!.closeBarline).toBe('final')
  })

  it('《落了白》：第 1 小节是 2 拍弱起，其余均为 4 拍', () => {
    const r = compile(落了白)
    const beats = r.score!.measures.map((m) => m.beats)
    expect(beats[0]).toBe(2)
    expect(r.score!.measures[0].notes.every((n) => n.type === 'rest')).toBe(true)
    beats.forEach((b, i) => {
      if (i !== 0) expect(b, `第 ${i + 1} 小节`).toBe(4)
    })
  })

  it('《落了白》：无警告（首小节不完整属豁免）', () => {
    const r = compile(落了白)
    expect(r.issues).toEqual([])
  })

  it('《落了白》：倚音落在第 13 小节的 3 上', () => {
    const r = compile(落了白)
    const m13 = r.score!.measures[12]
    expect(m13.notes[0].graces?.map((g) => g.degree)).toEqual([3, 2])
    expect(m13.notes[0].lyrics).toEqual(['奈'])
  })

  it('《为爱追寻》：9 小节，无歌词，每小节 4 拍', () => {
    const r = compile(为爱追寻)
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.score!.measures).toHaveLength(9)
    expect(r.score!.verseCount).toBe(0)
    for (const m of r.score!.measures) expect(m.beats, `第 ${m.index} 小节`).toBe(4)
  })

  it('《为爱追寻》：被 tie 连到的音不画指法列', () => {
    const r = compile(为爱追寻)
    // 第 2 小节：2. 3~ 3 6_ 1. 2~ 2 3 → 8 个音，2 个被 tie，画 6 列
    const sys = r.layout!.pages[0].systems
    const m2 = sys.flatMap((s) => s.measures).find((lm) => lm.measure.index === 2)!
    expect(m2.notes).toHaveLength(8)
    expect(m2.notes.filter((n) => n.showFingering)).toHaveLength(6)
  })

  it('《为爱追寻》：整首的指法列数与原图一致（14 / 16 / 14）', () => {
    const r = compile(为爱追寻)
    const perMeasure = r.layout!.pages[0].systems
      .flatMap((s) => s.measures)
      .sort((a, b) => a.measure.index - b.measure.index)
      .map((lm) => lm.notes.filter((n) => n.showFingering).length)
    expect(perMeasure).toEqual([2, 6, 6, 6, 5, 5, 6, 6, 2])
  })

  it('两首曲子的调号都推导为 1=C', () => {
    expect(compile(落了白).layout!.keySignature).toBe('1=C')
    expect(compile(为爱追寻).layout!.keySignature).toBe('1=C')
  })
})

describe('反斜杠命令', () => {
  it('变速命令', () => {
    expect(notesOf('\\rit 1 |')[0].tempoMark?.kind).toBe('rit')
    expect(notesOf('\\accel 1 |')[0].tempoMark?.kind).toBe('accel')
    expect(notesOf('\\atempo 1 |')[0].tempoMark?.kind).toBe('atempo')
    expect(notesOf('\\tempo=96 1 |')[0].tempoMark).toEqual({ kind: 'bpm', bpm: 96 })
  })

  it('\\fermata 作用在前一个音上，且与变速记号互不覆盖', () => {
    const ns = notesOf('1 \\fermata 2 |')
    expect(ns[0].fermata).toBe(true)
    expect(ns[1].fermata).toBeFalsy()

    // 同一个音同时带变速和延长时，两者都要保住
    const both = notesOf('1 \\tempo=60 2 \\fermata 3 4 |')
    expect(both[1].tempoMark).toEqual({ kind: 'bpm', bpm: 60 })
    expect(both[1].fermata).toBe(true)
  })

  it('段落命令进入所在小节的 marks', () => {
    const { score } = parse(HEAD + '1 2 3 4 \\fine | \\segno 5 6 7 1^ \\dc ||')
    expect(score!.measures[0].marks).toEqual(['Fine'])
    expect(score!.measures[1].marks).toEqual(['Segno', 'D.C.'])
  })

  it('命令不占拍数', () => {
    const { score } = parse(HEAD + '\\segno 1 \\rit 2 3 4 \\fine |')
    expect(score!.measures[0].beats).toBe(4)
  })

  it('未知命令报错并定位', () => {
    const { issues } = parse(HEAD + '1 \\nope 2 3 4 |')
    const err = issues.find((i) => i.severity === 'error')
    expect(err?.message).toContain('未知命令')
    expect(err?.span).toBeDefined()
  })

  it('\\tempo 不带数值报错', () => {
    const { issues } = parse(HEAD + '\\tempo 1 2 3 4 |')
    expect(issues.some((i) => i.message.includes('\\tempo 要带数值'))).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(notesOf('\\RIT 1 |')[0].tempoMark?.kind).toBe('rit')
  })

  it('旧的中文写法仍然兼容', () => {
    expect(notesOf('渐慢 1 |')[0].tempoMark?.kind).toBe('rit')
    expect(notesOf('速度=88 1 |')[0].tempoMark).toEqual({ kind: 'bpm', bpm: 88 })
  })
})
