import { describe, expect, it } from 'vitest'

import { M } from '../src/core/layout'
import { compile } from '../src/core/pipeline'
import {
  DEFAULT_BPM,
  FERMATA_FACTOR,
  buildTimeline,
  cursorAt,
  slideCursorAt,
  stepIndexAt,
  type Timeline,
} from '../src/core/playback'
import { 落了白 } from '../src/samples/reference'

/** 拼一首最小的曲子；默认 G 调箫、筒音作 2、4/4、♩=60（一拍正好一秒，便于口算） */
function line(body: string, header = ''): Timeline {
  const dsl = `标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n${header}\n\n${body}`
  const r = compile(dsl)
  expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
  return buildTimeline(r.score!, r.layout!)
}

describe('时值 → 时间', () => {
  it('♩=60 时，一拍就是一秒', () => {
    const tl = line('1 2 3 4 |')
    expect(tl.steps).toHaveLength(4)
    expect(tl.steps.map((s) => s.start)).toEqual([0, 1, 2, 3])
    expect(tl.duration).toBeCloseTo(4)
  })

  it('减时线与附点按谱面时值走', () => {
    const tl = line('(1 2) 3. 4 0 |')
    expect(tl.steps.map((s) => s.duration)).toEqual([0.5, 0.5, 1.5, 1, 1])
  })

  it('延音横线并进前一个音，不单独起一步', () => {
    const tl = line('1 - - - |')
    expect(tl.steps).toHaveLength(1)
    expect(tl.steps[0].duration).toBeCloseTo(4)
    expect(tl.steps[0].covers).toHaveLength(4)
  })

  it('延音线连过去的同音不重新起吹', () => {
    const tl = line('1~ 1 2 3 |')
    expect(tl.steps).toHaveLength(3)
    expect(tl.steps[0].duration).toBeCloseTo(2)
  })

  it('休止符照样占一步，但没有指法也没有音高', () => {
    const tl = line('0 1 2 3 |')
    expect(tl.steps[0].holes).toBeNull()
    expect(tl.steps[0].freq).toBeNull()
    expect(tl.steps[0].duration).toBeCloseTo(1)
  })

  it('\\fermata 按二倍时值延长', () => {
    const tl = line('1 2 3 4 \\fermata |')
    expect(tl.steps[3].duration).toBeCloseTo(FERMATA_FACTOR)
  })
})

describe('变速', () => {
  it('\\tempo= 从该音起突变', () => {
    const tl = line('1 2 \\tempo=120 3 4 |')
    expect(tl.steps.map((s) => s.bpm)).toEqual([60, 60, 120, 120])
    expect(tl.duration).toBeCloseTo(1 + 1 + 0.5 + 0.5)
  })

  it('\\atempo 回到变速前的速度', () => {
    const tl = line('1 \\tempo=120 2 \\atempo 3 |')
    expect(tl.steps.map((s) => s.bpm)).toEqual([60, 120, 60])
  })

  it('accel. 渐快、rit. 渐慢，到下一个变速记号处收敛到 ±30%', () => {
    const up = line('1 \\accel 2 3 4 \\atempo 1 |')
    const bpms = up.steps.map((s) => s.bpm)
    expect(bpms[0]).toBe(60)
    expect(bpms[1]).toBeGreaterThan(60)
    expect(bpms[2]).toBeGreaterThan(bpms[1])
    expect(bpms[3]).toBeCloseTo(60 * 1.3, 6) // 渐变段的最后一个音正好到目标
    expect(bpms[4]).toBe(60) // a tempo 收回

    const down = line('1 \\rit 2 3 4 |')
    expect(down.steps[3].bpm).toBeCloseTo(60 * 0.7, 6)
  })

  it('渐变幅度可调', () => {
    const r = compile(`标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n1 \\rit 2 3 4 |`)
    const tl = buildTimeline(r.score!, r.layout!, { rampAmount: 0.5 })
    expect(tl.steps[3].bpm).toBeCloseTo(30, 6)
  })

  it('谱头没写速度时用兜底 BPM，并如实报告', () => {
    const r = compile(`标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n1 2 3 4 |`)
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.headerBpm).toBeNull()
    expect(tl.baseBpm).toBe(DEFAULT_BPM)
  })

  it('播放窗给的 baseBpm 盖过谱头', () => {
    const r = compile(`标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n1 2 3 4 |`)
    const tl = buildTimeline(r.score!, r.layout!, { baseBpm: 120 })
    expect(tl.duration).toBeCloseTo(2)
    expect(tl.headerBpm).toBe(60)
  })
})

