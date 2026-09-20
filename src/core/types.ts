/**
 * 核心数据类型：DSL → AST → 布局模型 的公共契约。
 * 与 UI / SVG 完全解耦，便于单测。
 */

export type Accidental = '#' | 'b' | 'n'

/**
 * 指法表里的四种孔位状态（见 需求文档 §6.6），以小整数存储：
 * 0 ● 全闭 / 1 ○ 全开 / 2 ◐ 半孔 / 3 ◎ 可开可闭。
 * 符号映射见 core/fingering/table.ts 的 HOLE_SYMBOL / SYMBOL_HOLE。
 */
export type Hole = 0 | 1 | 2 | 3

/** 倚音（装饰音），不占时值、不画指法（§3.6） */
export interface Grace {
  degree: number
  accidental?: Accidental
  octave: number
}

export type TempoKind = 'bpm' | 'accel' | 'rit' | 'atempo'

/** 曲中变速记号（§3.9） */
export interface TempoMark {
  kind: TempoKind
  /** kind === 'bpm' 时有效 */
  bpm?: number
}

export type EventType = 'note' | 'rest' | 'dash'

/** 一个音符位（音 / 休止 / 延音横线） */
export interface NoteEvent {
  type: EventType
  /** 1–7；休止为 0；延音横线为 -1 */
  degree: number
  accidental?: Accidental
  /** 中音 = 0，^ 为 +1，_ 为 -1，可叠 */
  octave: number
  dotted: boolean
  /** 减时线条数 = 小括号嵌套层数 */
  beams: number
  /** 每一层减时线所属的梁分组 id，groupPath[L-1] 即第 L 条减时线的分组（§3.4） */
  groupPath: number[]
  /** 时值，单位为四分音符（拍） */
  duration: number
  lyric?: string
  graces?: Grace[]
  tempoMark?: TempoMark
  /**
   * 自由延长记号。它是加在音符上的演奏法，不是速度指令，
   * 所以和 tempoMark 分开存——否则 \tempo=60 \fermata 落在同一个音上会互相覆盖。
   */
  fermata?: boolean
  /** 被延音线连到的第二个及之后的同音：不重新起吹、不画指法（§3.5） */
  tiedFromPrev: boolean
  /** 后缀 ~：与下一个音以延音线相连（可跨梁分组、跨小节） */
  tieToNext: boolean
  slurStart: boolean
  slurEnd: boolean
  /** 连音组（三连音等）：N 值，仅组内第一个音带 */
  tupletStart?: number
  tupletMember: boolean
  /** 源码字符区间，用于就近报错 */
  span: [number, number]
}

export type BarlineKind = 'single' | 'final' | 'repeatStart' | 'repeatEnd'

/** 段落记号：D.C. / D.S. / Fine / Coda / Segno */
export type SectionMark = 'D.C.' | 'D.S.' | 'Fine' | 'Coda' | 'Segno'

export interface Measure {
  index: number
  notes: NoteEvent[]
  /** 小节左侧的线（反复开始等），null 表示沿用前一小节的右线 */
  openBarline: BarlineKind | null
  /** 小节右侧的线 */
  closeBarline: BarlineKind
  /** 房子号（[1. [2.） */
  volta?: number
  marks: SectionMark[]
  /** 实际拍数（四分音符为 1） */
  beats: number
  span: [number, number]
}

export interface Header {
  标题: string
  副标题?: string
  制谱?: string
  箫调: string
  筒音作: number
  筒音作Accidental?: Accidental
  /** 省略时由 箫调 + 筒音作 推导（§6.5） */
  调号?: string
  拍号: { beats: number; unit: number }
  /** 全曲基准 BPM；省略则谱头不显示速度项（§3.9） */
  速度?: number
}

export interface Score {
  header: Header
  measures: Measure[]
  /** 全曲是否有歌词，决定是否渲染歌词行（§7） */
  hasLyrics: boolean
}

export type IssueSeverity = 'error' | 'warning'

export interface Issue {
  severity: IssueSeverity
  message: string
  /** 源码字符区间 */
  span?: [number, number]
  /** 小节号（1 起），用于就近标色 */
  measureIndex?: number
}

export interface ParseResult {
  score: Score | null
  issues: Issue[]
}
