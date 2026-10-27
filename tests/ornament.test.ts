import { describe, expect, it } from 'vitest'

import { compile } from '../src/core/pipeline'
import { buildTimeline } from '../src/core/playback'
import { 牵丝戏和声 } from '../src/samples/catalog'

const HEAD = '标题: T\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n'

function notesOf(body: string) {
  const r = compile(HEAD + body)
  expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
  return r.score!.measures.flatMap((m) => m.notes)
}

describe('装饰记号', () => {
  it('加在前一个音上，可以叠', () => {
    const ns = notesOf('3\\tr <5>1\\gliss\\mordent 2\\flutter 6_ |')
    expect(ns.map((n) => n.ornaments)).toEqual([['tr'], ['glissIn', 'mordent'], ['flutter'], undefined])
  })

  it('音尾历音可以挂在延音横线上', () => {
    const ns = notesOf('3 - \\glissout - - |')
    expect(ns[1].type).toBe('dash')
    expect(ns[1].ornaments).toEqual(['glissOut'])
  })

  it('前面没有音时给警告', () => {
    const r = compile(HEAD + '\\tr 1 2 3 4 |')
    expect(r.issues.some((i) => i.severity === 'warning' && i.message.includes('\\tr'))).toBe(true)
  })

  it('只画不响：播放时间线和不写装饰时一模一样', () => {
    const timeline = (body: string) => {
      const r = compile(HEAD + body)
      return buildTimeline(r.score!, r.layout!).steps.map((s) => [s.start, s.duration])
    }
    expect(timeline('3\\tr <5>1\\gliss 2\\flutter 6_ - \\glissout |')).toEqual(timeline('3 <5>1 2 6_ - |'))
  })

  it('有 tr / 波音 / 花舌才给上方留一条带；历音不占这条带', () => {
    const top = (body: string) => compile(HEAD + body).layout!.bands.digitBaseline
    expect(top('1\\tr 2 3 4 |')).toBeGreaterThan(top('1 2 3 4 |'))
    expect(top('<5>1\\gliss 2 3 4 \\glissout |')).toBe(top('1 2 3 4 |'))
  })

  it('《牵丝戏》和声按 D 调笛排得出来，每小节四拍、没有报错', () => {
    const r = compile(牵丝戏和声)
    expect(r.issues).toEqual([])
    expect(r.score!.measures).toHaveLength(24)
    for (const m of r.score!.measures) expect(m.beats, `第 ${m.index} 小节`).toBe(4)
  })
})