describe('反复展开', () => {
  it('|: :| 播两遍，第二遍的步带 pass=2', () => {
    const tl = line('|: 1 2 3 4 :| 5 6 7 1^ |')
    expect(tl.steps).toHaveLength(12)
    expect(tl.steps.map((s) => s.pass)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1])
    expect(tl.expanded).toBe(true)
  })

  it('房子号按遍数取舍：一房只在第一遍、二房只在第二遍', () => {
    const tl = line('|: 1 2 3 4 | [1. 5 5 5 5 :| [2. 6 6 6 6 |')
    const seq = tl.steps.map((s) => `${s.ev.degree}/${s.pass}`)
    expect(seq).toEqual([
      '1/1', '2/1', '3/1', '4/1',
      '5/1', '5/1', '5/1', '5/1',
      '1/2', '2/2', '3/2', '4/2',
      '6/1', '6/1', '6/1', '6/1',
    ])
  })

  it('没写 |: 时按惯例从曲子开头回跳', () => {
    const tl = line('1 2 3 4 :| 5 5 5 5 |')
    expect(tl.steps.map((s) => s.ev.degree)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 5, 5, 5, 5])
  })

  it('关掉展开就按书写顺序播一遍', () => {
    const r = compile(`标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n|: 1 2 3 4 :|`)
    const tl = buildTimeline(r.score!, r.layout!, { expandRepeats: false })
    expect(tl.steps).toHaveLength(4)
    expect(tl.expanded).toBe(false)
  })
})

