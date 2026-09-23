/**
 * 布局模型 → SVG。纯展示，不做任何计算决策。
 *
 * 所有竖向位置都来自 layout.bands（按内容实测算出），组件内不写死 y 常量，
 * 否则减时线多一条、低音点多一个就会压到下一行。
 */

import { Fragment, createContext, useContext, useId } from 'react'
import { type AmbiguousPolicy } from '../core/fingering/table'
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
import type { Meter, NoteEvent, Score } from '../core/types'
import { COLORS, DIGIT_FONT, TEXT_FONT } from './colors'
import {
  FingeringColumn,
  FingeringDefs,
  makeDefsIds,
  type FingeringDefsIds,
} from './FingeringColumn'

export { COLORS }

const FALLBACK_BANDS: Bands = {
  tempoY: 16,
  arcY: 14,
  digitBaseline: 44,
  digitsBottom: 58,
  fermataY: 16,
  lyricBaselines: [],
  fingeringTop: 72,
  fingerLabelH: M.fingerLabelHBase,
  fingerH: M.fingerLabelHBase + M.fingerCellH * 8 + M.fingerSepH * 2,
  systemHeight: 250,
}

const BandsContext = createContext<Bands>(FALLBACK_BANDS)
const useBands = () => useContext(BandsContext)

