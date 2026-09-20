import { useCallback, useMemo, useState } from 'react'

import { ExportDialog } from './components/ExportDialog'
import { HeaderForm } from './components/HeaderForm'
import { TutorialDialog } from './components/TutorialDialog'
import { buildDsl, splitDsl, type HeaderKey } from './core/dsl'
import { deriveKeySignature } from './core/fingering/derive'
import type { AmbiguousPolicy } from './core/fingering/table'
import { compile } from './core/pipeline'
import { exportScore, type ExportOptions } from './export/exporters'
import { ScoreSvg } from './render/ScoreSvg'
import { SAMPLES } from './samples'

const INITIAL = splitDsl(SAMPLES[0].dsl)

/** 首次打开自动弹教程；localStorage 在隐私模式下会抛错，一律兜住 */
const TUTORIAL_SEEN_KEY = 'xiao-tab:tutorial-seen'

function readTutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
  } catch {
    /* 读不到就每次都弹，不影响使用 */
  }
}

export default function App() {
  const [fields, setFields] = useState(INITIAL.fields)
  const [body, setBody] = useState(INITIAL.body)
  const [policy, setPolicy] = useState<AmbiguousPolicy>('闭')

  const [tutorialOpen, setTutorialOpen] = useState(() => !readTutorialSeen())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [watermark, setWatermark] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const result = useMemo(() => compile(buildDsl(fields, body)), [fields, body])
  const errors = result.issues.filter((i) => i.severity === 'error')
  const warnings = result.issues.filter((i) => i.severity === 'warning')

  // 给「调号」输入框当占位提示用；箫调/筒音作 填得不对时为 null
  const derivedKey = useMemo(() => {
    const tone = /^([#b])?([1-7])$/.exec(fields.筒音作.trim())
    if (!tone) return null
    return deriveKeySignature(fields.箫调, Number(tone[2]), tone[1] as '#' | 'b' | undefined)
  }, [fields.箫调, fields.筒音作])

  const setField = useCallback((key: HeaderKey, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }, [])

  const loadSample = useCallback((name: string) => {
    const s = SAMPLES.find((x) => x.name === name)
    if (!s) return
    const parts = splitDsl(s.dsl)
    setFields(parts.fields)
    setBody(parts.body)
  }, [])

  const closeTutorial = useCallback(() => {
    setTutorialOpen(false)
    markTutorialSeen()
  }, [])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setWatermark('')
    setExportError(null)
  }, [])

  const handleExport = useCallback(
    async (opts: Omit<ExportOptions, 'ambiguousPolicy'>) => {
      if (!result.score || !result.layout) return
      setBusy(true)
      setExportError(null)
      try {
        await exportScore(result.score, result.layout, { ...opts, ambiguousPolicy: policy })
        setDialogOpen(false)
        setWatermark('')
      } catch (e) {
        setExportError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [result, policy],
  )

  const canExport = !!result.score && !!result.layout

  return (
    <div className="app">
      <header className="topbar">
        <h1>箫谱生成器</h1>
        <div className="controls">
          <label>
            样例
            <select value="" onChange={(e) => loadSample(e.target.value)}>
              <option value="">载入…</option>
              {SAMPLES.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            ◎ 可开可闭
            <select value={policy} onChange={(e) => setPolicy(e.target.value as AmbiguousPolicy)}>
              <option value="闭">渲染成闭</option>
              <option value="开">渲染成开</option>
            </select>
          </label>
          <button onClick={() => setTutorialOpen(true)}>说明</button>
          <button className="primary" onClick={() => setDialogOpen(true)} disabled={!canExport}>
            导出…
          </button>
        </div>
      </header>

      <main className="panes">
        <section className="editor">
          <HeaderForm fields={fields} onChange={setField} derivedKey={derivedKey} />

          <div className="body-label">正文（音符流）</div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />

          <div className="issues">
            {errors.length === 0 && warnings.length === 0 ? <p className="ok">无问题</p> : null}
            {errors.map((i, k) => (
              <p key={`e${k}`} className="error">
                错误：{i.message}
              </p>
            ))}
            {warnings.map((i, k) => (
              <p key={`w${k}`} className="warn">
                警告：{i.message}
              </p>
            ))}
          </div>
        </section>

        <section className="preview">
          {result.score && result.layout ? (
            result.layout.pages.map((_, i) => (
              <div className="page" key={i}>
                <ScoreSvg
                  score={result.score!}
                  layout={result.layout!}
                  pageIndex={i}
                  watermark={watermark || undefined}
                  ambiguousPolicy={policy}
                  warnMeasures={dialogOpen ? undefined : result.warnMeasures}
                />
              </div>
            ))
          ) : (
            <p className="empty">谱头有错误，无法渲染</p>
          )}
        </section>
      </main>

      {tutorialOpen ? <TutorialDialog onClose={closeTutorial} /> : null}

      {dialogOpen && result.layout ? (
        <ExportDialog
          pageCount={result.layout.pages.length}
          onWatermarkPreview={setWatermark}
          onCancel={closeDialog}
          onConfirm={handleExport}
          busy={busy}
          error={exportError}
        />
      ) : null}
    </div>
  )
}
