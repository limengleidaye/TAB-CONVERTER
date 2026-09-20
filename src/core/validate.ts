/**
 * 校验（需求文档 §4）。解析期的语法错误已在 parser 里产出，这里补语义层校验。
 */

import { lookupFingering } from './fingering/derive'
import { deriveKeySignature } from './fingering/derive'
import type { Issue, Score } from './types'

export function validate(score: Score): Issue[] {
  const issues: Issue[] = []
  const { 拍号, 筒音作, 筒音作Accidental, 箫调, 调号 } = score.header

  // 一拍 = 一个 unit 音符；以四分音符为 1 的内部时值需要换算
  const beatsPerMeasure = 拍号.beats * (4 / 拍号.unit)

  score.measures.forEach((m, i) => {
    const isFirst = i === 0
    const isLast = i === score.measures.length - 1
    // 首尾小节允许不完整（弱起 / 引子 / 收尾），默认不提示（§3.10）
    if (isFirst || isLast) return
    if (Math.abs(m.beats - beatsPerMeasure) > 1e-6) {
      issues.push({
        severity: 'warning',
        message: `第 ${m.index} 小节拍数为 ${fmt(m.beats)}，应为 ${fmt(beatsPerMeasure)}`,
        span: m.span,
        measureIndex: m.index,
      })
    }
  })

  // 音域校验：查表 index 越界
  for (const m of score.measures) {
    for (const n of m.notes) {
      if (n.type !== 'note') continue
      const hit = lookupFingering(n, 筒音作, 筒音作Accidental)
      if (hit.outOfRange) {
        issues.push({
          severity: 'warning',
          message: `第 ${m.index} 小节：音超出八孔箫音域（距筒音 ${hit.index} 个半音，表长 32），洞洞谱留空`,
          span: n.span,
          measureIndex: m.index,
        })
      }
    }
  }

  // 调号与 箫调 + 筒音作 的一致性
  const derived = deriveKeySignature(箫调, 筒音作, 筒音作Accidental)
  if (!derived) {
    issues.push({ severity: 'warning', message: `无法识别的「箫调:${箫调}」，调号将不显示` })
  } else if (调号) {
    const normalized = 调号.replace(/\s/g, '').replace(/b/g, '♭').replace(/#/g, '♯')
    if (normalized !== derived) {
      issues.push({
        severity: 'warning',
        message: `「调号:${调号}」与 箫调${箫调} + 筒音作${筒音作} 推导出的 ${derived} 不一致`,
      })
    }
  }

  return issues
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}
