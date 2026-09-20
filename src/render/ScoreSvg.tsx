/**
 * 布局模型 → SVG。纯展示，不做任何计算决策。
 *
 * 所有竖向位置都来自 layout.bands（按内容实测算出），组件内不写死 y 常量，
 * 否则减时线多一条、低音点多一个就会压到下一行。
 */

import { Fragment, createContext, useContext } from 'react'
import { HOLE, resolveHole, type AmbiguousPolicy } from '../core/fingering/table'
import {
  M,
  type ArcSeg,
  type BeamSeg,
  type Bands,
  type LaidMeasure,
  type LaidNote,
  type Layout,
  type System,
  type TupletSeg,
} from '../core/layout'
import type { NoteEvent, Score } from '../core/types'

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
  digitBaseline: 48,
  digitsBottom: 62,
  lyricBaseline: 62,
  fingeringTop: 76,
  systemHeight: 250,
}

const BandsContext = createContext<Bands>(FALLBACK_BANDS)
const useBands = () => useContext(BandsContext)

export interface ScoreSvgProps {
  score: Score
  layout: Layout
  pageIndex: number
  watermark?: string
  ambiguousPolicy?: AmbiguousPolicy
  /** 需要标黄的小节号 */
  warnMeasures?: Set<number>
}

export function ScoreSvg({
  score,
  layout,
  pageIndex,
  watermark,
  ambiguousPolicy = '闭',
  warnMeasures,
}: ScoreSvgProps) {
  const page = layout.pages[pageIndex]
  if (!page) return null

  return (
    <BandsContext.Provider value={layout.bands}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${M.pageW} ${M.pageH}`}
        width={M.pageW}
        height={M.pageH}
        style={{ background: COLORS.paper, maxWidth: '100%', height: 'auto', display: 'block' }}
      >
        <rect x={0} y={0} width={M.pageW} height={M.pageH} fill={COLORS.paper} />
        {watermark ? <Watermark text={watermark} /> : null}

        {pageIndex === 0 ? <HeaderBlock score={score} keySignature={layout.keySignature} /> : null}

        {page.systems.map((sys, i) => (
          <SystemView
            key={i}
            system={sys}
            hasLyrics={layout.hasLyrics}
            ambiguousPolicy={ambiguousPolicy}
            warnMeasures={warnMeasures}
          />
        ))}

        <Footer title={score.header.标题} pageIndex={pageIndex} pageCount={layout.pages.length} />
      </svg>
    </BandsContext.Provider>
  )
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
}: {
  system: System
  hasLyrics: boolean
  ambiguousPolicy: AmbiguousPolicy
  warnMeasures?: Set<number>
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

function MeasureView({
  lm,
  hasLyrics,
  ambiguousPolicy,
  warn,
}: {
  lm: LaidMeasure
  hasLyrics: boolean
  ambiguousPolicy: AmbiguousPolicy
  warn: boolean
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

      {m.marks.map((mk, i) => (
        <text
          key={i}
          x={lm.x + 2}
          y={markY}
          fontFamily={TEXT_FONT}
          fontSize={15}
          fontStyle="italic"
          fill={COLORS.ink}
        >
          {mk}
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
          {ln.showFingering && ln.fingering?.holes ? (
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
          : t.kind === 'atempo'
            ? 'a tempo'
            : '𝄐'
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
  const left = x - M.fingerW / 2
  const parts: JSX.Element[] = []
  let y = top

  SEGMENTS.forEach((seg, si) => {
    const labelH = si === 0 ? M.fingerLabelH : 0
    const h = labelH + seg.length * M.fingerCellH
    parts.push(
      <rect key={`bg-${si}`} x={left} y={y} width={M.fingerW} height={h} fill={COLORS.tube} rx={2} />,
    )

    if (si === 0) {
      parts.push(
        <text
          key="label"
          x={x}
          y={y + M.fingerLabelH - 6}
          textAnchor="middle"
          fontFamily={DIGIT_FONT}
          fontSize={15}
          fontStyle="italic"
          fontWeight={600}
          fill={COLORS.ink}
        >
          {ev.degree}
        </text>,
      )
      // 指法列顶部的唱名也带八度点
      const n = Math.abs(ev.octave)
      for (let k = 0; k < n; k++) {
        parts.push(
          <circle
            key={`ld-${k}`}
            cx={x + 7}
            cy={ev.octave > 0 ? y + 4 + k * 4 : y + M.fingerLabelH - 3 + k * 4}
            r={1.5}
            fill={COLORS.ink}
          />,
        )
      }
    }

    seg.forEach((holeIdx, hi) => {
      const cy = y + labelH + hi * M.fingerCellH + M.fingerCellH / 2
      parts.push(<HoleGlyph key={`h-${holeIdx}`} cx={x} cy={cy} state={resolveHole(holes[holeIdx], policy)} />)
    })

    y += h + M.fingerSepH
  })

  return <g>{parts}</g>
}

function HoleGlyph({ cx, cy, state }: { cx: number; cy: number; state: number }) {
  if (state === HOLE.CLOSED) {
    return <circle cx={cx} cy={cy} r={M.holeR} fill={COLORS.ink} />
  }
  if (state === HOLE.OPEN) {
    return (
      <circle cx={cx} cy={cy} r={M.holeR} fill={COLORS.holeOpen} stroke={COLORS.holeEdge} strokeWidth={0.8} />
    )
  }
  // 半孔：左半黑
  return (
    <g>
      <circle cx={cx} cy={cy} r={M.holeR} fill={COLORS.holeOpen} stroke={COLORS.ink} strokeWidth={0.9} />
      <path
        d={`M ${cx} ${cy - M.holeR} A ${M.holeR} ${M.holeR} 0 0 0 ${cx} ${cy + M.holeR} Z`}
        fill={COLORS.ink}
      />
    </g>
  )
}