/** 指法列的 defs id（每张 svg 一套，见 FingeringColumn）靠 context 传到深处 */
const DefsContext = createContext<FingeringDefsIds>(makeDefsIds('fallback'))
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
  const ids = makeDefsIds(useId())

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
        <FingeringDefs ids={ids} />

        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={COLORS.paper} />
        {watermark && !snippet ? <Watermark text={watermark} /> : null}

        {pageIndex === 0 && !snippet ? (
          <HeaderBlock score={score} keySignature={layout.keySignature} />
        ) : null}

        {(snippet ? page.systems.slice(0, 1) : page.systems).map((sys, i) => (
          <SystemView
            key={i}
            system={sys}
            verseCount={layout.verseCount}
            ambiguousPolicy={ambiguousPolicy}
            warnMeasures={warnMeasures}
            hideFingering={snippet?.hideFingering || layout.omitFingering}
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

function lastOf(xs: number[], fallback: number): number {
  return xs.length > 0 ? xs[xs.length - 1] : fallback
}

/** 片段模式的裁剪框：贴着第一行谱的实际内容，左右各留一点边 */
function snippetViewBox(page: Page, layout: Layout, opts: SnippetOptions) {
  const sys = page.systems[0]
  if (!sys) return null
  // 多段歌词时左边要多留一截，给行首的段号
  const padX = layout.verseCount > 1 ? 28 : 10
  const padY = 6
  const bottom =
    opts.hideFingering || layout.omitFingering
      ? lastOf(layout.bands.lyricBaselines, layout.bands.digitsBottom) + 6
      : layout.bands.fingerH + layout.bands.fingeringTop
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
  verseCount,
  ambiguousPolicy,
  warnMeasures,
  hideFingering,
}: {
  system: System
  verseCount: number
  ambiguousPolicy: AmbiguousPolicy
  warnMeasures?: Set<number>
  hideFingering: boolean
}) {
  return (
    <g transform={`translate(0 ${system.y})`}>
      <VerseNumbers verseCount={verseCount} />
      {system.measures.map((lm) => (
        <MeasureView
          key={lm.measure.index}
          lm={lm}
          verseCount={verseCount}
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
  verseCount,
  ambiguousPolicy,
  warn,
  hideFingering,
}: {
  lm: LaidMeasure
  verseCount: number
  ambiguousPolicy: AmbiguousPolicy
  warn: boolean
  hideFingering: boolean
}) {
  const bands = useBands()
  const ids = useDefsIds()
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

      {/*
        房子括线：开头那一小节画左钩和数字；接续的小节只画横线，往左接上前一小节的线
        （换行后落在行首就不往左接）；以 :| 收尾的那一小节在右端下钩。
      */}
      {m.volta ? (
        <g>
          <path
            d={
              m.voltaStart
                ? `M ${lm.x} ${markY + 4} v -12 h ${lm.width - M.measureGap}`
                : `M ${lm.x <= M.marginX ? lm.x : lm.x - M.measureGap} ${markY - 8} H ${lm.x + lm.width - M.measureGap}`
            }
            fill="none"
            stroke={COLORS.ink}
            strokeWidth={1.4}
          />
          {m.closeBarline === 'repeatEnd' ? (
            <path
              d={`M ${lm.x + lm.width - M.measureGap} ${markY - 8} v 12`}
              fill="none"
              stroke={COLORS.ink}
              strokeWidth={1.4}
            />
          ) : null}
          {m.voltaStart ? (
            <text x={lm.x + 5} y={markY + 2} fontFamily={DIGIT_FONT} fontSize={14} fill={COLORS.ink}>
              {`${m.volta}.`}
            </text>
          ) : null}
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

      {/* 曲中转调：和 Segno / Coda 同一高度，排在房子号和它们后面，免得叠在一起 */}
      {m.keyChange ? (
        <text
          x={
            lm.x +
            2 +
            (m.voltaStart ? 22 : 0) +
            m.marks.filter((mk) => MARK_AT_START.has(mk)).length * 18
          }
          y={markY}
          fontFamily={DIGIT_FONT}
          fontSize={15}
          fontWeight={700}
          fill={COLORS.ink}
        >
          {m.keyChange}
        </text>
      ) : null}

      {m.openBarline === 'repeatStart' ? <Barline x={lm.x - 8} kind="repeatStart" /> : null}

      {m.meterChanged ? <MeterGlyph x={lm.x + M.meterW / 2} meter={m.meter} /> : null}

      {lm.notes.map((ln, i) => (
        <Fragment key={i}>
          <NoteGlyph ln={ln} />
          {verseCount > 0 && ln.ev.lyrics
            ? ln.ev.lyrics.map((text, vi) =>
                text ? (
                  <text
                    key={`v${vi}`}
                    x={ln.x}
                    y={bands.lyricBaselines[vi]}
                    textAnchor="middle"
                    fontFamily={TEXT_FONT}
                    fontSize={M.lyricSize}
                    fill={COLORS.ink}
                  >
                    {text}
                  </text>
                ) : null,
              )
            : null}
          {!hideFingering && ln.showFingering && ln.fingering?.holes ? (
            <FingeringColumn
              x={ln.x}
              top={bands.fingeringTop}
              labelH={bands.fingerLabelH}
              holes={ln.fingering.holes}
              degree={ln.ev.degree}
              octave={ln.ev.octave}
              policy={ambiguousPolicy}
              ids={ids}
            />
          ) : null}
        </Fragment>
      ))}

      <Barline x={lm.barX} kind={m.closeBarline} />
    </g>
  )
}

/** 多段歌词时，每行行首标上段号；只有一段就不标 */
function VerseNumbers({ verseCount }: { verseCount: number }) {
  const bands = useBands()
  if (verseCount < 2) return null
  return (
    <g>
      {bands.lyricBaselines.map((y, vi) => (
        <text
          key={vi}
          x={M.marginX - 8}
          y={y}
          textAnchor="end"
          fontFamily={DIGIT_FONT}
          fontSize={M.lyricSize - 4}
          fill={COLORS.ink}
        >
          {`${vi + 1}.`}
        </text>
      ))}
    </g>
  )
}

/**
 * 曲中变拍号：上下叠的两个数字，画在小节最左边。
 * 字号比简谱数字小，分母压在数字基线上、分子紧贴其上——
 * 这样整个分数正好落在数字那一带里，不会顶到上面的弧线或下面的减时线。
 */
function MeterGlyph({ x, meter }: { x: number; meter: Meter }) {
  const bands = useBands()
  return (
    <g>
      <text
        x={x}
        y={bands.digitBaseline - M.meterSize}
        textAnchor="middle"
        fontFamily={DIGIT_FONT}
        fontSize={M.meterSize}
        fontWeight={700}
        fill={COLORS.ink}
      >
        {meter.beats}
      </text>
      <text
        x={x}
        y={bands.digitBaseline}
        textAnchor="middle"
        fontFamily={DIGIT_FONT}
        fontSize={M.meterSize}
        fontWeight={700}
        fill={COLORS.ink}
      >
        {meter.unit}
      </text>
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
