import { describe, expect, it } from 'vitest'

import { TUTORIAL_SECTIONS } from '../src/components/tutorialContent'
import { compile } from '../src/core/pipeline'

const SNIPPET_HEADER = '标题: 示例\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n'

const EXAMPLES = TUTORIAL_SECTIONS.flatMap((s) =>
  (s.examples ?? []).map((ex, i) => ({ id: `${s.id}#${i}`, ...ex })),
)

describe('教程示例', () => {
  it('确实有示例，而且每节标题唯一', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(10)
    const ids = TUTORIAL_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(EXAMPLES)('$id 能编译且无错误', ({ body }) => {
    const r = compile(SNIPPET_HEADER + body)
    const errors = r.issues.filter((i) => i.severity === 'error')
    expect(errors, errors.map((e) => e.message).join('; ')).toEqual([])
    expect(r.score).not.toBeNull()
    expect(r.layout).not.toBeNull()
  })

  it.each(EXAMPLES)('$id 只占一行谱（片段模式只画第一行）', ({ body }) => {
    const r = compile(SNIPPET_HEADER + body)
    expect(r.layout!.pages).toHaveLength(1)
    expect(r.layout!.pages[0].systems).toHaveLength(1)
  })

  it.each(EXAMPLES)('$id 至少画出一个音', ({ body }) => {
    const r = compile(SNIPPET_HEADER + body)
    const notes = r.score!.measures.flatMap((m) => m.notes)
    expect(notes.length).toBeGreaterThan(0)
  })

  it('讲节奏的示例每小节都凑满拍数（免得教程自己示范错的）', () => {
    for (const ex of EXAMPLES) {
      const r = compile(SNIPPET_HEADER + ex.body)
      const measures = r.score!.measures
      // 首尾小节允许不完整，这里逐个检查中间小节
      measures.slice(1, -1).forEach((m) => {
        expect(m.beats, `${ex.body} 第 ${m.index} 小节`).toBe(4)
      })
    }
  })

  it('没有遗留的警告（音域越界、调号不符之类）', () => {
    for (const ex of EXAMPLES) {
      const r = compile(SNIPPET_HEADER + ex.body)
      expect(r.issues.map((i) => `${ex.id}: ${i.message}`)).toEqual([])
    }
  })
})
