/**
 * AST → 布局模型（纯计算，不产生任何 DOM/SVG）。
 *
 * 三行结构（§7）：简谱行 / 歌词行 / 洞洞谱行，随小节整体换行。
 */

import { lookupFingering, type FingeringLookup } from './fingering/derive'
import type { Measure, NoteEvent, Score } from './types'

export const M = {
  pageW: 1200,
  pageH: 1697,
  marginX: 70,
  marginTop: 56,
  marginBottom: 76,

  titleSize: 42,
  subtitleSize: 19,
  headerBlockH: 112,

  digitSize: 26,
  digitHalfW: 10.5,

  /** 简谱行上方预留：变速记号带、弧线带 */
  tempoBand: 16,
  arcBand: 14,
  topPad: 4,

  beamGap: 8,
  beamStep: 5,
  beamThickness: 2.4,
  octaveDotR: 2.2,
  octaveDotStep: 6.5,

  lyricSize: 19,

  fingerW: 28,
  fingerCellH: 18,
  fingerSepH: 3,
  holeR: 8.6,
  /** 指法列顶部唱名的字号与八度点行距 */
  fingerLabelSize: 13,
  fingerLabelHBase: 19,
  octaveLabelStep: 4,
  /**
   * 第八孔与第一孔向左偏移的量，用来标出这两个孔的特殊性（与原图一致）。
   * 原图实测：管身宽度的约 19%（32px 宽里偏左 6px）。
   */
  edgeHoleShift: 5,

  /** 简谱行底部（含减时线与低音点）到歌词基线的净空 */
  lyricClearance: 6,
  /** 歌词基线到洞洞谱顶部 */
  lyricToFinger: 8,
  /** 无歌词时，简谱行底部到洞洞谱顶部 */
  digitsToFinger: 14,
  systemPadBottom: 14,

  measureGap: 14,
  groupGap: 8,
  /**
   * 每个音的自然宽度下限。它只影响折行判断（排满一行后还会两端对齐拉开），
   * 取 36 是为了让每行的小节数贴近原图——太小会把 4~5 个小节挤进一行。
   */
  minNoteW: 36,
  /** 一行的自然宽度达到内容宽度这个比例时才两端对齐，避免末行被拉散 */
  justifyThreshold: 0.6,
}

export interface LaidNote {
  ev: NoteEvent
  /** 数字中心 x */
  x: number
  width: number
  fingering: FingeringLookup | null
  /** 是否画指法列 */
  showFingering: boolean
}

export interface LaidMeasure {
  measure: Measure
  notes: LaidNote[]
  x: number
  width: number
  /** 小节线 x（右侧） */
  barX: number
}

export interface BeamSeg {
  x1: number
  x2: number
  level: number
}

export interface ArcSeg {
  x1: number
  x2: number
  /** 起点/终点是否被换行截断 */
  openLeft: boolean
  openRight: boolean
}

export interface TupletSeg {
  x1: number
  x2: number
  n: number
}

export interface System {
  measures: LaidMeasure[]
  beams: BeamSeg[]
  arcs: ArcSeg[]
  tuplets: TupletSeg[]
  /** 系统顶部 y（页内绝对坐标） */
  y: number
  height: number
  width: number
}

export interface Page {
  systems: System[]
}

/**
 * 一行谱的竖向分带。全部由内容实测算出，而不是写死常量——
 * 减时线条数、低音点个数、高音点个数都会把相邻的带顶开，避免压字。
 */
export interface Bands {
  /** 变速记号基线 */
  tempoY: number
  /** 弧线（圆滑线/延音线）的两端 y */
  arcY: number
  /** 简谱数字基线 */
  digitBaseline: number
  /** 简谱行最底部（减时线与低音点都算在内） */
  digitsBottom: number
  /** 歌词基线；无歌词时等于 digitsBottom */
  lyricBaseline: number
  /** 洞洞谱顶部 */
  fingeringTop: number
  /** 指法列顶部唱名格的高度（高音点多时会变高） */
  fingerLabelH: number
  /** 指法列总高 */
  fingerH: number
  /** 一行谱总高 */
  systemHeight: number
}

