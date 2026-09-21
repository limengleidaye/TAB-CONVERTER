/**
 * 洞洞谱的「一列」：管身 + 八个孔 + 顶部唱名。
 *
 * 打印谱（ScoreSvg）与播放窗里放大的滑动卡片共用这一份几何——
 * 分段方式、两端孔的左移、孔距若各写一份，迟早会走样成两种谱。
 */

import { Fragment } from 'react'

import { HOLE, resolveHole, type AmbiguousPolicy } from '../core/fingering/table'
import { M } from '../core/layout'
import { COLORS, DIGIT_FONT } from './colors'
import { PANDA_HOLE_PNG } from './panda'

/** 分段：[标签 + 第八~第五孔] / [第四~第二孔] / [第一孔]（与原图一致） */
export const FINGER_SEGMENTS: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [4, 5, 6],
  [7],
]

/**
 * 第八孔（最上）与第一孔（最下）在原图里是向左错开画的，用来标出这两个孔的特殊；
 * 中间六个孔居中。holeIdx 0 = 第八孔，7 = 第一孔。
 */
export const EDGE_HOLES = new Set([0, 7])

export function holeCenterX(x: number, holeIdx: number): number {
  return EDGE_HOLES.has(holeIdx) ? x - M.edgeHoleShift : x
}

/** 一列的总高：唱名格 + 八个孔格 + 两条分段缝 */
export function columnHeight(labelH: number): number {
  return labelH + M.fingerCellH * 8 + M.fingerSepH * 2
}

/**
 * <defs> 里的 id 必须按 svg 实例取唯一值。
 * 教程弹窗里会同时挂十几张片段 svg，固定 id 会在同一文档里重复，
 * 而 url(#id) 是全文档解析的——重复 id 属于未定义行为，别赌它。
 */
export interface FingeringDefsIds {
  panda: string
  halfClip: string
}

export function makeDefsIds(uid: string): FingeringDefsIds {
  const safe = uid.replace(/[^a-zA-Z0-9]/g, '')
  return { panda: `hole-panda-${safe}`, halfClip: `hole-half-${safe}` }
}

/** 熊猫图章与半孔裁剪的定义，每张 svg 放一份 */
export function FingeringDefs({ ids }: { ids: FingeringDefsIds }) {
  return (
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
  )
}

export interface FingeringColumnProps {
  /** 列中心 x */
  x: number
  /** 列顶部 y */
  top: number
  /** 顶部唱名格的高度（高音点多时会变高） */
  labelH: number
  holes: Uint8Array
  degree: number
  octave: number
  policy: AmbiguousPolicy
  ids: FingeringDefsIds
}

export function FingeringColumn({
  x,
  top,
  labelH,
  holes,
  degree,
  octave,
  policy,
  ids,
}: FingeringColumnProps) {
  const left = x - M.fingerW / 2
  const parts: JSX.Element[] = []
  let y = top

  FINGER_SEGMENTS.forEach((seg, si) => {
    const segLabelH = si === 0 ? labelH : 0
    const h = segLabelH + seg.length * M.fingerCellH
    parts.push(
      <rect key={`bg-${si}`} x={left} y={y} width={M.fingerW} height={h} fill={COLORS.tube} rx={2} />,
    )

    if (si === 0) {
      // 唱名格已按全谱最大高音点数加高（见 computeBands），
      // 基线跟着格高走，高音点就自然有地方画
      const baseline = y + labelH - 6
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
          {degree}
        </text>,
      )
      // 八度点画在唱名的正上方 / 正下方，与数字同一条竖线
      const n = Math.abs(octave)
      for (let k = 0; k < n; k++) {
        parts.push(
          <circle
            key={`od-${k}`}
            cx={x}
            cy={
              octave > 0
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
      const cy = y + segLabelH + hi * M.fingerCellH + M.fingerCellH / 2
      parts.push(
        <HoleGlyph
          key={`h-${holeIdx}`}
          cx={holeCenterX(x, holeIdx)}
          cy={cy}
          state={resolveHole(holes[holeIdx], policy)}
          ids={ids}
        />,
      )
    })

    y += h + M.fingerSepH
  })

  return <g>{parts}</g>
}

/** 按住 = 熊猫圆章（与原图一致）；半孔 = 只露左半个熊猫 */
export function HoleGlyph({
  cx,
  cy,
  state,
  ids,
}: {
  cx: number
  cy: number
  state: number
  ids: FingeringDefsIds
}) {
  const r = M.holeR

  if (state === HOLE.OPEN) {
    return <circle cx={cx} cy={cy} r={r} fill={COLORS.holeOpen} stroke={COLORS.holeEdge} strokeWidth={0.8} />
  }

  if (state === HOLE.CLOSED) {
    return <circle cx={cx} cy={cy} r={r} fill={`url(#${ids.panda})`} />
  }

  // 半孔：白底圆 + 左半个熊猫 + 一圈描边
  return (
    <Fragment>
      <circle cx={cx} cy={cy} r={r} fill={COLORS.holeOpen} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${ids.panda})`} clipPath={`url(#${ids.halfClip})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={COLORS.ink} strokeWidth={0.9} />
    </Fragment>
  )
}
