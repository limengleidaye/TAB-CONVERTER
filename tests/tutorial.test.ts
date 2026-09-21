import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TutorialDialog } from '../src/components/TutorialDialog'
import { TUTORIAL_SECTIONS } from '../src/components/tutorialContent'
import { DSL_COMMANDS } from '../src/core/commands'
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
      // 首尾小节允许不完整，这里逐个检查中间小节。
      // 拍数按小节**自己的**拍号算：讲变拍号的示例里 2/4 和 3/4 的小节本就不是 4 拍
      measures.slice(1, -1).forEach((m) => {
        const expected = m.meter.beats * (4 / m.meter.unit)
        expect(m.beats, `${ex.body} 第 ${m.index} 小节`).toBe(expected)
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

/** 渲染结果动辄几百 KB（内联了熊猫图），断言一律走布尔，别让失败时把整份 HTML 打出来 */
const html = renderToStaticMarkup(createElement(TutorialDialog, { onClose: () => {} }))
const escaped = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

describe('教程覆盖面', () => {
  it('每个 DSL 记号都在教程里有交代', () => {
    // 命令表是记号的唯一真相来源，新增一个命令却忘了写进教程，这里会挂
    for (const c of DSL_COMMANDS) {
      expect(html.includes(`\\${c.name}`), `教程里没讲 \\${c.name}`).toBe(true)
    }
  })

  it('应用本身的两块功能也有一节：播放与谱库', () => {
    const ids = TUTORIAL_SECTIONS.map((s) => s.id)
    expect(ids).toContain('play')
    expect(ids).toContain('library')
  })

  it('弹窗能整个渲染出来（目录 + 正文）', () => {
    // 带全角空格的是子章节，不进目录
    for (const s of TUTORIAL_SECTIONS.filter((x) => !x.title.startsWith('　'))) {
      expect(html.includes(escaped(s.title)), `目录里缺 ${s.title}`).toBe(true)
    }
    expect(html.includes('预备拍')).toBe(true)
    expect(html.includes('导出全部')).toBe(true)
  })
})
