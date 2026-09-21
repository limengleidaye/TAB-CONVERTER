/**
 * 动态谱播放窗。
 *
 * 上半：整页谱面，一个红框罩住当前正在吹的音，跟着速度走，行切换时自动滚动；
 * 下半：洞洞谱从右往左滑，中间一张最大 = 当前音，左右各两张是前两个 / 后两个。
 *
 * 三条铁律：
 *   1. **时钟以音频为准**。画面每帧从 AudioContext.currentTime 反推位置，
 *      而不是各走各的 —— rAF 在后台标签页会停，两个时钟必然漂开，声画就对不上了。
 *   2. **排期不挂在 rAF 上**，用定时器 + 两秒提前量。后台停掉的是 rAF，定时器只是被压慢，
 *      提前量比那个间隔大就断不了音（见 LOOKAHEAD）。
 *   3. **谱面 SVG 不参与每帧重绘**。方框是一个绝对定位的 div，按页面元素实测尺寸换算，
 *      整页上百个孔的 svg 只在开窗时渲染一次。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PlaybackAudio } from '../audio/engine'
import type { AmbiguousPolicy } from '../core/fingering/table'
import { M, layout as buildLayout, type Layout } from '../core/layout'
import {
  DEFAULT_BPM,
  DEFAULT_RAMP,
  buildTimeline,
  slideCursorAt,
  stepIndexAt,
  type PlayMode,
  type PlayStep,
  type Timeline,
} from '../core/playback'
import type { Issue, Score } from '../core/types'
import { FingeringCard, cardViewBox } from '../render/FingeringCard'
import { ScoreSvg } from '../render/ScoreSvg'

/**
 * 提前多少秒把音符排进音频时钟。
 * 必须大于浏览器在后台把定时器压慢的间隔（约 1 秒），否则一切到后台音就断。
 */
const LOOKAHEAD = 2

/** 前台的排期节奏；后台会被压慢，靠 LOOKAHEAD 兜住 */
const SCHEDULE_TICK = 120

/**
 * 洞洞谱条里的尺寸**全部从条子的实测高度推出来**，不写死像素。
 * 写死的话页面一放大，条子按 CSS 像素照常占位、可视高度却变小，上下的比例就跑了。
 */
const CARD_H_RATIO = 0.84
/** 相邻两张卡的中心距 = 卡片宽度 × 这个系数 */
const CARD_GAP_RATIO = 1.3
/** 两侧卡相对中间那张的大小 */
const SIDE_SCALE = 0.76
/** 最多往两边各铺几张（再多也出了屏） */
const MAX_HALF = 9

const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const

export interface PlayerDialogProps {
  score: Score
  layout: Layout
  /** 箫谱：谱面下面跟一条滑动洞洞谱，用合成箫音；简谱：只有谱面，用钢琴音 */
  mode: PlayMode
  ambiguousPolicy: AmbiguousPolicy
  /** 编译期的警告，开播前先让用户过一眼 */
  warnings: Issue[]
  onClose: () => void
}

export function PlayerDialog({
  score,
  layout,
  mode,
  ambiguousPolicy,
  warnings,
  onClose,
}: PlayerDialogProps) {
  const [confirmed, setConfirmed] = useState(warnings.length === 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="player-backdrop">
      {confirmed ? (
        <PlayerWindow
          score={score}
          layout={layout}
          mode={mode}
          ambiguousPolicy={ambiguousPolicy}
          onClose={onClose}
        />
      ) : (
        <CheckPanel warnings={warnings} onPlay={() => setConfirmed(true)} onCancel={onClose} />
      )}
    </div>
  )
}

/** 开播前的体检：错误在主界面就拦住了（渲染不出谱），这里只剩警告要确认 */
function CheckPanel({
  warnings,
  onPlay,
  onCancel,
}: {
  warnings: Issue[]
  onPlay: () => void
  onCancel: () => void
}) {
  return (
    <div className="player-check">
      <h2>谱子有 {warnings.length} 处警告</h2>
      <p className="hint">拍数不对的小节会照着写出来的时值播，听上去就会和预期错位。</p>
      <ul>
        {warnings.slice(0, 12).map((w, i) => (
          <li key={i}>{w.message}</li>
        ))}
        {warnings.length > 12 ? <li>…… 另有 {warnings.length - 12} 条</li> : null}
      </ul>
      <div className="modal-actions">
        <button onClick={onCancel}>返回修改</button>
        <button className="primary" onClick={onPlay}>
          仍然播放
        </button>
      </div>
    </div>
  )
}

interface PageGeom {
  top: number
  left: number
  w: number
  h: number
}

