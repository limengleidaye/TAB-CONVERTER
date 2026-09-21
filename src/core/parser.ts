/**
 * DSL → AST。
 * 头部键值对 + 正文音符流，产出 Score 与问题列表。
 */

import { tokenize, type Token } from './tokenize'
import type {
  Accidental,
  BarlineKind,
  Grace,
  Header,
  Issue,
  Measure,
  Meter,
  NoteEvent,
  ParseResult,
  SectionMark,
  Score,
  TempoMark,
} from './types'

/** 头部字段顺序即渲染/序列化顺序 */
export const HEADER_KEYS = ['标题', '副标题', '制谱', '箫调', '筒音作', '调号', '拍号', '速度'] as const

export function parse(src: string): ParseResult {
  const issues: Issue[] = []
  const { headerText, bodyText, bodyOffset } = splitSections(src)

  const header = parseHeader(headerText, issues)
  // 谱头的拍号是全曲起始拍号；曲中 \meter 从这个值往后改
  const body = parseBody(bodyText, bodyOffset, issues, header?.拍号 ?? { beats: 4, unit: 4 })

  if (!header) return { score: null, issues }

  const score: Score = {
    header,
    measures: body.measures,
    verseCount: body.measures.reduce(
      (n, m) => Math.max(n, ...m.notes.map((ev) => ev.lyrics?.length ?? 0)),
      0,
    ),
  }
  return { score, issues }
}

/** 头部与正文以第一个空行分隔；没有空行则整段都当头部 */
export function splitSections(src: string) {
  const normalized = src.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  let splitAt = -1
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isBlank = line.trim() === ''
    const isComment = line.trim().startsWith('//')
    if (isBlank && !isComment && i > 0) {
      // 只有当后面还有非空内容时才算分隔
      if (lines.slice(i + 1).some((l) => l.trim() !== '')) {
        splitAt = i
        break
      }
    }
    offset += line.length + 1
  }

  if (splitAt === -1) {
    return { headerText: normalized, bodyText: '', bodyOffset: normalized.length }
  }
  const bodyOffset = offset + lines[splitAt].length + 1
  return {
    headerText: lines.slice(0, splitAt).join('\n'),
    bodyText: normalized.slice(bodyOffset),
    bodyOffset,
  }
}

