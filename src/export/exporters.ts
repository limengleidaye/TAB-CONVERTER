/**
 * 导出 PNG / SVG / PDF（需求文档 §8）。
 *
 * 一律走「用 ScoreSvg 重新渲染成 SVG 字符串」这条路，而不是抓页面上的 DOM 节点，
 * 这样水印可以在导出瞬间即时注入，不用等 React 重渲染。
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AmbiguousPolicy } from '../core/fingering/table'
import { M, type Layout } from '../core/layout'
import type { Score } from '../core/types'
import { ScoreSvg } from '../render/ScoreSvg'

export type ExportFormat = 'png' | 'svg' | 'pdf'

export interface ExportOptions {
  format: ExportFormat
  /** 空字符串 = 无水印 */
  watermark: string
  /** 仅 PNG：1x / 2x / 3x */
  scale: 1 | 2 | 3
  ambiguousPolicy: AmbiguousPolicy
}

export function renderPageSvg(
  score: Score,
  layout: Layout,
  pageIndex: number,
  opts: Pick<ExportOptions, 'watermark' | 'ambiguousPolicy'>,
): string {
  return renderToStaticMarkup(
    createElement(ScoreSvg, {
      score,
      layout,
      pageIndex,
      watermark: opts.watermark || undefined,
      ambiguousPolicy: opts.ambiguousPolicy,
      // 导出件不要带校验用的黄色虚线框
      warnMeasures: undefined,
    }),
  )
}

export async function exportScore(score: Score, layout: Layout, opts: ExportOptions): Promise<void> {
  const title = score.header.标题 || '箫谱'
  const pageCount = layout.pages.length

  if (opts.format === 'svg') {
    for (let p = 0; p < pageCount; p++) {
      const svg = renderPageSvg(score, layout, p, opts)
      download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), fileName(title, p, pageCount, 'svg'))
    }
    return
  }

  if (opts.format === 'png') {
    for (let p = 0; p < pageCount; p++) {
      const svg = renderPageSvg(score, layout, p, opts)
      const blob = await svgToPngBlob(svg, opts.scale)
      download(blob, fileName(title, p, pageCount, 'png'))
    }
    return
  }

  // PDF：每页塞一张 3x 的 PNG。
  // 不用 svg2pdf 走矢量，是因为 jsPDF 内置字体不含中文字形，
  // 标题/歌词/页脚会整片乱码；光栅化能保证字形绝对正确。
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [M.pageW, M.pageH] })

  for (let p = 0; p < pageCount; p++) {
    if (p > 0) pdf.addPage([M.pageW, M.pageH], 'portrait')
    const svg = renderPageSvg(score, layout, p, opts)
    const dataUrl = await svgToPngDataUrl(svg, 3)
    pdf.addImage(dataUrl, 'PNG', 0, 0, M.pageW, M.pageH)
  }
  pdf.save(`${title}.pdf`)
}

function fileName(title: string, pageIndex: number, pageCount: number, ext: string): string {
  return pageCount > 1 ? `${title}-第${pageIndex + 1}页.${ext}` : `${title}.${ext}`
}

/** SVG 字符串 → 光栅化。用 <img> 加载，系统字体按 font-family 正常解析。 */
async function svgToCanvas(svg: string, scale: number): Promise<HTMLCanvasElement> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = new Image()
  img.decoding = 'sync'

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG 光栅化失败：图片加载出错'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(M.pageW * scale)
  canvas.height = Math.round(M.pageH * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.fillStyle = '#FEFEFC'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
  const canvas = await svgToCanvas(svg, scale)
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png')
  })
}

async function svgToPngDataUrl(svg: string, scale: number): Promise<string> {
  const canvas = await svgToCanvas(svg, scale)
  return canvas.toDataURL('image/png')
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 给浏览器一点时间把下载排进队列再回收
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
