/**
 * 谱面 → 播放时间轴（纯计算，不碰 DOM、不碰音频）。
 *
 * 排版已经把每个音的 x / 所在行 / 指法算好了（layout.ts），这里只在它上面叠一条时间轴：
 *   1. 反复展开 —— |: :| 与房子号按实际演奏顺序铺平；
 *   2. 合并起吹单位 —— 延音线、相邻同音、延音横线并进前一个音（吹的时候本来就是一口气）；
 *   3. 落地速度 —— \tempo= 直接换，accel./rit. 在「记号到下一个变速记号」之间渐变；
 *   4. 算出方框矩形、节拍点与绝对频率。
 *
 * 谱面上 accel./rit. 只是个记号，播放必须给出具体数字：这是本模块唯一的「发明」，
 * 幅度做成参数（rampAmount），播放窗里可调。
 */

import {
  keySignaturePitchClass,
  semitoneOf,
  tongyinPitchClass,
  type FingeringLookup,
} from './fingering/derive'
import { M, type Bands, type LaidMeasure, type LaidNote, type Layout } from './layout'
import type { Meter, NoteEvent, Score } from './types'

/** 谱头没写 `速度:` 时的兜底 BPM */
export const DEFAULT_BPM = 72

/** accel. / rit. 的默认渐变幅度：渐快到 1.3 倍、渐慢到 0.7 倍 */
export const DEFAULT_RAMP = 0.3

/** `\fermata` 自由延长：按二倍时值播放 */
export const FERMATA_FACTOR = 2

/** 反复展开的死循环保险丝：正常曲子铺平后不会超过原长的几倍 */
const MAX_EXPAND_FACTOR = 8