export interface Layout {
  pages: Page[]
  hasLyrics: boolean
  keySignature: string | null
  bands: Bands
  metrics: typeof M
}

interface ContentExtent {
  maxBeams: number
  maxLowOctave: number
  maxHighOctave: number
  hasTempo: boolean
  hasLyrics: boolean
}

function measureExtent(score: Score): ContentExtent {
  let maxBeams = 0
  let maxLowOctave = 0
  let maxHighOctave = 0
  let hasTempo = false
  let hasLyrics = false

  for (const m of score.measures) {
    for (const n of m.notes) {
      if (n.beams > maxBeams) maxBeams = n.beams
      if (n.octave < 0 && -n.octave > maxLowOctave) maxLowOctave = -n.octave
      if (n.octave > 0 && n.octave > maxHighOctave) maxHighOctave = n.octave
      if (n.tempoMark) hasTempo = true
      if (n.lyric) hasLyrics = true
      // 倚音自带八度点，也要算进上方净空
      for (const g of n.graces ?? []) {
        if (g.octave > 0 && g.octave > maxHighOctave) maxHighOctave = g.octave
      }
    }
  }
  return { maxBeams, maxLowOctave, maxHighOctave, hasTempo, hasLyrics }
}

export function computeBands(ext: ContentExtent): Bands {
  // 数字上方：高音点占的高度
  const highDotSpace =
    ext.maxHighOctave > 0 ? 3 + (ext.maxHighOctave - 1) * M.octaveDotStep + 2 * M.octaveDotR : 0

  const tempoReserve = ext.hasTempo ? M.tempoBand : 0
  const digitBaseline = M.topPad + tempoReserve + M.arcBand + highDotSpace + M.digitSize
  const digitTop = digitBaseline - M.digitSize
  const arcY = digitTop - highDotSpace - 4
  const tempoY = M.topPad + 12

  // 数字下方：减时线 + 低音点，取更低的那个
  const beamBottom =
    ext.maxBeams > 0 ? digitBaseline + M.beamGap + ext.maxBeams * M.beamStep + M.beamThickness : digitBaseline + 4
  const lowDotBottom =
    ext.maxLowOctave > 0
      ? digitBaseline +
        M.beamGap +
        ext.maxBeams * M.beamStep +
        5 +
        (ext.maxLowOctave - 1) * M.octaveDotStep +
        M.octaveDotR
      : 0
  const digitsBottom = Math.max(beamBottom, lowDotBottom)

  const lyricBaseline = ext.hasLyrics ? digitsBottom + M.lyricClearance + M.lyricSize : digitsBottom
  const fingeringTop = ext.hasLyrics ? lyricBaseline + M.lyricToFinger : digitsBottom + M.digitsToFinger

  // 指法列顶部的唱名格：高音点画在数字上方，点越多这一格越高
  const fingerLabelH = M.fingerLabelHBase + ext.maxHighOctave * M.octaveLabelStep
  const fingerH = fingerLabelH + M.fingerCellH * 8 + M.fingerSepH * 2
  const systemHeight = fingeringTop + fingerH + M.systemPadBottom

  return {
    tempoY,
    arcY,
    digitBaseline,
    digitsBottom,
    lyricBaseline,
    fingeringTop,
    fingerLabelH,
    fingerH,
    systemHeight,
  }
}

