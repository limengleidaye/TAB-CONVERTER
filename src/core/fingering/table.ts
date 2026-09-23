/**
 * 八孔箫权威指法表（转录自 八孔洞箫指法表.md）。
 *
 * 表以「距筒音的半音数」为索引（index = 音位号 − 1），与「筒音作X」无关：
 * 筒音作法只改变唱名标签，不改变指法本身（需求文档 §2）。
 *
 * 存储：每个孔位一个 0–3 的小整数（见 Hole），整表为 32 × Uint8Array(8)。
 * 源字面量按「每个孔一行、32 个音位一串数字」书写，行序 = 洞洞谱竖排自上而下：
 * 第八孔 → 第一孔（§6.6，已用两张原图逐格验证）。
 * tests/fingering.test.ts 会重新解析 md 原文校验本表，防止转录漂移。
 */

import type { Hole } from '../types'

export const HOLE = {
  CLOSED: 0, // ● 全闭
  OPEN: 1, // ○ 全开
  HALF: 2, // ◐ 半孔
  EITHER: 3, // ◎ 可开可闭
} as const

export const HOLE_SYMBOL: readonly string[] = ['●', '○', '◐', '◎']

export const SYMBOL_HOLE: Readonly<Record<string, Hole>> = {
  '●': HOLE.CLOSED,
  '○': HOLE.OPEN,
  '◐': HOLE.HALF,
  '◎': HOLE.EITHER,
}

export const HOLE_ORDER = [
  '第八孔',
  '第七孔',
  '第六孔',
  '第五孔',
  '第四孔',
  '第三孔',
  '第二孔',
  '第一孔',
] as const

export const HOLE_COUNT = HOLE_ORDER.length
export const TABLE_LENGTH = 32

/** 每行一个孔、32 个音位；数字即 Hole 值（0● 1○ 2◐ 3◎） */
const ROWS_ENCODED: readonly string[] = [
  '00000000001110000000000110000011', // 第八孔
  '00000000010100000000011100000100', // 第七孔
  '00000000130300000000130300011000', // 第六孔
  '00000021110100000021110102110000', // 第五孔
  '00000111111100000111110111010110', // 第四孔
  '00001111111100001111110111010010', // 第三孔
  '00013333333300013333331330001000', // 第二孔
  '02111111111102111111111110100001', // 第一孔
]

/**
 * table[index] = Uint8Array(8)；
 * 下标 0 = 第八孔（洞洞谱最上格），7 = 第一孔（最下格）。
 */
export const FINGERING_TABLE: readonly Uint8Array[] = buildTable(ROWS_ENCODED, HOLE_ORDER, TABLE_LENGTH)

/**
 * 把「每孔一行」的编码串转置成 table[音位][孔]。
 * 箫、笛共用；行数、每行长度不对就直接抛，转录错了宁可起不来也别画错谱。
 */
export function buildTable(
  rows: readonly string[],
  holeNames: readonly string[],
  length: number,
): Uint8Array[] {
  if (rows.length !== holeNames.length) {
    throw new Error(`指法表应有 ${holeNames.length} 行，实际 ${rows.length} 行`)
  }
  rows.forEach((row, i) => {
    if (row.length !== length) {
      throw new Error(`指法表「${holeNames[i]}」应有 ${length} 个音位，实际 ${row.length} 个`)
    }
  })
  return Array.from({ length }, (_, col) => {
    const holes = new Uint8Array(rows.length)
    for (let row = 0; row < rows.length; row++) {
      holes[row] = rows[row].charCodeAt(col) - 48
    }
    return holes
  })
}

/**
 * 「可开可闭 ◎」的渲染策略（§6.6）。
 * 定为「闭」——与《落了白》《为爱追寻》两张原图逐格一致。
 */
export type AmbiguousPolicy = '闭' | '开'

/** 把 ◎ 归约成实际画法，返回 CLOSED / OPEN / HALF */
export function resolveHole(state: number, policy: AmbiguousPolicy = '闭'): Hole {
  if (state === HOLE.EITHER) return policy === '闭' ? HOLE.CLOSED : HOLE.OPEN
  return state as Hole
}
