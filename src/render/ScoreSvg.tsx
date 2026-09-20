/**
 * 布局模型 → SVG。纯展示，不做任何计算决策。
 *
 * 所有竖向位置都来自 layout.bands（按内容实测算出），组件内不写死 y 常量，
 * 否则减时线多一条、低音点多一个就会压到下一行。
 */

import { Fragment, createContext, useContext, useId } from 'react'
import { HOLE, resolveHole, type AmbiguousPolicy } from '../core/fingering/table'
import {
  M,
  type ArcSeg,
  type BeamSeg,
  type Bands,
  type LaidMeasure,
  type Page,
  type LaidNote,
  type Layout,
  type System,
  type TupletSeg,
} from '../core/layout'
import type { NoteEvent, Score } from '../core/types'
import { PANDA_HOLE_PNG } from './panda'

export const COLORS = {
  ink: '#1a1a1a',
  paper: '#FEFEFC',
  tube: '#F9B556',
  holeOpen: '#FFFFFF',
  holeEdge: '#E0973C',
  watermark: '#E6E6E6',
  warn: '#C98A00',
}

const DIGIT_FONT = '"Times New Roman", "Nimbus Roman", "SimSun", serif'
const TEXT_FONT = '"Noto Serif SC", "Source Han Serif SC", "SimSun", "Microsoft YaHei", serif'

const FALLBACK_BANDS: Bands = {
  tempoY: 16,
  arcY: 14,
  digitBaseline: 44,
  digitsBottom: 58,
  fermataY: 16,
  lyricBaseline: 58,
  fingeringTop: 72,
  fingerLabelH: M.fingerLabelHBase,
  fingerH: M.fingerLabelHBase + M.fingerCellH * 8 + M.fingerSepH * 2,
  systemHeight: 250,
}

const BandsContext = createContext<Bands>(FALLBACK_BANDS)
const useBands = () => useContext(BandsContext)

/**
 * <defs> 里的 id 按 svg 实例取唯一值。
 * 教程弹窗里会同时挂十几张片段 svg，固定 id 会在同一文档里重复，
 * 而 url(#id) 是全文档解析的——重复 id 属于未定义行为，别赌它。
 */
interface DefsIds {
  panda: string
  halfClip: string
}
const DefsContext = createContext<DefsIds>({ panda: 'hole-panda', halfClip: 'hole-half-left' })
const useDefsIds = () => useContext(DefsContext)

/**
 * 片段模式：教程里的小例子用。去掉谱头/页脚/水印，viewBox 裁到第一行谱，
 * 这样示例图和正式输出走的是同一套渲染代码，不会出现「文档和实现对不上」。
 */
export interface SnippetOptions {
  /** 只讲节奏的例子可以关掉洞洞谱，省得一屏塞不下 */
  hideFingering?: boolean
}

export interface ScoreSvgProps {
  score: Score
  layout: Layout
  pageIndex: number
  watermark?: string
  ambiguousPolicy?: AmbiguousPolicy
  /** 需要标黄的小节号 */
  warnMeasures?: Set<number>
  snippet?: SnippetOptions
}