/** 方框在页坐标系（1200 × 1697）里的矩形 */
export interface PlayBox {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface PlayStep {
  index: number
  /** 起吹的那个音（决定指法、唱名、音高） */
  ev: NoteEvent
  /** 本步覆盖的所有音符位（含被并进来的延音横线 / 延音线） */
  covers: NoteEvent[]
  measureIndex: number
  /** 第几遍（反复展开后第二遍为 2） */
  pass: number
  /** 起始时间（秒，1 倍速） */
  start: number
  /** 时长（秒，1 倍速） */
  duration: number
  /** 本步生效的 BPM */
  bpm: number
  /** 绝对频率 Hz；休止、音域外、箫调认不出时为 null */
  freq: number | null
  fingering: FingeringLookup | null
  /** 画得出洞洞谱时为八个孔的状态，否则 null */
  holes: Uint8Array | null
  box: PlayBox
}

/** 节拍器的一响 */
export interface BeatMark {
  time: number
  /** 小节第一拍 */
  strong: boolean
}

export interface Timeline {
  steps: PlayStep[]
  beats: BeatMark[]
  /** 全曲时长（秒，1 倍速） */
  duration: number
  /** 实际生效的基准 BPM */
  baseBpm: number
  /** 谱头 `速度:` 写了多少；没写为 null */
  headerBpm: number | null
  /** 起始小节一小节几拍，预备拍用 */
  beatsPerMeasure: number
  /** 起始小节一拍 = 几个四分音符（6/8 拍时为 0.5） */
  quartersPerBeat: number
  /** 反复是否真的展开出了额外小节 */
  expanded: boolean
}

/**
 * 播放的两种口径：
 * - `xiao`：音高按箫来——距筒音多少个半音，筒音音名由箫调定（G 调箫筒音 = D4）；
 * - `jianpu`：音高只看调号，中音 1 落在 C4~B4，与乐器无关。
 */
export type PlayMode = 'xiao' | 'jianpu'

export interface TimelineOptions {
  /** 默认按箫 */
  mode?: PlayMode
  /** 基准 BPM，优先于谱头的 `速度:`（播放窗里可以当场改） */
  baseBpm?: number
  /** accel. / rit. 的渐变幅度，0.3 = ±30% */
  rampAmount?: number
  /** 展开 |: :| 与房子号；关掉就按谱面书写顺序播一遍 */
  expandRepeats?: boolean
}

interface Slot {
  lm: LaidMeasure
  page: number
  sysY: number
}

interface FlatNote {
  ln: LaidNote
  page: number
  sysY: number
  measureIndex: number
  pass: number
}

export function buildTimeline(score: Score, layout: Layout, opts: TimelineOptions = {}): Timeline {
  const rampAmount = opts.rampAmount ?? DEFAULT_RAMP
  const headerBpm = score.header.速度 && score.header.速度 > 0 ? score.header.速度 : null
  const baseBpm = opts.baseBpm && opts.baseBpm > 0 ? opts.baseBpm : (headerBpm ?? DEFAULT_BPM)

  const slots: Slot[] = []
  layout.pages.forEach((page, pi) => {
    for (const sys of page.systems) {
      for (const lm of sys.measures) slots.push({ lm, page: pi, sysY: sys.y })
    }
  })

  const order = opts.expandRepeats === false ? slots.map((_, i) => i) : expandRepeats(slots)

  // ---- 1. 铺平成音符流 ----
  const seen = new Map<number, number>()
  const flat: FlatNote[] = []
  for (const si of order) {
    const pass = (seen.get(si) ?? 0) + 1
    seen.set(si, pass)
    const slot = slots[si]
    for (const ln of slot.lm.notes) {
      flat.push({
        ln,
        page: slot.page,
        sysY: slot.sysY,
        measureIndex: slot.lm.measure.index,
        pass,
      })
    }
  }

  // ---- 2. 合并起吹单位 ----
  const groups: FlatNote[][] = []
  for (const fn of flat) {
    const ev = fn.ln.ev
    const continues = ev.type === 'dash' || (ev.type === 'note' && ev.tiedFromPrev)
    if (continues && groups.length > 0) groups[groups.length - 1].push(fn)
    else groups.push([fn])
  }

  // ---- 3. 每一步的 BPM ----
  const bpms = resolveTempo(groups, baseBpm, rampAmount)

  // ---- 4. 时间、方框、音高 ----
  const tongyinPc = tongyinPitchClass(score.header.箫调)
  // 简谱模式下箫调/筒音作与音高无关，主音直接从调号取
  const tonicPc = opts.mode === 'jianpu' ? keySignaturePitchClass(layout.keySignature) : null
  const steps: PlayStep[] = []
  let t = 0
  groups.forEach((g, i) => {
    const head = g[0]
    const ev = head.ln.ev
    const quarters = g.reduce((s, fn) => s + fn.ln.ev.duration, 0)
    const fermata = g.some((fn) => fn.ln.ev.fermata)
    const duration = ((quarters * 60) / bpms[i]) * (fermata ? FERMATA_FACTOR : 1)

    steps.push({
      index: i,
      ev,
      covers: g.map((fn) => fn.ln.ev),
      measureIndex: head.measureIndex,
      pass: head.pass,
      start: t,
      duration,
      bpm: bpms[i],
      freq: frequencyOf(head.ln.fingering, ev, tongyinPc, tonicPc),
      fingering: head.ln.fingering,
      holes: head.ln.showFingering ? (head.ln.fingering?.holes ?? null) : null,
      box: boxOf(g, layout.bands),
    })
    t += duration
  })

  // 曲中可以变拍号，拍点得按每小节自己的拍号算
  const meters = new Map<number, Meter>()
  for (const m of score.measures) meters.set(m.index, m.meter)
  const firstMeter = score.measures[0]?.meter ?? score.header.拍号

  return {
    steps,
    beats: collectBeats(steps, meters, firstMeter),
    duration: t,
    baseBpm,
    headerBpm,
    beatsPerMeasure: firstMeter.beats,
    quartersPerBeat: 4 / firstMeter.unit,
    expanded: order.length > slots.length,
  }
}

/**
 * 反复展开：`|:` 开段、`:|` 回跳一次，房子号按遍数取舍。
 * 没写 `|:` 时按惯例从曲子开头回跳。
 *
 * D.C. / D.S. / Coda / Fine 这类段落跳转**不**展开——它们的组合语义太多
 * （D.S. al Coda、al Fine…），猜错比不做更误导；播放窗里会明说这一点。
 */
export function expandRepeats(slots: Slot[]): number[] {
  const out: number[] = []
  let i = 0
  let sectionStart = 0
  let pass = 1
  const limit = slots.length * MAX_EXPAND_FACTOR

  while (i < slots.length && out.length < limit) {
    const m = slots[i].lm.measure

    // 进入一个新的反复段才重置遍数；回跳落回段首时 i === sectionStart，不会误重置
    if (m.openBarline === 'repeatStart' && i > sectionStart) {
      sectionStart = i
      pass = 1
    }

    // 不属于本遍的房子号整小节跳过（[1. 在第二遍略过，[2. 在第一遍略过）
    if (m.volta !== undefined && m.volta !== pass) {
      i++
      continue
    }

    out.push(i)

    if (m.closeBarline === 'repeatEnd' && pass === 1) {
      pass = 2
      i = sectionStart
      continue
    }
    i++
  }
  return out
}

/**
 * 逐步定速。
 * - `\tempo=N` 突变；
 * - `\accel` / `\rit` 从记号处到**下一个变速记号**之间按几何插值渐变到 1±amount 倍
 *   （几何而非线性：速度听感是比例的，60→78 和 78→101 才是同样的「快一档」）；
 * - `\atempo` 回到上一个变速记号生效前的速度。
 */
function resolveTempo(groups: FlatNote[][], baseBpm: number, amount: number): number[] {
  const marks = groups.map((g) => g.find((fn) => fn.ln.ev.tempoMark)?.ln.ev.tempoMark)
  const bpms = new Array<number>(groups.length)

  let bpm = baseBpm
  let beforeChange = baseBpm
  let ramp: { from: number; to: number; start: number; end: number } | null = null

  for (let i = 0; i < groups.length; i++) {
    const mk = marks[i]
    if (mk) {
      if (mk.kind === 'bpm' && mk.bpm) {
        beforeChange = bpm
        bpm = mk.bpm
        ramp = null
      } else if (mk.kind === 'atempo') {
        bpm = beforeChange
        ramp = null
      } else {
        beforeChange = bpm
        const factor = mk.kind === 'accel' ? 1 + amount : 1 - amount
        ramp = { from: bpm, to: bpm * factor, start: i, end: nextMarkAfter(marks, i) }
      }
    }

    if (ramp) {
      const span = Math.max(1, ramp.end - ramp.start)
      const progress = (i - ramp.start + 1) / span
      bpm = ramp.from * Math.pow(ramp.to / ramp.from, progress)
      if (i + 1 >= ramp.end) ramp = null // 渐变结束后停在终点速度
    }
    bpms[i] = bpm
  }
  return bpms
}

function nextMarkAfter(marks: (unknown | undefined)[], i: number): number {
  for (let j = i + 1; j < marks.length; j++) if (marks[j]) return j
  return marks.length
}

/**
 * 节拍点：**逐小节**数，拍位在小节内从 0 开始。
 * 这样曲中变拍号（一拍等于几个四分音符跟着变）不会把整条拍位网格顶歪，
 * 而且「第 0 拍 = 重拍」这条规则直接成立，不必再去比对小节头的绝对拍位。
 *
 * 唯一的例外是**弱起的第一小节**：引子那几拍本来就是从上一小节借来的，
 * 把它敲成重拍，整首的强弱就错开一格了。
 */
function collectBeats(steps: PlayStep[], meters: Map<number, Meter>, firstMeter: Meter): BeatMark[] {
  const beats: BeatMark[] = []
  const pickup = isPickup(steps, firstMeter)

  let posInMeasure = 0
  let lastMeasure = -1
  let lastPass = 0
  let firstMeasure = true

  for (const st of steps) {
    // 反复第二遍会再次走到同一个小节号，遍数一起比才认得出「新的一小节」
    if (st.measureIndex !== lastMeasure || st.pass !== lastPass) {
      if (lastMeasure !== -1) firstMeasure = false
      posInMeasure = 0
      lastMeasure = st.measureIndex
      lastPass = st.pass
    }

    const quartersPerBeat = 4 / (meters.get(st.measureIndex) ?? firstMeter).unit
    const quarters = st.covers.reduce((s, ev) => s + ev.duration, 0)
    const len = quarters / quartersPerBeat
    if (len <= 0) continue

    const from = posInMeasure
    const to = posInMeasure + len
    for (let k = Math.ceil(from - 1e-6); k < to - 1e-6; k++) {
      beats.push({
        time: st.start + ((k - from) / len) * st.duration,
        strong: k === 0 && !(firstMeasure && pickup),
      })
    }
    posInMeasure = to
  }
  return beats
}

/** 第一小节是不是弱起（拍数不足） */
function isPickup(steps: PlayStep[], meter: Meter): boolean {
  const first = steps[0]
  if (!first) return false
  const quartersPerBeat = 4 / meter.unit
  let len = 0
  for (const st of steps) {
    if (st.measureIndex !== first.measureIndex || st.pass !== first.pass) break
    len += st.covers.reduce((sum, ev) => sum + ev.duration, 0) / quartersPerBeat
  }
  return len < meter.beats - 1e-6
}

/**
 * 方框：罩住本步在**同一行**上的所有音符位。
 * 一个音跨行被延音线连过去时，只框住起吹那一行——跨行的框画不出连续的矩形。
 */
function boxOf(g: FlatNote[], bands: Bands): PlayBox {
  const head = g[0]
  const sameRow = g.filter((fn) => fn.page === head.page && fn.sysY === head.sysY)
  const xs = sameRow.map((fn) => fn.ln.x)
  const x1 = Math.min(...xs) - M.digitHalfW - 8
  const x2 = Math.max(...xs) + M.digitHalfW + 8
  const top = head.sysY + bands.digitBaseline - M.digitSize - 10
  const bottom = head.sysY + bands.digitsBottom + 8
  return { page: head.page, x: x1, y: top, w: x2 - x1, h: bottom - top }
}

/**
 * 绝对音高。
 *
 * 箫：`lookupFingering` 给的 index 就是「距筒音的半音数」，筒音音名由箫调决定
 * （G 调箫筒音 = D，F 调箫筒音 = C），取中央 C 往上那个八度——G 调箫筒音 = D4。
 * 简谱：与乐器无关，中音 1 就落在 C4~B4 这个八度里，其余音按调式半音数推。
 */
function frequencyOf(
  fingering: FingeringLookup | null,
  ev: NoteEvent,
  tongyinPc: number | null,
  tonicPc: number | null,
): number | null {
  if (ev.type !== 'note') return null

  const midi =
    tonicPc !== null
      ? 60 + tonicPc + semitoneOf(ev.degree, ev.octave, ev.accidental)
      : fingering && tongyinPc !== null
        ? 60 + tongyinPc + fingering.index
        : null

  if (midi === null || midi < 36 || midi > 108) return null
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** 时间 → 步号（二分；拖进度条时也要立刻对得上） */
export function stepIndexAt(timeline: Timeline, time: number): number {
  const steps = timeline.steps
  if (steps.length === 0) return 0
  let lo = 0
  let hi = steps.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (steps[mid].start <= time) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * 洞洞谱条实际用的位置：**整步停住，只在末尾很短的一段里滑向下一张**。
 *
 * 一开始用的是线性进度（`cursorAt`），结果快的曲子整条一直在匀速漂，
 * 眼睛根本锁不住中间那张。改成「停—滑—停」之后，每个音都有一段静止的时间给人看清，
 * 换音那一下又足够干脆。滑动段用 smoothstep，起止都不突兀。
 */
export function slideCursorAt(timeline: Timeline, time: number, transition = 0.16): number {
  const i = stepIndexAt(timeline, time)
  const st = timeline.steps[i]
  if (!st || st.duration <= 0) return i
  // 极短的音（十六分、三连音）不能按固定时长滑，否则它整个音都在动
  const trans = Math.min(transition, st.duration * 0.45)
  const from = st.start + st.duration - trans
  if (time <= from) return i
  const p = Math.min(1, Math.max(0, (time - from) / trans))
  return i + p * p * (3 - 2 * p)
}

/** 步号 + 步内进度（线性）。 */
export function cursorAt(timeline: Timeline, time: number): number {
  const i = stepIndexAt(timeline, time)
  const st = timeline.steps[i]
  if (!st || st.duration <= 0) return i
  return i + Math.min(1, Math.max(0, (time - st.start) / st.duration))
}