describe('节拍点', () => {
  it('4/4 每小节四响，重拍落在小节头', () => {
    const tl = line('1 2 3 4 | 5 5 5 5 |')
    expect(tl.beats).toHaveLength(8)
    expect(tl.beats.map((b) => b.strong)).toEqual([true, false, false, false, true, false, false, false])
    expect(tl.beats.map((b) => b.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('长音内部照样打拍', () => {
    const tl = line('1 - - - |')
    expect(tl.beats.map((b) => b.time)).toEqual([0, 1, 2, 3])
  })

  it('弱起小节不会把重拍数错位', () => {
    const tl = line('3 4 | 1 2 3 4 |')
    // 弱起两拍 → 第一个重拍在第 2 秒（第 2 小节头）
    expect(tl.beats.filter((b) => b.strong).map((b) => b.time)).toEqual([2])
  })

  it('6/8 拍按八分音符打拍', () => {
    const r = compile(`标题: 测试\n箫调: G\n筒音作: 2\n拍号: 6/8\n速度: 60\n\n(1 2 3) (4 5 6) |`)
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.beats).toHaveLength(6)
    expect(tl.quartersPerBeat).toBe(0.5)
  })
})

describe('音高', () => {
  it('G 调箫筒音作 2：低音 2 就是筒音 D4', () => {
    const tl = line('2_ 1 2 3 |')
    expect(tl.steps[0].freq!).toBeCloseTo(293.66, 1)
  })

  it('高八度正好翻一倍', () => {
    const tl = line('2_ 2 3 4 |')
    expect(tl.steps[1].freq! / tl.steps[0].freq!).toBeCloseTo(2, 6)
  })

  it('F 调箫的筒音是 C4', () => {
    const r = compile(`标题: 测试\n箫调: F\n筒音作: 5\n拍号: 4/4\n速度: 60\n\n5_ 1 2 3 |`)
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.steps[0].freq!).toBeCloseTo(261.63, 1)
  })

  it('箫调认不出来就不发声，画面照常', () => {
    const r = compile(`标题: 测试\n箫调: 火星调\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n1 2 3 4 |`)
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.steps.every((s) => s.freq === null)).toBe(true)
    expect(tl.steps).toHaveLength(4)
  })
})

describe('方框', () => {
  it('罩住的是简谱数字那一带，且比数字宽', () => {
    const tl = line('1 2 3 4 |')
    const r = compile(`标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n1 2 3 4 |`)
    const bands = r.layout!.bands
    // 方框是页坐标，要把所在行的行首 y 加上再比
    const sysY = r.layout!.pages[0].systems[0].y
    const box = tl.steps[0].box
    expect(box.page).toBe(0)
    expect(box.w).toBeGreaterThan(M.digitHalfW * 2)
    expect(box.y).toBeLessThan(sysY + bands.digitBaseline)
    expect(box.y + box.h).toBeGreaterThan(sysY + bands.digitsBottom)
  })

  it('长音的方框横向罩住整段延音横线', () => {
    const tl = line('1 - - - |')
    const short = line('1 2 3 4 |')
    expect(tl.steps[0].box.w).toBeGreaterThan(short.steps[0].box.w * 2)
  })
})

describe('定位', () => {
  it('二分查找与步内进度对得上', () => {
    const tl = line('1 2 3 4 |')
    expect(stepIndexAt(tl, 0)).toBe(0)
    expect(stepIndexAt(tl, 2.5)).toBe(2)
    expect(stepIndexAt(tl, 99)).toBe(3)
    expect(cursorAt(tl, 2.5)).toBeCloseTo(2.5)
    expect(cursorAt(tl, -1)).toBe(0)
  })
})

describe('洞洞谱条的滑动', () => {
  it('一个音的绝大部分时间停着不动，只在末尾滑走', () => {
    const tl = line('1 2 3 4 |') // ♩=60，每个音一秒
    expect(slideCursorAt(tl, 0)).toBe(0)
    expect(slideCursorAt(tl, 0.5)).toBe(0) // 半秒过去了还稳稳停在中间
    expect(slideCursorAt(tl, 0.8)).toBe(0) // 0.16 秒的滑动段之前都不动
    expect(slideCursorAt(tl, 0.92)).toBeGreaterThan(0)
    expect(slideCursorAt(tl, 0.92)).toBeLessThan(1)
    expect(slideCursorAt(tl, 1)).toBeCloseTo(1, 6)
  })

  it('滑动段两头平滑，中间最快（smoothstep）', () => {
    const tl = line('1 2 3 4 |')
    const a = slideCursorAt(tl, 0.86) - slideCursorAt(tl, 0.84)
    const b = slideCursorAt(tl, 0.93) - slideCursorAt(tl, 0.91)
    expect(b).toBeGreaterThan(a) // 起步慢
  })

  it('十六分音符不会整个音都在动：滑动段按比例压缩', () => {
    const tl = line('((1 2 3 4)) 2 3 4 |') // 每个十六分 0.25 秒
    const st = tl.steps[0]
    expect(st.duration).toBeCloseTo(0.25)
    expect(slideCursorAt(tl, 0.1)).toBe(0) // 静止段仍占一半以上
    expect(slideCursorAt(tl, st.duration)).toBeCloseTo(1, 6)
  })

  it('线性进度另有其人，两者互不干扰', () => {
    const tl = line('1 2 3 4 |')
    expect(cursorAt(tl, 0.5)).toBeCloseTo(0.5)
    expect(slideCursorAt(tl, 0.5)).toBe(0)
  })
})

describe('整首样例', () => {
  it('落了白：每一步都排得出位置，总时长有限且递增', () => {
    const r = compile(落了白)
    const tl = buildTimeline(r.score!, r.layout!, { baseBpm: 66 })
    expect(tl.steps.length).toBeGreaterThan(50)
    expect(tl.duration).toBeGreaterThan(30)
    for (let i = 1; i < tl.steps.length; i++) {
      expect(tl.steps[i].start).toBeGreaterThan(tl.steps[i - 1].start - 1e-9)
      expect(tl.steps[i].duration).toBeGreaterThan(0)
      expect(tl.steps[i].box.w).toBeGreaterThan(0)
    }
    // 带歌词的谱子每个音都画指法，除了被延音线连过去的
    expect(tl.steps.filter((s) => s.holes).length).toBeGreaterThan(40)
  })
})