export function ScoreSvg({
  score,
  layout,
  pageIndex,
  watermark,
  ambiguousPolicy = '闭',
  warnMeasures,
  snippet,
}: ScoreSvgProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ids: DefsIds = { panda: `hole-panda-${uid}`, halfClip: `hole-half-${uid}` }

  const page = layout.pages[pageIndex]
  if (!page) return null

  const view = snippet ? snippetViewBox(page, layout, snippet) : null
  const vb = view ?? { x: 0, y: 0, w: M.pageW, h: M.pageH }

  return (
    <BandsContext.Provider value={layout.bands}>
     <DefsContext.Provider value={ids}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        width={vb.w}
        height={vb.h}
        style={{ background: COLORS.paper, maxWidth: '100%', height: 'auto', display: 'block' }}
      >
        <defs>
          {/*
            熊猫图章只在这里内联一次，孔位用 fill="url(#…)" 引用。
            整页上百个孔，若每个孔各写一份 data URI，SVG 会膨胀到几 MB。
            patternContentUnits=objectBoundingBox 让图按引用它的圆自动缩放。
          */}
          <pattern
            id={ids.panda}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width={1}
            height={1}
          >
            <image href={PANDA_HOLE_PNG} x={0} y={0} width={1} height={1} preserveAspectRatio="none" />
          </pattern>

          {/* objectBoundingBox：按元素自身包围盒裁一半，与它画在哪无关 */}
          <clipPath id={ids.halfClip} clipPathUnits="objectBoundingBox">
            <rect x={0} y={0} width={0.5} height={1} />
          </clipPath>
        </defs>

        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={COLORS.paper} />
        {watermark && !snippet ? <Watermark text={watermark} /> : null}

        {pageIndex === 0 && !snippet ? (
          <HeaderBlock score={score} keySignature={layout.keySignature} />
        ) : null}

        {(snippet ? page.systems.slice(0, 1) : page.systems).map((sys, i) => (
          <SystemView
            key={i}
            system={sys}
            hasLyrics={layout.hasLyrics}
            ambiguousPolicy={ambiguousPolicy}
            warnMeasures={warnMeasures}
            hideFingering={snippet?.hideFingering ?? false}
          />
        ))}

        {snippet ? null : (
          <Footer title={score.header.标题} pageIndex={pageIndex} pageCount={layout.pages.length} />
        )}
      </svg>
     </DefsContext.Provider>
    </BandsContext.Provider>
  )
}

/** 片段模式的裁剪框：贴着第一行谱的实际内容，左右各留一点边 */
function snippetViewBox(page: Page, layout: Layout, opts: SnippetOptions) {
  const sys = page.systems[0]
  if (!sys) return null
  const padX = 10
  const padY = 6
  const bottom = opts.hideFingering ? layout.bands.lyricBaseline + 6 : layout.bands.fingerH + layout.bands.fingeringTop
  return {
    x: M.marginX - padX,
    y: sys.y,
    w: sys.width + padX * 2,
    h: bottom + padY,
  }
}

/* ---------------- 谱头 / 页脚 / 水印 ---------------- */

function HeaderBlock({ score, keySignature }: { score: Score; keySignature: string | null }) {
  const h = score.header
  const infoParts = [
    keySignature ?? undefined,
    `${h.拍号.beats}/${h.拍号.unit}`,
    h.速度 ? `♩=${h.速度}` : undefined,
  ].filter(Boolean)

  const titleY = M.marginTop + 44
  const lineY = titleY + 38

  return (
    <g>
      <text
        x={M.pageW / 2}
        y={titleY}
        textAnchor="middle"
        fontFamily={TEXT_FONT}
        fontSize={M.titleSize}
        fontWeight={700}
        fill={COLORS.ink}
      >
        {h.标题}
      </text>

      <text x={M.marginX} y={lineY} fontFamily={TEXT_FONT} fontSize={M.subtitleSize} fill={COLORS.ink}>
        {infoParts.join('  ')}
      </text>

      {h.副标题 ? (
        <text
          x={M.pageW / 2}
          y={lineY}
          textAnchor="middle"
          fontFamily={TEXT_FONT}
          fontSize={M.subtitleSize}
          fill={COLORS.ink}
        >
          {h.副标题}
        </text>
      ) : null}

      {h.制谱 ? (
        <text
          x={M.pageW - M.marginX}
          y={lineY}
          textAnchor="end"
          fontFamily={TEXT_FONT}
          fontSize={M.subtitleSize}
          fill={COLORS.ink}
        >
          {`${h.制谱}制谱`}
        </text>
      ) : null}
    </g>
  )
}

function Footer({ title, pageIndex, pageCount }: { title: string; pageIndex: number; pageCount: number }) {
  return (
    <text
      x={M.pageW / 2}
      y={M.pageH - 40}
      textAnchor="middle"
      fontFamily={TEXT_FONT}
      fontSize={16}
      fill={COLORS.ink}
    >
      {`《${title}》 总${pageCount}页，第${pageIndex + 1}页`}
    </text>
  )
}