function PlayerWindow({
  score,
  layout,
  mode,
  ambiguousPolicy,
  onClose,
}: {
  score: Score
  layout: Layout
  mode: PlayMode
  ambiguousPolicy: AmbiguousPolicy
  onClose: () => void
}) {
  const showStrip = mode === 'xiao'
  const instrument = mode === 'xiao' ? 'xiao' : 'piano'
  const [bpm, setBpm] = useState(() =>
    score.header.速度 && score.header.速度 > 0 ? score.header.速度 : DEFAULT_BPM,
  )
  const [ramp, setRamp] = useState(DEFAULT_RAMP)
  const [rate, setRate] = useState(1)
  const [sound, setSound] = useState(true)
  const [metro, setMetro] = useState(true)
  const [countIn, setCountIn] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [geom, setGeom] = useState<PageGeom[]>([])
  const [strip, setStrip] = useState({ w: 900, h: 280 })

  /**
   * 播放窗自己排一份**不带洞洞谱**的谱面：下半条已经是洞洞谱了，上面再来一遍纯属重复，
   * 而且占掉的竖向空间正是一屏能看几行的关键。折行位置与打印谱保持一致。
   */
  const playLayout = useMemo(
    () => buildLayout(score, layout.keySignature, { omitFingering: true }),
    [score, layout.keySignature],
  )

  const timeline = useMemo(
    () => buildTimeline(score, playLayout, { baseBpm: bpm, rampAmount: ramp, mode }),
    [score, playLayout, bpm, ramp, mode],
  )

  const audioRef = useRef<PlaybackAudio | null>(null)
  if (!audioRef.current) audioRef.current = new PlaybackAudio()
  const audio = audioRef.current

  const timeRef = useRef(0)
  const anchorRef = useRef(0)
  const nextStepRef = useRef(0)
  const nextClickRef = useRef(0)
  /** 改 BPM / 渐变幅度会重算时间轴，用步号把播放位置搬过去，免得跳到别处 */
  const remapRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => audio.close(), [audio])

  const clockNow = useCallback(
    () => (audio.available ? audio.now : performance.now() / 1000),
    [audio],
  )

  // ---- 预备拍 + 节拍器的响点 ----
  const secPerBeat = (60 / timeline.baseBpm) * timeline.quartersPerBeat
  const countInDur = countIn ? secPerBeat * Math.max(1, Math.round(timeline.beatsPerMeasure)) : 0
  const clicks = useMemo(() => {
    const out: { time: number; strong: boolean }[] = []
    if (countIn) {
      const n = Math.max(1, Math.round(timeline.beatsPerMeasure))
      for (let i = 0; i < n; i++) out.push({ time: -(n - i) * secPerBeat, strong: i === 0 })
    }
    if (metro) out.push(...timeline.beats)
    return out
  }, [countIn, metro, timeline, secPerBeat])

  const seekTo = useCallback(
    (t: number) => {
      timeRef.current = Math.min(timeline.duration, Math.max(0, t))
      setTime(timeRef.current)
      audio.stopAll()
      anchorRef.current = clockNow() - timeRef.current / rate
      nextStepRef.current = firstAtOrAfter(timeline.steps, (s) => s.start, timeRef.current)
      nextClickRef.current = firstAtOrAfter(clicks, (c) => c.time, timeRef.current)
    },
    [audio, clicks, clockNow, rate, timeline],
  )

  // 时间轴重算后，把播放位置搬到原来那一步的开头
  useEffect(() => {
    const idx = remapRef.current
    remapRef.current = null
    if (idx === null) return
    const st = timeline.steps[Math.min(idx, timeline.steps.length - 1)]
    timeRef.current = st?.start ?? 0
    setTime(timeRef.current)
  }, [timeline])

  // ---- 主循环：排期用定时器，画面用 rAF，位置都从音频时钟反推 ----
  //
  // 排期**不能**挂在 rAF 上：切到后台标签页浏览器就把 rAF 停了，没人再往音频时钟里排音，
  // 已排的那点提前量放完就静音；切回来又会把这期间早该响的音一次性补排，全挤在一起炸响。
  // 定时器在后台只是被压慢（约 1 秒一次），提前量比它大就断不了。
  useEffect(() => {
    if (!playing) return

    anchorRef.current = clockNow() - timeRef.current / rate
    nextStepRef.current = firstAtOrAfter(timeline.steps, (s) => s.start, timeRef.current)
    nextClickRef.current = firstAtOrAfter(clicks, (c) => c.time, timeRef.current)

    /** 当前播放位置（秒），顺带写回 ref */
    const position = () => {
      const t = Math.min(timeline.duration, (clockNow() - anchorRef.current) * rate)
      timeRef.current = t
      return t
    }

    const schedule = () => {
      const t = position()
      const horizon = t + LOOKAHEAD * rate
      const steps = timeline.steps
      while (nextStepRef.current < steps.length && steps[nextStepRef.current].start < horizon) {
        const st = steps[nextStepRef.current++]
        if (sound && st.freq) {
          audio.note(st.freq, anchorRef.current + st.start / rate, st.duration / rate, instrument)
        }
      }
      while (nextClickRef.current < clicks.length && clicks[nextClickRef.current].time < horizon) {
        const c = clicks[nextClickRef.current++]
        audio.click(anchorRef.current + c.time / rate, c.strong)
      }
      // 收尾判定也放在这里：后台只有定时器还在跑
      if (t >= timeline.duration) {
        setTime(t)
        setPlaying(false)
      }
    }

    schedule()
    const timer = setInterval(schedule, SCHEDULE_TICK)

    // 画面：后台停掉正好省电，切回来按音频时钟重新对位即可
    let raf = 0
    const draw = () => {
      setTime(position())
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      clearInterval(timer)
      cancelAnimationFrame(raf)
      audio.stopAll()
    }
  }, [playing, rate, sound, clicks, timeline, audio, clockNow, instrument])

  const toggle = useCallback(async () => {
    if (playing) {
      setPlaying(false)
      return
    }
    try {
      await audio.resume()
    } catch {
      /* 浏览器不给声音就静着播，画面照常 */
    }
    if (timeRef.current >= timeline.duration - 1e-6) timeRef.current = 0
    if (countInDur > 0 && timeRef.current <= 0) timeRef.current = -countInDur
    setTime(timeRef.current)
    setPlaying(true)
  }, [audio, countInDur, playing, timeline.duration])

  const restart = useCallback(() => {
    // 从预备拍前面起算，排期索引也要一起退回去，否则预备拍会被跳过
    const from = countInDur > 0 ? -countInDur : 0
    timeRef.current = from
    setTime(from)
    audio.stopAll()
    anchorRef.current = clockNow() - from / rate
    nextStepRef.current = 0
    nextClickRef.current = firstAtOrAfter(clicks, (c) => c.time, from)
    setPlaying(true)
  }, [audio, clicks, clockNow, countInDur, rate])

  // ---- 键盘：空格播放/暂停，左右各跳 5 秒 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        void toggle()
      } else if (e.key === 'ArrowRight') {
        seekTo(timeRef.current + 5)
      } else if (e.key === 'ArrowLeft') {
        seekTo(timeRef.current - 5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seekTo, toggle])

  // ---- 页面元素实测：方框与自动滚动都按这个换算 ----
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const pages = Array.from(el.querySelectorAll<HTMLElement>('.player-page'))
      setGeom(pages.map((p) => ({ top: p.offsetTop, left: p.offsetLeft, w: p.clientWidth, h: p.clientHeight })))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [playLayout])

  // 条子多大，卡片就多大、铺多少张
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const measure = () => setStrip({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const clamped = Math.max(0, time)
  const stepIndex = stepIndexAt(timeline, clamped)
  const cursor = slideCursorAt(timeline, clamped)
  const current: PlayStep | undefined = timeline.steps[stepIndex]
  const counting = time < 0 ? Math.ceil(-time / secPerBeat) : 0

  // 当前音换行了就把那一行滚进视野
  useEffect(() => {
    const el = scrollRef.current
    const box = current?.box
    const g = box ? geom[box.page] : undefined
    if (!el || !box || !g) return
    const top = g.top + (box.y / M.pageH) * g.h
    const h = (box.h / M.pageH) * g.h
    if (top < el.scrollTop + 24 || top + h > el.scrollTop + el.clientHeight - 24) {
      el.scrollTo({ top: Math.max(0, top - el.clientHeight * 0.32), behavior: 'smooth' })
    }
  }, [current, geom])

  const changeTempo = (next: () => void) => {
    remapRef.current = stepIndex
    next()
  }

  if (timeline.steps.length === 0) {
    return (
      <div className="player-check">
        <h2>这首谱还没有音符</h2>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    )
  }

  const box = current?.box
  const g = box ? geom[box.page] : undefined

  // 卡片高度取条子高度的固定比例，宽度由洞洞谱一列自身的长宽比反推
  const cardH = Math.max(80, strip.h * CARD_H_RATIO)
  const shape = cardViewBox(current?.ev.octave ?? 0)
  const cardW = (cardH * shape.w) / shape.h
  const pitch = cardW * CARD_GAP_RATIO
  const half = Math.min(MAX_HALF, Math.ceil(strip.w / 2 / pitch) + 1)

  return (
    <div className="player">
      <header className="player-head">
        <strong>{score.header.标题 || '未命名'}</strong>
        <span className="player-meta">
          第 {current?.measureIndex ?? 1} 小节
          {current && current.pass > 1 ? `（第 ${current.pass} 遍）` : ''}
          　♩={Math.round(current?.bpm ?? timeline.baseBpm)}
          {rate !== 1 ? ` ×${rate}` : ''}
          　{fmtTime(clamped)} / {fmtTime(timeline.duration)}
        </span>
        <button className="player-close" onClick={onClose} title="关闭（Esc）">
          ✕
        </button>
      </header>

      <div className="player-score" ref={scrollRef}>
        <ScorePages score={score} layout={playLayout} ambiguousPolicy={ambiguousPolicy} />
        {box && g ? (
          <div
            className="player-cursor"
            style={{
              left: g.left + (box.x / M.pageW) * g.w,
              top: g.top + (box.y / M.pageH) * g.h,
              width: (box.w / M.pageW) * g.w,
              height: (box.h / M.pageH) * g.h,
            }}
          />
        ) : null}
      </div>

      {showStrip ? (
      <div className="player-strip" ref={stripRef}>
        <div
          className="player-strip-center"
          style={{ width: cardW + 14, height: cardH + 16 }}
        />
        {visibleCards(timeline, cursor, half).map(({ step, rel }) => {
          // 只有中间那张大，两侧一律同一个尺寸；离中心越远越小会看得人发晕
          const near = Math.max(0, 1 - Math.abs(rel))
          const scale = SIDE_SCALE + (1 - SIDE_SCALE) * near
          return (
            <div
              key={step.index}
              className="player-card"
              style={{
                height: cardH,
                transform: `translate(-50%, -50%) translateX(${(rel * pitch).toFixed(1)}px) scale(${scale.toFixed(3)})`,
                zIndex: near > 0.5 ? 10 : 5,
              }}
            >
              <FingeringCard step={step} policy={ambiguousPolicy} />
            </div>
          )
        })}
        {counting > 0 ? <div className="player-countdown">{counting}</div> : null}
      </div>
      ) : counting > 0 ? (
        <div className="player-countdown player-countdown-overlay">{counting}</div>
      ) : null}

      <div className="player-bar">
        <button className="primary" onClick={() => void toggle()}>
          {playing ? '暂停' : '播放'}
        </button>
        <button onClick={restart}>重播</button>

        <input
          className="player-seek"
          type="range"
          min={0}
          max={timeline.duration}
          step={0.01}
          value={clamped}
          onChange={(e) => seekTo(Number(e.target.value))}
          title="拖到任意位置开始"
        />

        <label>
          倍速
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>

        <label>
          ♩=
          <input
            className="player-bpm"
            type="number"
            min={20}
            max={240}
            value={bpm}
            onChange={(e) => changeTempo(() => setBpm(clampBpm(Number(e.target.value))))}
          />
        </label>

        <label title="accel. / rit. 渐变到基准速度的几成">
          渐变 ±{Math.round(ramp * 100)}%
          <input
            type="range"
            min={0}
            max={0.6}
            step={0.05}
            value={ramp}
            onChange={(e) => changeTempo(() => setRamp(Number(e.target.value)))}
          />
        </label>

        <label>
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
          {mode === 'xiao' ? '箫声' : '钢琴'}
        </label>
        <label>
          <input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} />
          节拍器
        </label>
        <label>
          <input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
          预备拍
        </label>
      </div>

      <p className="player-note">
        空格播放/暂停，←→ 各跳 5 秒。
        {timeline.expanded ? '反复记号已按实际演奏顺序展开。' : ''}
        {score.measures.some((m) => m.marks.length > 0) ? 'D.C. / D.S. / Coda / Fine 不参与播放。' : ''}
        {timeline.headerBpm ? '' : '谱头没写「速度」，当前按默认 BPM 播放。'}
      </p>
    </div>
  )
}