export function layout(score: Score, keySignature: string | null): Layout {
  const hasLyrics = score.hasLyrics
  const bands = computeBands(measureExtent(score))
  const contentW = M.pageW - M.marginX * 2

  // ---- 1. 逐音算宽 ----
  const laidMeasures: LaidMeasure[] = score.measures.map((measure) => {
    const notes: LaidNote[] = measure.notes.map((ev) => {
      const fingering =
        ev.type === 'note'
          ? lookupFingering(ev, score.header.筒音作, score.header.筒音作Accidental)
          : null
      const showFingering = !!fingering && !fingering.outOfRange && !ev.tiedFromPrev
      return { ev, x: 0, width: noteWidth(ev, showFingering), fingering, showFingering }
    })
    return { measure, notes, x: 0, width: 0, barX: 0 }
  })

  // 自然宽度（未对齐前），用于折行判断
  for (const lm of laidMeasures) {
    lm.width = measureNaturalWidth(lm)
  }

  // ---- 2. 按内容宽度折行 ----
  const rows: LaidMeasure[][] = []
  let row: LaidMeasure[] = []
  let rowW = 0
  for (const lm of laidMeasures) {
    if (row.length > 0 && rowW + lm.width > contentW) {
      rows.push(row)
      row = []
      rowW = 0
    }
    row.push(lm)
    rowW += lm.width
  }
  if (row.length > 0) rows.push(row)

  // ---- 3. 系统内绝对坐标（两端对齐）+ 梁/弧线/连音记号 ----
  const systemH = bands.systemHeight
  const systems: System[] = rows.map((measures) => {
    const natural = measures.reduce((s, lm) => s + lm.width, 0)
    const noteCount = measures.reduce((s, lm) => s + lm.notes.length, 0)
    // 自然宽度够长才拉满一行；末行太短就保持自然宽度，不拉散
    const pad =
      natural >= contentW * M.justifyThreshold && noteCount > 0
        ? (contentW - natural) / noteCount
        : 0

    let cursor = M.marginX
    for (const lm of measures) {
      lm.x = cursor
      lm.notes.forEach((ln, i) => {
        const w = ln.width + pad
        ln.x = cursor + w / 2
        cursor += w
        const next = lm.notes[i + 1]
        if (next && !sameBeamGroup(ln.ev, next.ev)) cursor += M.groupGap
      })
      cursor += M.measureGap / 2
      lm.barX = cursor
      cursor += M.measureGap / 2
      lm.width = cursor - lm.x
    }
    return {
      measures,
      beams: computeBeams(measures),
      arcs: [],
      tuplets: computeTuplets(measures),
      y: 0,
      height: systemH,
      width: cursor - M.marginX,
    }
  })

  computeArcs(systems)

  // ---- 4. 分页 ----
  const pages: Page[] = []
  let cur: System[] = []
  let y = M.marginTop + M.headerBlockH
  const maxY = M.pageH - M.marginBottom

  for (const sys of systems) {
    if (cur.length > 0 && y + sys.height > maxY) {
      pages.push({ systems: cur })
      cur = []
      y = M.marginTop + 20 // 第 2 页起无谱头
    }
    sys.y = y
    y += sys.height
    cur.push(sys)
  }
  if (cur.length > 0) pages.push({ systems: cur })

  return { pages, hasLyrics, keySignature, bands, metrics: M }
}

/** 小节未对齐时的自然宽度：各音宽 + 梁分组间隙 + 小节间隙 */
function measureNaturalWidth(lm: LaidMeasure): number {
  let w = M.measureGap
  lm.notes.forEach((ln, i) => {
    w += ln.width
    const next = lm.notes[i + 1]
    if (next && !sameBeamGroup(ln.ev, next.ev)) w += M.groupGap
  })
  return w
}

function noteWidth(ev: NoteEvent, showFingering: boolean): number {
  let w = M.minNoteW
  if (showFingering) w = Math.max(w, M.fingerW + 4)
  if (ev.lyric) w = Math.max(w, ev.lyric.length * (M.lyricSize + 1) + 4)
  if (ev.dotted) w += 8
  if (ev.graces?.length) w += ev.graces.length * 12
  return w
}