function Watermark({ text }: { text: string }) {
  const stepX = 420
  const stepY = 320
  const cells: JSX.Element[] = []
  for (let y = -stepY; y < M.pageH + stepY; y += stepY) {
    for (let x = -stepX; x < M.pageW + stepX; x += stepX) {
      cells.push(
        <text
          key={`${x}-${y}`}
          x={x}
          y={y}
          fontFamily={TEXT_FONT}
          fontSize={92}
          fontWeight={700}
          fill={COLORS.watermark}
          transform={`rotate(-45 ${x} ${y})`}
        >
          {text}
        </text>,
      )
    }
  }
  return <g aria-hidden>{cells}</g>
}

/* ---------------- 系统（一行谱） ---------------- */

function SystemView({
  system,
  hasLyrics,
  ambiguousPolicy,
  warnMeasures,
  hideFingering,
}: {
  system: System
  hasLyrics: boolean
  ambiguousPolicy: AmbiguousPolicy
  warnMeasures?: Set<number>
  hideFingering: boolean
}) {
  return (
    <g transform={`translate(0 ${system.y})`}>
      {system.measures.map((lm) => (
        <MeasureView
          key={lm.measure.index}
          lm={lm}
          hasLyrics={hasLyrics}
          ambiguousPolicy={ambiguousPolicy}
          warn={warnMeasures?.has(lm.measure.index) ?? false}
          hideFingering={hideFingering}
        />
      ))}
      {system.beams.map((b, i) => (
        <Beam key={i} seg={b} />
      ))}
      {system.arcs.map((a, i) => (
        <Arc key={i} seg={a} />
      ))}
      {system.tuplets.map((t, i) => (
        <TupletBracket key={i} seg={t} />
      ))}
    </g>
  )
}


/** Segno / Coda 是跳转目标，标在小节开头；其余标在小节末尾 */
const MARK_AT_START = new Set(['Segno', 'Coda'])
const MARK_GLYPH: Record<string, string> = { Segno: '%', Coda: '\u2295' }

function MeasureView({
  lm,
  hasLyrics,
  ambiguousPolicy,
  warn,
  hideFingering,
}: {
  lm: LaidMeasure
  hasLyrics: boolean
  ambiguousPolicy: AmbiguousPolicy
  warn: boolean
  hideFingering: boolean
}) {
  const bands = useBands()
  const m = lm.measure
  const markY = Math.max(bands.arcY - 10, 10)

  return (
    <g>
      {warn ? (
        <rect
          x={lm.x - 4}
          y={2}
          width={lm.width}
          height={bands.systemHeight - 8}
          fill="none"
          stroke={COLORS.warn}
          strokeDasharray="4 4"
          strokeWidth={1}
          rx={4}
        />
      ) : null}

      {m.volta ? (
        <g>
          <path
            d={`M ${lm.x} ${markY + 4} v -12 h ${lm.width - M.measureGap}`}
            fill="none"
            stroke={COLORS.ink}
            strokeWidth={1.4}
          />
          <text x={lm.x + 5} y={markY + 2} fontFamily={DIGIT_FONT} fontSize={14} fill={COLORS.ink}>
            {`${m.volta}.`}
          </text>
        </g>
      ) : null}

      {/*
        段落记号按惯例分左右：Segno / Coda 标在小节开头（跳转目标），
        D.C. / D.S. / Fine 标在小节末尾（读到这里才执行）。
      */}
      {m.marks
        .filter((mk) => MARK_AT_START.has(mk))
        .map((mk, i) => (
          <text
            key={`s${i}`}
            x={lm.x + 2}
            y={markY}
            fontFamily={TEXT_FONT}
            fontSize={16}
            fill={COLORS.ink}
          >
            {MARK_GLYPH[mk] ?? mk}
          </text>
        ))}
      {m.marks
        .filter((mk) => !MARK_AT_START.has(mk))
        .map((mk, i) => (
          <text
            key={`e${i}`}
            x={lm.barX - 4}
            y={markY}
            textAnchor="end"
            fontFamily={TEXT_FONT}
            fontSize={15}
            fontStyle="italic"
            fill={COLORS.ink}
          >
            {MARK_GLYPH[mk] ?? mk}
          </text>
        ))}

      {m.openBarline === 'repeatStart' ? <Barline x={lm.x - 8} kind="repeatStart" /> : null}

      {lm.notes.map((ln, i) => (
        <Fragment key={i}>
          <NoteGlyph ln={ln} />
          {hasLyrics && ln.ev.lyric ? (
            <text
              x={ln.x}
              y={bands.lyricBaseline}
              textAnchor="middle"
              fontFamily={TEXT_FONT}
              fontSize={M.lyricSize}
              fill={COLORS.ink}
            >
              {ln.ev.lyric}
            </text>
          ) : null}
          {!hideFingering && ln.showFingering && ln.fingering?.holes ? (
            <FingeringColumn
              x={ln.x}
              top={bands.fingeringTop}
              holes={ln.fingering.holes}
              ev={ln.ev}
              policy={ambiguousPolicy}
            />
          ) : null}
        </Fragment>
      ))}

      <Barline x={lm.barX} kind={m.closeBarline} />
    </g>
  )
}

