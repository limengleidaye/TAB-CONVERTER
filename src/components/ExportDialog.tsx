import { useEffect, useState } from 'react'

import type { ExportFormat, ExportOptions } from '../export/exporters'

export interface ExportDialogProps {
  pageCount: number
  /** 水印文字随输入实时回传，便于右侧预览同步显示 */
  onWatermarkPreview: (text: string) => void
  onCancel: () => void
  onConfirm: (opts: Omit<ExportOptions, 'ambiguousPolicy'>) => void
  busy: boolean
  error: string | null
}

export function ExportDialog({
  pageCount,
  onWatermarkPreview,
  onCancel,
  onConfirm,
  busy,
  error,
}: ExportDialogProps) {
  const [watermark, setWatermark] = useState('')
  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState<1 | 2 | 3>(2)

  useEffect(() => {
    onWatermarkPreview(watermark)
  }, [watermark, onWatermarkPreview])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>导出</h2>

        <label className="field">
          <span>水印文字</span>
          <input
            autoFocus
            value={watermark}
            onChange={(e) => setWatermark(e.target.value)}
            placeholder="留空 = 无水印"
            disabled={busy}
          />
        </label>
        <p className="hint">有文字时会斜向平铺半透明大字，铺满整页。</p>

        <div className="field">
          <span>格式</span>
          <div className="radios">
            {(['png', 'svg', 'pdf'] as ExportFormat[]).map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name="fmt"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  disabled={busy}
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>

        {format === 'png' ? (
          <div className="field">
            <span>倍率</span>
            <div className="radios">
              {([1, 2, 3] as const).map((s) => (
                <label key={s}>
                  <input
                    type="radio"
                    name="scale"
                    checked={scale === s}
                    onChange={() => setScale(s)}
                    disabled={busy}
                  />
                  {s}x
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <p className="hint">
          {format === 'pdf'
            ? `共 ${pageCount} 页，合成一个 PDF 文件。`
            : pageCount > 1
              ? `共 ${pageCount} 页，每页一个文件。`
              : '共 1 页。'}
        </p>

        {format === 'pdf' ? (
          <p className="hint">PDF 内页为 3x 位图，以保证中文字形正确。</p>
        ) : null}

        {error ? <p className="modal-error">{error}</p> : null}

        <div className="modal-actions">
          <button onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="primary"
            onClick={() => onConfirm({ format, watermark, scale })}
            disabled={busy}
          >
            {busy ? '导出中…' : '导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