/** 两个音是否在同一最内层梁分组（决定是否留分组间隙） */
function sameBeamGroup(a: NoteEvent, b: NoteEvent): boolean {
  if (a.beams === 0 || b.beams === 0) return a.beams === b.beams
  return a.groupPath[0] === b.groupPath[0]
}


/**
 * 减时线：第 L 条线连接「连续且同属第 L 层分组」的音。
 * 分组来自小括号，所以 `(1 6) (5)` 会断成两条，而 `(1 6 5)` 连成一条（§3.4）。
 */
function computeBeams(measures: LaidMeasure[]): BeamSeg[] {
  const segs: BeamSeg[] = []
  for (const lm of measures) {
    const notes = lm.notes
    const maxLevel = Math.max(0, ...notes.map((n) => n.ev.beams))
    for (let level = 1; level <= maxLevel; level++) {
      let runStart = -1
      let runGroup: number | undefined
      const flush = (endIdx: number) => {
        if (runStart === -1) return
        segs.push({
          x1: notes[runStart].x - M.digitHalfW,
          x2: notes[endIdx].x + M.digitHalfW,
          level,
        })
        runStart = -1
        runGroup = undefined
      }
      for (let i = 0; i < notes.length; i++) {
        const ev = notes[i].ev
        const inLevel = ev.beams >= level
        const group = ev.groupPath[level - 1]
        if (inLevel && runStart !== -1 && group === runGroup) continue
        flush(i - 1)
        if (inLevel) {
          runStart = i
          runGroup = group
        }
      }
      flush(notes.length - 1)
    }
  }
  return segs
}

/** 圆滑线 / 延音线：一个大括号组画一条弧，跨行则在行末断开续接（§3.5） */
function computeArcs(systems: System[]): void {
  // 建立 系统 → 音符索引 的查找
  const positions = new Map<NoteEvent, { sys: number; x: number }>()
  systems.forEach((sys, si) => {
    for (const lm of sys.measures) for (const ln of lm.notes) positions.set(ln.ev, { sys: si, x: ln.x })
  })

  const order: NoteEvent[] = []
  for (const sys of systems) for (const lm of sys.measures) for (const ln of lm.notes) order.push(ln.ev)

  for (let i = 0; i < order.length; i++) {
    let j = i
    if (order[i].slurStart) {
      while (j < order.length && !order[j].slurEnd) j++
    } else if (order[i].tieToNext) {
      // 后缀 ~ 的延音线：连到下一个音，可跨梁分组与小节
      j = i + 1
    } else {
      continue
    }
    if (j >= order.length) continue

    const a = positions.get(order[i])!
    const b = positions.get(order[j])!
    if (a.sys === b.sys) {
      systems[a.sys].arcs.push({ x1: a.x, x2: b.x, openLeft: false, openRight: false })
    } else {
      // 跨行：起始行画到行末，结束行从行首画起
      const startSys = systems[a.sys]
      systems[a.sys].arcs.push({
        x1: a.x,
        x2: M.marginX + startSys.width,
        openLeft: false,
        openRight: true,
      })
      for (let s = a.sys + 1; s < b.sys; s++) {
        systems[s].arcs.push({
          x1: M.marginX,
          x2: M.marginX + systems[s].width,
          openLeft: true,
          openRight: true,
        })
      }
      systems[b.sys].arcs.push({ x1: M.marginX, x2: b.x, openLeft: true, openRight: false })
    }
  }
}

function computeTuplets(measures: LaidMeasure[]): TupletSeg[] {
  const segs: TupletSeg[] = []
  for (const lm of measures) {
    const notes = lm.notes
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i].ev.tupletStart
      if (!n) continue
      let j = i
      while (j + 1 < notes.length && notes[j + 1].ev.tupletMember && !notes[j + 1].ev.tupletStart) j++
      segs.push({ x1: notes[i].x - M.digitHalfW, x2: notes[j].x + M.digitHalfW, n })
      i = j
    }
  }
  return segs
}