/* ---------------- 简谱元素 ---------------- */

function NoteGlyph({ ln }: { ln: LaidNote }) {
  const bands = useBands()
  const ev = ln.ev
  const y = bands.digitBaseline

  if (ev.type === 'dash') {
    return <rect x={ln.x - 10} y={y - 11} width={20} height={3.2} fill={COLORS.ink} />
  }

  return (
    <g>
      {ev.tempoMark ? <TempoGlyph ev={ev} x={ln.x} /> : null}
      {ev.fermata ? <FermataGlyph x={ln.x} /> : null}
      {ev.graces?.length ? <GraceGlyphs ev={ev} x={ln.x} /> : null}

      {ev.accidental ? (
        <text
          x={ln.x - M.digitHalfW - 3}
          y={y - 15}
          textAnchor="end"
          fontFamily={DIGIT_FONT}
          fontSize={16}
          fill={COLORS.ink}
        >
          {ev.accidental === '#' ? '♯' : ev.accidental === 'b' ? '♭' : '♮'}
        </text>
      ) : null}

      <text
        x={ln.x}
        y={y}
        textAnchor="middle"
        fontFamily={DIGIT_FONT}
        fontSize={M.digitSize}
        fontWeight={600}
        fill={COLORS.ink}
      >
        {ev.degree}
      </text>

      {ev.dotted ? <circle cx={ln.x + M.digitHalfW + 6} cy={y - 9} r={2.6} fill={COLORS.ink} /> : null}

      <OctaveDots ev={ev} x={ln.x} />
    </g>
  )
}

function OctaveDots({ ev, x }: { ev: NoteEvent; x: number }) {
  const bands = useBands()
  if (ev.octave === 0 || ev.type !== 'note') return null

  const dots: JSX.Element[] = []
  const n = Math.abs(ev.octave)

  if (ev.octave > 0) {
    for (let k = 0; k < n; k++) {
      dots.push(
        <circle
          key={k}
          cx={x}
          cy={bands.digitBaseline - M.digitSize - 3 - k * M.octaveDotStep}
          r={M.octaveDotR}
          fill={COLORS.ink}
        />,
      )
    }
  } else {
    // 低音点画在本音自己的减时线下方
    const base = bands.digitBaseline + M.beamGap + Math.max(ev.beams, 0) * M.beamStep + 5
    for (let k = 0; k < n; k++) {
      dots.push(<circle key={k} cx={x} cy={base + k * M.octaveDotStep} r={M.octaveDotR} fill={COLORS.ink} />)
    }
  }
  return <g>{dots}</g>
}

function TempoGlyph({ ev, x }: { ev: NoteEvent; x: number }) {
  const bands = useBands()
  const t = ev.tempoMark!

  const label =
    t.kind === 'bpm'
      ? `♩=${t.bpm}`
      : t.kind === 'accel'
        ? 'accel.'
        : t.kind === 'rit'
          ? 'rit.'
          : 'a tempo'
  return (
    <text
      x={x}
      y={bands.tempoY}
      textAnchor="middle"
      fontFamily={TEXT_FONT}
      fontSize={14}
      fontStyle="italic"
      fill={COLORS.ink}
    >
      {label}
    </text>
  )
}

/** 自己画，不用 𝄐 (U+1D110)：多数中文字体没有这个字形，会出豆腐块 */
function FermataGlyph({ x }: { x: number }) {
  const bands = useBands()
  const y = bands.fermataY
  return (
    <g>
      <path
        d={`M ${x - 7} ${y} A 7 7 0 0 1 ${x + 7} ${y}`}
        fill="none"
        stroke={COLORS.ink}
        strokeWidth={1.3}
      />
      <circle cx={x} cy={y - 2.5} r={1.5} fill={COLORS.ink} />
    </g>
  )
}