/** 谱面整页只渲染一次；每帧变的只有上面那个方框 div */
const ScorePages = memo(function ScorePages({
  score,
  layout,
  ambiguousPolicy,
}: {
  score: Score
  layout: Layout
  ambiguousPolicy: AmbiguousPolicy
}) {
  return (
    <>
      {layout.pages.map((_, i) => (
        <div className="player-page" key={i}>
          <ScoreSvg score={score} layout={layout} pageIndex={i} ambiguousPolicy={ambiguousPolicy} />
        </div>
      ))}
    </>
  )
})

/** 当前音前后各 half 张；超出条子的会被 overflow 裁掉，这正是「滑进来/滑出去」的样子 */
function visibleCards(
  timeline: Timeline,
  cursor: number,
  half: number,
): { step: PlayStep; rel: number }[] {
  const out: { step: PlayStep; rel: number }[] = []
  const center = Math.round(cursor)
  for (let i = center - half; i <= center + half; i++) {
    const step = timeline.steps[i]
    if (!step) continue
    out.push({ step, rel: i - cursor })
  }
  return out
}

function firstAtOrAfter<T>(arr: readonly T[], key: (x: T) => number, t: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (key(arr[mid]) < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function clampBpm(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BPM
  return Math.min(240, Math.max(20, Math.round(n)))
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
