/**
 * 六孔笛指法表（转录自 六孔笛指法表.md）。
 *
 * 原始资料是七张「筒音作X指法表」图，每张只列该作法下的七个唱名；
 * 换算成「距筒音的半音数」拼起来，正好铺满从筒音往上两个八度再加一个全音的 27 个音位（筒音作5 即 低音5 → 高音6）。
 * 图上的 ◎ 是半孔，这里记成 HOLE.HALF；笛的表里没有「可开可闭」。
 *
 * 行序 = 洞洞谱竖排自上而下：第六孔（靠吹孔）→ 第一孔（靠筒口）。膜孔不按，不入表。
 * tests/fingering.test.ts 会重新解析 md 原文校验本表。
 */

import { buildTable } from './table'

export const DIZI_HOLE_ORDER = ['第六孔', '第五孔', '第四孔', '第三孔', '第二孔', '第一孔'] as const

export const DIZI_TABLE_LENGTH = 27

/** 每行一个孔、27 个音位；数字即 Hole 值（0● 1○ 2◐） */
const DIZI_ROWS_ENCODED: readonly string[] = [
  '000000000011100000000011100', // 第六孔
  '000000002101000000002101000', // 第五孔
  '000000211101000000211101021', // 第四孔
  '000001111111000001111101000', // 第三孔
  '000111111111000111111101000', // 第二孔
  '021011111111021011111111011', // 第一孔
]

export const DIZI_TABLE: readonly Uint8Array[] = buildTable(
  DIZI_ROWS_ENCODED,
  DIZI_HOLE_ORDER,
  DIZI_TABLE_LENGTH,
)