function parseHeader(text: string, issues: Issue[]): Header | null {
  const raw: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('//')) continue
    const m = /^([^:：]+)[:：]\s*(.*)$/.exec(t)
    if (!m) {
      issues.push({ severity: 'error', message: `头部无法解析：${t}` })
      continue
    }
    const key = m[1].trim()
    if (!(HEADER_KEYS as readonly string[]).includes(key)) {
      issues.push({ severity: 'warning', message: `未知头部字段「${key}」，已忽略` })
      continue
    }
    raw[key] = m[2].trim()
  }

  for (const required of ['标题', '箫调', '筒音作', '拍号']) {
    if (!raw[required]) {
      issues.push({ severity: 'error', message: `缺少必填头部字段「${required}:」` })
    }
  }
  if (!raw['标题'] || !raw['箫调'] || !raw['筒音作'] || !raw['拍号']) return null

  const tone = /^([#b])?([1-7])$/.exec(raw['筒音作'])
  if (!tone) {
    issues.push({ severity: 'error', message: `「筒音作:」应为 1–7 的唱名，当前为「${raw['筒音作']}」` })
    return null
  }

  const ts = /^(\d+)\s*\/\s*(\d+)$/.exec(raw['拍号'])
  if (!ts) {
    issues.push({ severity: 'error', message: `「拍号:」应为分数形式（如 4/4），当前为「${raw['拍号']}」` })
    return null
  }

  let 速度: number | undefined
  if (raw['速度']) {
    const bpm = Number(raw['速度'])
    if (!Number.isFinite(bpm) || bpm <= 0) {
      issues.push({ severity: 'warning', message: `「速度:」不是有效 BPM，已忽略：${raw['速度']}` })
    } else {
      速度 = bpm
    }
  }

  return {
    标题: raw['标题'],
    副标题: raw['副标题'],
    制谱: raw['制谱'],
    箫调: raw['箫调'],
    筒音作: Number(tone[2]),
    筒音作Accidental: tone[1] as Accidental | undefined,
    调号: raw['调号'],
    拍号: { beats: Number(ts[1]), unit: Number(ts[2]) },
    速度,
  }
}

interface BodyResult {
  measures: Measure[]
}

/** 正文解析：括号层级 = 减时线层数与梁分组；大括号 = 弧线；尖括号 = 倚音 */
function parseBody(text: string, offset: number, issues: Issue[], initialMeter: Meter): BodyResult {
  const { tokens, errors } = tokenize(text)
  for (const e of errors) {
    issues.push({ severity: 'error', message: e.message, span: shift(e.span, offset) })
  }

  const measures: Measure[] = []
  let current: NoteEvent[] = []
  let measureStart = 0
  let openBarline: BarlineKind | null = null
  let volta: number | undefined
  let marks: SectionMark[] = []
  /** 当前生效的拍号，以及本小节是不是变拍号的起点 */
  let meter: Meter = initialMeter
  let meterChanged = false

  // 括号层级：groupStack[L] 为第 L+1 层减时线的分组 id
  const groupStack: number[] = []
  let nextGroupId = 1

  // 大括号（弧线）栈：记录组内音符引用
  const slurStack: { token: Token; notes: NoteEvent[]; tupletN?: number }[] = []

  // 尖括号（倚音）
  let graceBuffer: Grace[] | null = null

  let pendingTempo: TempoMark | undefined
  let pendingGraces: Grace[] | undefined
  /** 上一个音带了 ~，当前音应标记为被连入 */
  let pendingTie = false
  let prevTieSource: NoteEvent | null = null

  const allNotes: NoteEvent[] = []

  const closeMeasure = (close: BarlineKind, end: number) => {
    const beats = current.reduce((s, n) => s + n.duration, 0)
    measures.push({
      index: measures.length + 1,
      notes: current,
      openBarline,
      closeBarline: close,
      volta,
      meter,
      meterChanged,
      marks,
      beats: round(beats),
      span: shift([measureStart, end], offset),
    })
    current = []
    openBarline = close === 'repeatEnd' ? null : null
    volta = undefined
    marks = []
    meterChanged = false
    measureStart = end
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const tk = tokens[ti]

    switch (tk.kind) {
      case 'lparen':
        groupStack.push(nextGroupId++)
        break

      case 'rparen':
        if (groupStack.length === 0) {
          issues.push({ severity: 'error', message: '多余的 ")"', span: shift(tk.span, offset) })
        } else {
          groupStack.pop()
        }
        break

      case 'lbrace':
        slurStack.push({ token: tk, notes: [] })
        break

      case 'tupletOpen':
        slurStack.push({ token: tk, notes: [], tupletN: tk.tupletN })
        break

      case 'rbrace': {
        const grp = slurStack.pop()
        if (!grp) {
          issues.push({ severity: 'error', message: '多余的 "}"', span: shift(tk.span, offset) })
          break
        }
        finishGroup(grp, groupStack.length, issues, offset)
        break
      }

      case 'langle':
        if (graceBuffer) {
          issues.push({ severity: 'error', message: '倚音 "<" 不能嵌套', span: shift(tk.span, offset) })
        }
        graceBuffer = []
        break

      case 'rangle':
        if (!graceBuffer) {
          issues.push({ severity: 'error', message: '多余的 ">"', span: shift(tk.span, offset) })
        } else {
          if (graceBuffer.length === 0) {
            issues.push({ severity: 'warning', message: '空的倚音组 <>', span: shift(tk.span, offset) })
          }
          pendingGraces = graceBuffer
          graceBuffer = null
        }
        break

      case 'note': {
        // 倚音组内部：只收集音高，不产生时值
        if (graceBuffer) {
          graceBuffer.push({
            degree: tk.degree!,
            accidental: tk.accidental,
            octave: tk.octave!,
          })
          break
        }

        const depth = groupStack.length
        const base = 1 / Math.pow(2, depth)
        const ev: NoteEvent = {
          type: tk.degree === 0 ? 'rest' : 'note',
          degree: tk.degree!,
          accidental: tk.accidental,
          octave: tk.octave!,
          dotted: !!tk.dotted,
          beams: depth,
          groupPath: [...groupStack],
          duration: tk.dotted ? base * 1.5 : base,
          lyrics: tk.lyrics,
          graces: pendingGraces,
          tempoMark: pendingTempo,
          tiedFromPrev: pendingTie,
          tieToNext: !!tk.tie,
          slurStart: false,
          slurEnd: false,
          tupletMember: false,
          span: shift(tk.span, offset),
        }
        if (pendingTie && prevTieSource && !samePitch(prevTieSource, ev)) {
          issues.push({
            severity: 'warning',
            message: '延音线 "~" 连接的两个音高不同，已按圆滑线渲染',
            span: shift(tk.span, offset),
          })
          ev.tiedFromPrev = false
        }
        if (pendingTie && ev.type !== 'note') {
          issues.push({
            severity: 'warning',
            message: '延音线 "~" 后面不是音符，已忽略',
            span: shift(tk.span, offset),
          })
          ev.tiedFromPrev = false
        }
        pendingTie = !!tk.tie
        prevTieSource = tk.tie ? ev : null
        if (tk.lyrics && tk.degree === 0) {
          issues.push({
            severity: 'error',
            message: '休止符不能带歌词',
            span: shift(tk.span, offset),
          })
        }
        pendingGraces = undefined
        pendingTempo = undefined
        current.push(ev)
        allNotes.push(ev)
        for (const g of slurStack) g.notes.push(ev)
        break
      }

      case 'dash': {
        const depth = groupStack.length
        const ev: NoteEvent = {
          type: 'dash',
          degree: -1,
          octave: 0,
          dotted: false,
          beams: depth,
          groupPath: [...groupStack],
          duration: 1 / Math.pow(2, depth),
          tempoMark: pendingTempo,
          tiedFromPrev: false,
          tieToNext: false,
          slurStart: false,
          slurEnd: false,
          tupletMember: false,
          span: shift(tk.span, offset),
        }
        if (pendingTie) {
          issues.push({
            severity: 'warning',
            message: '延音线 "~" 后面是延音横线，已忽略（请直接用 -）',
            span: shift(tk.span, offset),
          })
          pendingTie = false
          prevTieSource = null
        }
        pendingTempo = undefined
        current.push(ev)
        allNotes.push(ev)
        for (const g of slurStack) g.notes.push(ev)
        break
      }

      case 'fermata': {
        // 延长记号作用在「前一个音」上
        const prev = allNotes[allNotes.length - 1]
        if (prev) prev.fermata = true
        else
          issues.push({
            severity: 'warning',
            message: '延长记号前面没有音符',
            span: shift(tk.span, offset),
          })
        break
      }

      case 'tempo':
        // 一个音只能挂一个变速记号；连着写两个多半是笔误
        if (pendingTempo) {
          issues.push({
            severity: 'warning',
            message: '同一个音上有两个变速记号，只保留后一个',
            span: shift(tk.span, offset),
          })
        }
        pendingTempo = tk.tempo
        break

      case 'section':
        marks.push(tk.section as SectionMark)
        break

      case 'meter':
        // 变拍号作用于**整个当前小节**。写在小节中间时意图就含糊了，给个警告。
        if (current.length > 0) {
          issues.push({
            severity: 'warning',
            message: '变拍号写在了小节中间，已按整小节生效——请写在小节开头',
            span: shift(tk.span, offset),
          })
        }
        meter = tk.meter!
        meterChanged = true
        break

      case 'volta':
        volta = tk.volta
        break

      case 'repeatStart':
        if (current.length > 0) closeMeasure('single', tk.span[0])
        openBarline = 'repeatStart'
        measureStart = tk.span[1]
        break

      case 'repeatEnd':
        closeMeasure('repeatEnd', tk.span[1])
        break

      case 'barline':
        closeMeasure('single', tk.span[1])
        break

      case 'finalBarline':
        closeMeasure('final', tk.span[1])
        break
    }
  }

  if (groupStack.length > 0) {
    issues.push({ severity: 'error', message: `有 ${groupStack.length} 个 "(" 未闭合` })
  }
  if (slurStack.length > 0) {
    issues.push({
      severity: 'error',
      message: `有 ${slurStack.length} 个 "{" 未闭合`,
      span: shift(slurStack[0].token.span, offset),
    })
  }
  if (graceBuffer) {
    issues.push({ severity: 'error', message: '倚音 "<" 未闭合' })
  }
  if (current.length > 0) closeMeasure('single', text.length)

  return { measures }
}

/**
 * 收尾一个大括号组：
 * - 普通组 → 一条弧线（首尾），相邻同音按延音线(tie)处理（§3.5）
 * - 连音组 N:{} → 组内均分一个当前层时值单位（§3.7）
 */
function finishGroup(
  grp: { token: Token; notes: NoteEvent[]; tupletN?: number },
  depth: number,
  issues: Issue[],
  offset: number,
) {
  const notes = grp.notes
  if (notes.length === 0) return

  if (grp.tupletN !== undefined) {
    const n = grp.tupletN
    if (notes.length !== n) {
      issues.push({
        severity: 'error',
        message: `${n} 连音组内应有 ${n} 个音，实际 ${notes.length} 个`,
        span: shift(grp.token.span, offset),
      })
    }
    const total = 1 / Math.pow(2, depth)
    const each = total / Math.max(notes.length, 1)
    for (const nt of notes) {
      nt.duration = each
      nt.tupletMember = true
    }
    notes[0].tupletStart = n
    return
  }

  notes[0].slurStart = true
  notes[notes.length - 1].slurEnd = true

  // 相邻同音 → 延音线：后一个音不重新起吹、不画指法
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1]
    const b = notes[i]
    if (a.type === 'note' && b.type === 'note' && samePitch(a, b)) {
      b.tiedFromPrev = true
    }
  }
}

export function samePitch(a: NoteEvent, b: NoteEvent): boolean {
  return (
    a.degree === b.degree &&
    a.octave === b.octave &&
    (a.accidental ?? 'n') === (b.accidental ?? 'n')
  )
}

function shift(span: [number, number], offset: number): [number, number] {
  return [span[0] + offset, span[1] + offset]
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
