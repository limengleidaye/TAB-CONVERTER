/**
 * 校验（需求文档 §4）。解析期的语法错误已在 parser 里产出，这里补语义层校验。
 */

import {
  deriveKeySignature,
  keyShifts,
  keySignaturePitchClass,
  lookupFingering,
  startKeyOf,
} from './fingering/derive'
import type { Issue, Score } from './types'

export interface ValidateOptions {
  /**
   * 这份谱是不是给箫看的（要画洞洞谱）。
   * 纯简谱模式下 箫调 / 筒音作 只剩「推导调号」这一个用处，
   * 音域、调号一致性都不该再拿箫来卡——谱面上根本没有箫。
   */
  forXiao?: boolean
}

export function validate(score: Score, opts: ValidateOptions = {}): Issue[] {
  const forXiao = opts.forXiao ?? true
  const issues: Issue[] = []
  const { 筒音作, 筒音作Accidental, 箫调, 调号 } = score.header

  /** 一拍 = 一个 unit 音符；以四分音符为 1 的内部时值需要换算。曲中变拍号后逐小节算 */
  const expectedOf = (m: { meter: { beats: number; unit: number } }) =>
    m.meter.beats * (4 / m.meter.unit)

  /**
   * 拍数校验（§4.1）。豁免规则分两个方向——早先一刀切地放过首尾小节，
   * 结果把末小节里真正的笔误也一起咽了：
   *
   * - **超出**：永远警告，不豁免。弱起、引子、收尾都只会「少拍」，
   *   多出来的拍数一定是写错了。
   * - **不足**：首小节豁免（弱起 / 引子）。末小节只在**确有弱起**时豁免，
   *   因为收尾少的那部分正是开头借走的；开头是满拍却在结尾少拍，多半是漏音。
   */
  const total = score.measures.length
  const first = score.measures[0]
  const hasPickup = total > 1 && !!first && first.beats < expectedOf(first) - 1e-6

  score.measures.forEach((m, i) => {
    const beatsPerMeasure = expectedOf(m)
    const diff = m.beats - beatsPerMeasure
    if (Math.abs(diff) <= 1e-6) return

    const isFirst = i === 0
    const isLast = total > 1 && i === total - 1

    if (diff > 0) {
      issues.push({
        severity: 'warning',
        message: `第 ${m.index} 小节拍数为 ${fmt(m.beats)}，超出拍号 ${fmt(diff)} 拍`,
        span: m.span,
        measureIndex: m.index,
      })
      return
    }

    if (isFirst) return
    if (isLast && hasPickup) return

    const why = isLast ? '；开头不是弱起，结尾通常应当满拍' : ''
    issues.push({
      severity: 'warning',
      message: `第 ${m.index} 小节拍数为 ${fmt(m.beats)}，应为 ${fmt(beatsPerMeasure)}${why}`,
      span: m.span,
      measureIndex: m.index,
    })
  })

  // 下面全是箫的事：纯简谱到此为止
  if (!forXiao) {
    // 调号没写时才回落到 箫调 + 筒音作 去推，这时候箫调认不出来就真的没调号可显示了
    if (!score.header.调号 && !deriveKeySignature(箫调, 筒音作, 筒音作Accidental)) {
      issues.push({
        severity: 'warning',
        message: `没写「调号」，「箫调:${箫调}」又认不出来，谱头将不显示调号`,
      })
    }
    return issues
  }

  // 音域校验：查表 index 越界。曲中转过调的小节先折回起始调再查
  const shifts = keyShifts(score, startKeyOf(score.header))
  score.measures.forEach((m, mi) => {
    for (const n of m.notes) {
      if (n.type !== 'note') continue
      const hit = lookupFingering(n, 筒音作, 筒音作Accidental, shifts[mi])
      if (hit.outOfRange) {
        issues.push({
          severity: 'warning',
          message: `第 ${m.index} 小节：音超出八孔箫音域（距筒音 ${hit.index} 个半音，表长 32），洞洞谱留空`,
          span: n.span,
          measureIndex: m.index,
        })
      }
    }
  })

  // 调号与 箫调 + 筒音作 的一致性
  const derived = deriveKeySignature(箫调, 筒音作, 筒音作Accidental)
  if (!derived) {
    issues.push({ severity: 'warning', message: `无法识别的「箫调:${箫调}」，调号将不显示` })
  } else if (调号) {
    // 按音高比，不按字面比：1=♯C 与 1=♭D 是同一个调
    const written = keySignaturePitchClass(调号.replace(/\s/g, ''))
    if (written !== keySignaturePitchClass(derived)) {
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
