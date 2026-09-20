import { useMemo } from 'react'

import { compile } from '../core/pipeline'
import { ScoreSvg } from '../render/ScoreSvg'

/** 示例片段统一用这个谱头，教程里只写正文 */
const SNIPPET_HEADER = '标题: 示例\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n'

export interface SnippetPreviewProps {
  body: string
  /** 只讲节奏的例子关掉洞洞谱，省得一屏塞不下 */
  hideFingering?: boolean
}

/**
 * 教程里的「渲染后效果」。
 * 走的是和正式输出完全相同的 compile → ScoreSvg 管线，
 * 所以教程示例永远不会和实现对不上。
 */
export function SnippetPreview({ body, hideFingering = false }: SnippetPreviewProps) {
  const result = useMemo(() => compile(SNIPPET_HEADER + body), [body])

  if (!result.score || !result.layout) {
    return <div className="snippet-error">示例无法渲染</div>
  }

  return (
    <div className="snippet-render">
      <ScoreSvg
        score={result.score}
        layout={result.layout}
        pageIndex={0}
        snippet={{ hideFingering }}
      />
    </div>
  )
}
