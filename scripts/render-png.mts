/**
 * 开发用：把**验收基线谱**渲染成 PNG，便于与原谱图逐格比对。
 *   npx tsx scripts/render-png.mts            # 两首都渲
 *   npx tsx scripts/render-png.mts 落了白      # 指定一首
 * 输出到 out/<曲名>-p<页码>.png
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { compile } from '../src/core/pipeline'
import { ScoreSvg } from '../src/render/ScoreSvg'
import { REFERENCE_SCORES } from '../src/samples/reference'

const outDir = join(import.meta.dirname, '..', 'out')
mkdirSync(outDir, { recursive: true })

const only = process.argv[2]
const targets = only ? REFERENCE_SCORES.filter((s) => s.name === only) : REFERENCE_SCORES

for (const sample of targets) {
  const result = compile(sample.dsl)
  if (!result.score || !result.layout) {
    console.error(`${sample.name}: 编译失败`)
    for (const i of result.issues) console.error(` - ${i.severity}: ${i.message}`)
    continue
  }

  for (let p = 0; p < result.layout.pages.length; p++) {
    const svg = renderToStaticMarkup(
      createElement(ScoreSvg, {
        score: result.score,
        layout: result.layout,
        pageIndex: p,
        warnMeasures: result.warnMeasures,
      }),
    )
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1368 },
      font: { loadSystemFonts: true },
    })
      .render()
      .asPng()
    const file = join(outDir, `${sample.name}-p${p + 1}.png`)
    writeFileSync(file, png)
    console.log(`写出 ${file}`)
  }

  const warn = result.issues.filter((i) => i.severity === 'warning')
  const err = result.issues.filter((i) => i.severity === 'error')
  console.log(`  ${sample.name}: ${err.length} 错误 / ${warn.length} 警告`)
  for (const i of [...err, ...warn]) console.log(`   - ${i.severity}: ${i.message}`)
}
