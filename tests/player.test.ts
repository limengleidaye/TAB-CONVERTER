import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlayerDialog } from '../src/components/PlayerDialog'
import { compile } from '../src/core/pipeline'
import { 落了白 } from '../src/samples'

function markup(dsl: string, warnings: { severity: 'warning'; message: string }[] = []) {
  const r = compile(dsl)
  return renderToStaticMarkup(
    createElement(PlayerDialog, {
      score: r.score!,
      layout: r.layout!,
      ambiguousPolicy: '闭' as const,
      warnings,
      onClose: () => {},
    }),
  )
}

describe('播放窗', () => {
  it('没有警告时直接进播放界面，谱面与洞洞谱条都在', () => {
    const html = markup(落了白)
    expect(html).toContain('player-score')
    expect(html).toContain('player-strip')
    expect(html).toContain('落了白')
    // 开窗即停在第一个音上
    expect(html).toContain('第 1 小节')
  })

  it('洞洞谱条只铺当前音前后的一小窗，不是整首都画出来', () => {
    const html = markup(落了白)
    const cards = html.match(/class="player-card"/g) ?? []
    expect(cards.length).toBeGreaterThan(3)
    expect(cards.length).toBeLessThan(20)
  })

  it('播放窗上半是纯简谱：谱面里不画洞洞谱，洞洞谱只在下面的条子里', () => {
    const html = markup(落了白)
    const strip = html.slice(html.indexOf('player-strip'))
    const score = html.slice(html.indexOf('player-score'), html.indexOf('player-strip'))
    // 管身那块橙色只应出现在下面的卡片里
    expect(score).not.toContain('#F9B556')
    expect(strip).toContain('#F9B556')
    // 简谱与歌词照常
    expect(score).toContain('隐')
  })

  it('有警告时先拦一道，确认了才播', () => {
    const html = markup(落了白, [{ severity: 'warning', message: '第 3 小节拍数不对' }])
    expect(html).toContain('仍然播放')
    expect(html).toContain('第 3 小节拍数不对')
    expect(html).not.toContain('player-strip')
  })

  it('谱头没写速度时如实告知', () => {
    const html = markup(`标题: 无速度\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n1 2 3 4 |`)
    expect(html).toContain('默认 BPM')
  })
})