/** 倚音：小号数字 + 双减时线 + 一条连向主音的小弧（§3.6） */
function GraceGlyphs({ ev, x }: { ev: NoteEvent; x: number }) {
  const bands = useBands()
  const graces = ev.graces!
  const size = 15
  const step = 12
  const startX = x - M.digitHalfW - 6 - (graces.length - 1) * step
  const y = bands.digitBaseline - 16

  return (
    <g>
      {graces.map((g, i) => {
        const gx = startX + i * step
        return (
          <Fragment key={i}>
            <text
              x={gx}
              y={y}
              textAnchor="middle"
              fontFamily={DIGIT_FONT}
              fontSize={size}
              fontWeight={600}
              fill={COLORS.ink}
            >
              {g.degree}
            </text>
            <rect x={gx - 5} y={y + 2.5} width={10} height={1.2} fill={COLORS.ink} />
            <rect x={gx - 5} y={y + 5.5} width={10} height={1.2} fill={COLORS.ink} />
            {g.octave !== 0 ? (
              <circle cx={gx} cy={g.octave > 0 ? y - size - 1 : y + 11} r={1.6} fill={COLORS.ink} />
            ) : null}
          </Fragment>
        )
      })}
      <path
        d={`M ${startX} ${y + 9} Q ${x - M.digitHalfW - 6} ${y + 15} ${x - M.digitHalfW - 1} ${y + 8}`}
        fill="none"
        stroke={COLORS.ink}
        strokeWidth={1.1}
      />
    </g>
  )
}

function Beam({ seg }: { seg: BeamSeg }) {
  const bands = useBands()
  const y = bands.digitBaseline + M.beamGap + (seg.level - 1) * M.beamStep
  return <rect x={seg.x1} y={y} width={seg.x2 - seg.x1} height={M.beamThickness} fill={COLORS.ink} />
}

function Arc({ seg }: { seg: ArcSeg }) {
  const bands = useBands()
  const mid = (seg.x1 + seg.x2) / 2
  const depth = Math.min(16, 6 + (seg.x2 - seg.x1) * 0.06)
  return (
    <path
      d={`M ${seg.x1} ${bands.arcY} Q ${mid} ${bands.arcY - depth} ${seg.x2} ${bands.arcY}`}
      fill="none"
      stroke={COLORS.ink}
      strokeWidth={1.4}
    />
  )
}

function TupletBracket({ seg }: { seg: TupletSeg }) {
  const bands = useBands()
  const y = bands.arcY - 4
  const mid = (seg.x1 + seg.x2) / 2
  return (
    <g>
      <path
        d={`M ${seg.x1} ${y + 5} v -5 h ${seg.x2 - seg.x1} v 5`}
        fill="none"
        stroke={COLORS.ink}
        strokeWidth={1.1}
      />
      <rect x={mid - 7} y={y - 9} width={14} height={11} fill={COLORS.paper} />
      <text x={mid} y={y} textAnchor="middle" fontFamily={DIGIT_FONT} fontSize={13} fill={COLORS.ink}>
        {seg.n}
      </text>
    </g>
  )
}

function Barline({ x, kind }: { x: number; kind: 'single' | 'final' | 'repeatStart' | 'repeatEnd' }) {
  const bands = useBands()
  const top = bands.digitBaseline - M.digitSize - 2
  const bottom = bands.digitBaseline + 14

  if (kind === 'single') {
    return <rect x={x} y={top} width={1.4} height={bottom - top} fill={COLORS.ink} />
  }
  if (kind === 'final') {
    return (
      <g>
        <rect x={x - 6} y={top} width={1.4} height={bottom - top} fill={COLORS.ink} />
        <rect x={x - 1} y={top} width={3.6} height={bottom - top} fill={COLORS.ink} />
      </g>
    )
  }
  const dotsX = kind === 'repeatStart' ? x + 8 : x - 8
  return (
    <g>
      <rect x={kind === 'repeatStart' ? x : x + 2} y={top} width={3.6} height={bottom - top} fill={COLORS.ink} />
      <rect
        x={kind === 'repeatStart' ? x + 5.5 : x - 2}
        y={top}
        width={1.4}
        height={bottom - top}
        fill={COLORS.ink}
      />
      <circle cx={dotsX} cy={top + (bottom - top) * 0.35} r={2} fill={COLORS.ink} />
      <circle cx={dotsX} cy={top + (bottom - top) * 0.65} r={2} fill={COLORS.ink} />
    </g>
  )
}

