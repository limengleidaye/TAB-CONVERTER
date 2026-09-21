/**
 * DSL 命令表——反斜杠记号的唯一真相来源。
 *
 * 分词器、编辑器的自动补全、教程三处都从这里读，
 * 免得加一个记号要改三个地方还对不上。
 *
 * 为什么用 `\name` 而不是中文词：正文里的中文一律是歌词（紧跟在音符后面），
 * 再让中文兼任记号就会出现「这两个字到底是词还是命令」的歧义，
 * 而且记号得靠记忆硬打。反斜杠既无歧义，又能触发补全面板。
 */

import type { Meter, TempoMark } from './types'

export type CommandCategory = '变速' | '段落' | '拍号'

export interface DslCommand {
  /** 反斜杠后面的名字 */
  name: string
  /** 补全时插进文本的完整内容 */
  insert: string
  /** 谱面上画成什么 */
  render: string
  desc: string
  category: CommandCategory
  /**
   * 插入后光标相对 insert 起点的位置。
   * 例如 \tempo=88 要把光标停在数字上，方便直接改。
   */
  caretOffset?: number
  /** 选中范围长度（配合 caretOffset 做「插入后选中数字」） */
  selectLength?: number
}

export const DSL_COMMANDS: DslCommand[] = [
  {
    name: 'tempo',
    insert: '\\tempo=88',
    render: '♩=88',
    desc: '定值变速，改成你要的 BPM',
    category: '变速',
    caretOffset: 7,
    selectLength: 2,
  },
  { name: 'rit', insert: '\\rit', render: 'rit.', desc: '渐慢', category: '变速' },
  { name: 'accel', insert: '\\accel', render: 'accel.', desc: '渐快', category: '变速' },
  { name: 'atempo', insert: '\\atempo', render: 'a tempo', desc: '回到原速', category: '变速' },
  {
    name: 'fermata',
    insert: '\\fermata',
    render: '𝄐',
    desc: '自由延长，加在前一个音上',
    category: '变速',
  },
  {
    name: 'meter',
    insert: '\\meter=3/4',
    render: '3/4',
    desc: '曲中变拍号，写在小节开头',
    category: '拍号',
    caretOffset: 7,
    selectLength: 3,
  },
  { name: 'segno', insert: '\\segno', render: '%', desc: '返回记号（D.S. 跳回这里）', category: '段落' },
  { name: 'coda', insert: '\\coda', render: '⊕', desc: '尾声记号', category: '段落' },
  { name: 'dc', insert: '\\dc', render: 'D.C.', desc: '从头反复', category: '段落' },
  { name: 'ds', insert: '\\ds', render: 'D.S.', desc: '反复到返回记号处', category: '段落' },
  { name: 'fine', insert: '\\fine', render: 'Fine', desc: '结束（配合 D.C. / D.S.）', category: '段落' },
]

const BY_NAME = new Map(DSL_COMMANDS.map((c) => [c.name, c]))

export function findCommand(name: string): DslCommand | undefined {
  return BY_NAME.get(name.toLowerCase())
}

/** 按前缀筛选，供补全面板用 */
export function matchCommands(prefix: string): DslCommand[] {
  const p = prefix.toLowerCase()
  if (!p) return DSL_COMMANDS
  return DSL_COMMANDS.filter((c) => c.name.startsWith(p) || c.render.toLowerCase().startsWith(p))
}

/** 命令 → 变速记号；不是变速命令则返回 null */
export function tempoOf(name: string, value?: number): TempoMark | null {
  switch (name) {
    case 'tempo':
      return value === undefined ? null : { kind: 'bpm', bpm: value }
    case 'rit':
      return { kind: 'rit' }
    case 'accel':
      return { kind: 'accel' }
    case 'atempo':
      return { kind: 'atempo' }
    default:
      return null
  }
}

/** `3/4` → 拍号；写法不对则返回 null */
export function parseMeter(raw: string | undefined): Meter | null {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw ?? '')
  if (!m) return null
  const beats = Number(m[1])
  const unit = Number(m[2])
  // 分母必须是 2 的幂：简谱的时值体系里没有「三分音符」
  if (beats < 1 || beats > 32) return null
  if (![1, 2, 4, 8, 16, 32].includes(unit)) return null
  return { beats, unit }
}

/** 命令 → 段落记号；不是段落命令则返回 null */
export function sectionOf(name: string): string | null {
  switch (name) {
    case 'dc':
      return 'D.C.'
    case 'ds':
      return 'D.S.'
    case 'segno':
      return 'Segno'
    case 'coda':
      return 'Coda'
    case 'fine':
      return 'Fine'
    default:
      return null
  }
}
