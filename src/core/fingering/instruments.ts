/**
 * 乐器定义：一支管子要画洞洞谱、查指法、出声音，所需的全部差异都收在这里。
 *
 * 箫和笛的调名约定相同——「X 调」就是筒音作 5 时 1=X，筒音是该调的 sol，
 * 所以调号推导（derive.ts）两边共用；不同的只有孔数、指法表、洞洞谱的分段和音区。
 */

import { DIZI_HOLE_ORDER, DIZI_TABLE, DIZI_TABLE_LENGTH } from './dizi'
import { FINGERING_TABLE, HOLE_ORDER, TABLE_LENGTH } from './table'

export type InstrumentId = 'xiao' | 'dizi'

export interface InstrumentDef {
  id: InstrumentId
  /** 单字简称：谱面类型「箫谱 / 笛谱」、谱头「箫调 / 笛调」都由它拼 */
  short: string
  /** 报错里用的全称 */
  fullName: string
  /** 孔名，自上而下（洞洞谱竖排顺序） */
  holeNames: readonly string[]
  /** table[距筒音的半音数] = 各孔状态，下标同 holeNames */
  table: readonly Uint8Array[]
  tableLength: number
  /** 洞洞谱一列里的分段（孔下标），段与段之间留一条缝 */
  segments: readonly (readonly number[])[]
  /** 向左错开画的孔（箫的第八孔、第一孔） */
  edgeHoles: ReadonlySet<number>
  /**
   * 筒音可能落到的最低 MIDI 音。筒音的音名由调定，八度取「从这里往上的 12 个半音」：
   * 箫 60 → G 调箫筒音 D4；笛 67 → D 调笛筒音 A4、G 调笛筒音 D5。
   */
  tongyinFloorMidi: number
  /** 谱头表单里列出的常见调（筒音作5 时的调） */
  commonKeys: readonly string[]
}

export const XIAO: InstrumentDef = {
  id: 'xiao',
  short: '箫',
  fullName: '八孔箫',
  holeNames: HOLE_ORDER,
  table: FINGERING_TABLE,
  tableLength: TABLE_LENGTH,
  // [标签 + 第八~第五孔] / [第四~第二孔] / [第一孔]（与原图一致）
  segments: [
    [0, 1, 2, 3],
    [4, 5, 6],
    [7],
  ],
  edgeHoles: new Set([0, 7]),
  tongyinFloorMidi: 60,
  commonKeys: ['G', 'F', 'D', 'C', 'A', 'bB', 'bE'],
}

export const DIZI: InstrumentDef = {
  id: 'dizi',
  short: '笛',
  fullName: '六孔笛',
  holeNames: DIZI_HOLE_ORDER,
  table: DIZI_TABLE,
  tableLength: DIZI_TABLE_LENGTH,
  // 左手三孔 / 右手三孔
  segments: [
    [0, 1, 2],
    [3, 4, 5],
  ],
  edgeHoles: new Set(),
  tongyinFloorMidi: 67,
  commonKeys: ['C', 'D', 'E', 'F', 'G', 'A', 'bB'],
}

export const INSTRUMENTS: Readonly<Record<InstrumentId, InstrumentDef>> = { xiao: XIAO, dizi: DIZI }