/* ---------------- 洞洞谱 ---------------- */

/** 分段：[标签 + 第八~第五孔] / [第四~第二孔] / [第一孔]（与原图一致） */
const SEGMENTS: number[][] = [
  [0, 1, 2, 3],
  [4, 5, 6],
  [7],
]

/**
 * 第八孔（最上）与第一孔（最下）在原图里是向左错开画的，用来标出这两个孔的特殊；
 * 中间六个孔居中。holeIdx 0 = 第八孔，7 = 第一孔。
 */
const EDGE_HOLES = new Set([0, 7])

function holeCenterX(x: number, holeIdx: number): number {
  return EDGE_HOLES.has(holeIdx) ? x - M.edgeHoleShift : x
}

function FingeringColumn({
  x,
  top,
  holes,
  ev,
  policy,
}: {
  x: number
  top: number
  holes: Uint8Array
  ev: NoteEvent
  policy: AmbiguousPolicy
}) {
  const bands = useBands()
  const left = x - M.fingerW / 2
  const parts: JSX.Element[] = []
  let y = top

  SEGMENTS.forEach((seg, si) => {
    const labelH = si === 0 ? bands.fingerLabelH : 0
    const h = labelH + seg.length * M.fingerCellH
    parts.push(
      <rect key={`bg-${si}`} x={left} y={y} width={M.fingerW} height={h} fill={COLORS.tube} rx={2} />,
    )

    if (si === 0) {
      // 唱名格已按全谱最大高音点数加高（见 computeBands），
      // 基线跟着格高走，高音点就自然有地方画
      const baseline = y + bands.fingerLabelH - 6
      parts.push(
        <text
          key="label"
          x={x}
          y={baseline}
          textAnchor="middle"
          fontFamily={DIGIT_FONT}
          fontSize={M.fingerLabelSize}
          fontStyle="italic"
          fontWeight={600}
          fill={COLORS.ink}
        >
          {ev.degree}
        </text>,
      )
      // 八度点画在唱名的正上方 / 正下方，与数字同一条竖线
      const n = Math.abs(ev.octave)
      for (let k = 0; k < n; k++) {
        parts.push(
          <circle
            key={`od-${k}`}
            cx={x}
            cy={
              ev.octave > 0
                ? baseline - M.fingerLabelSize - 2 - k * M.octaveLabelStep
                : baseline + 4 + k * M.octaveLabelStep
            }
            r={1.5}
            fill={COLORS.ink}
          />,
        )
      }
    }

    seg.forEach((holeIdx, hi) => {
      const cy = y + labelH + hi * M.fingerCellH + M.fingerCellH / 2
      parts.push(
        <HoleGlyph
          key={`h-${holeIdx}`}
          cx={holeCenterX(x, holeIdx)}
          cy={cy}
          state={resolveHole(holes[holeIdx], policy)}
        />,
      )
    })

    y += h + M.fingerSepH
  })

  return <g>{parts}</g>
}

/** 按住 = 熊猫圆章（与原图一致）；半孔 = 只露左半个熊猫 */
function HoleGlyph({ cx, cy, state }: { cx: number; cy: number; state: number }) {
  const ids = useDefsIds()
  const r = M.holeR

  if (state === HOLE.OPEN) {
    return <circle cx={cx} cy={cy} r={r} fill={COLORS.holeOpen} stroke={COLORS.holeEdge} strokeWidth={0.8} />
  }

  if (state === HOLE.CLOSED) {
    return <circle cx={cx} cy={cy} r={r} fill={`url(#${ids.panda})`} />
  }

  // 半孔：白底圆 + 左半个熊猫 + 一圈描边
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={COLORS.holeOpen} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${ids.panda})`} clipPath={`url(#${ids.halfClip})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={COLORS.ink} strokeWidth={0.9} />
    </g>
  )
}
