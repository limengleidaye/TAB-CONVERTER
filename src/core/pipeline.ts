/**
 * 纯函数管线：DSL 文本 → AST → 校验 → 布局模型。
 * UI 只消费本模块的输出。
 */

import { deriveKeySignature } from './fingering/derive'
import { layout, type Layout } from './layout'
import { parse } from './parser'
import type { Issue, Score } from './types'
import { validate } from './validate'

export interface CompileResult {
  score: Score | null
  layout: Layout | null
  issues: Issue[]
  /** 需要标黄的小节号 */
  warnMeasures: Set<number>
}

export function compile(src: string): CompileResult {
  const { score, issues } = parse(src)
  if (!score) return { score: null, layout: null, issues, warnMeasures: new Set() }

  const semantic = validate(score)
  const all = [...issues, ...semantic]

  const keySignature = score.header.调号
    ? score.header.调号.replace(/\s/g, '').replace(/b/g, '♭').replace(/#/g, '♯')
    : deriveKeySignature(score.header.箫调, score.header.筒音作, score.header.筒音作Accidental)

  const warnMeasures = new Set<number>()
  for (const issue of all) {
    if (issue.measureIndex !== undefined) warnMeasures.add(issue.measureIndex)
  }

  return { score, layout: layout(score, keySignature), issues: all, warnMeasures }
}
