/**
 * 播放窗底部滑动的一张洞洞谱卡片。
 *
 * 画的是和打印谱同一份 FingeringColumn，只是单独开一张 svg 并把 viewBox 收紧，
 * 外层用 CSS 给多大就多大——所以放大后孔距、两端孔的左移都和纸上一模一样。
 */

import { memo, useId } from 'react'

import type { AmbiguousPolicy } from '../core/fingering/table'
import { M } from '../core/layout'
import type { PlayStep } from '../core/playback'
import { COLORS, DIGIT_FONT, TEXT_FONT } from './colors'
import { FingeringColumn, FingeringDefs, columnHeight, makeDefsIds } from './FingeringColumn'

const PAD = 7

/** 卡片的宽高比，外层按宽度给尺寸时用得上 */
export function cardViewBox(octave: number) {
  const labelH = M.fingerLabelHBase + Math.max(0, octave) * M.octaveLabelStep
  const h = columnHeight(labelH) + PAD * 2
  const w = M.fingerW + M.edgeHoleShift + PAD * 2
  return { labelH, w, h, x: -(M.fingerW / 2 + M.edgeHoleShift + PAD), y: -PAD }
}

/**
 * memo 是必须的：播放时外层每帧都在重渲染，
 * 而卡片内容只由 step 决定（step 对象来自时间轴，帧间同一份引用），不该跟着重画。
 */
export const FingeringCard = memo(function FingeringCard({
  step,
  policy,
}: {
  step: PlayStep
  policy: AmbiguousPolicy
}) {
  const ids = makeDefsIds(useId())
  const vb = cardViewBox(step.ev.octave)

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width="100%"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <FingeringDefs ids={ids} />
      {step.holes ? (
        <FingeringColumn
          x={0}
          top={0}
          labelH={vb.labelH}
          holes={step.holes}
          degree={step.ev.degree}
          octave={step.ev.octave}
          policy={policy}
          ids={ids}
        />
      ) : (
        <Placeholder step={step} height={vb.h - PAD * 2} />
      )}
    </svg>
  )
})

/** 休止符、音域外、被延音线连过来的音都画不出指法，给一张占位卡免得队列断档 */
function Placeholder({ step, height }: { step: PlayStep; height: number }) {
  const rest = step.ev.type === 'rest'
  return (
    <g>
      <rect
        x={-M.fingerW / 2}
        y={0}
        width={M.fingerW}
        height={height}
        rx={3}
        fill="none"
        stroke={COLORS.holeEdge}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        x={0}
        y={height / 2 + 6}
        textAnchor="middle"
        fontFamily={DIGIT_FONT}
        fontSize={18}
        fontWeight={600}
        fill={COLORS.ink}
      >
        {rest ? 0 : step.ev.degree}
      </text>
      {rest ? null : (
        <text
          x={0}
          y={height / 2 + 22}
          textAnchor="middle"
          fontFamily={TEXT_FONT}
          fontSize={8}
          fill={COLORS.warn}
        >
          超音域
        </text>
      )}
    </g>
  )
}
