/**
 * 编辑器页：左边写、右边实时出谱。
 *
 * 谱子存在 IndexedDB 里，改动防抖 700ms 自动存回去——写谱是反复打磨的活，
 * 让人记得按保存是不合理的。标题不单独存，它就是谱头里的「标题」字段。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { BodyEditor } from './BodyEditor'
import { ExportDialog } from './ExportDialog'
import { HeaderForm } from './HeaderForm'
import { PlayerDialog } from './PlayerDialog'
import { buildDsl, splitDsl, EMPTY_FIELDS, type HeaderKey } from '../core/dsl'
import { deriveKeySignature } from '../core/fingering/derive'
import type { AmbiguousPolicy } from '../core/fingering/table'
import { compile } from '../core/pipeline'
import { retuneFields } from '../core/transpose'
import { exportScore, type ExportOptions } from '../export/exporters'
import { ScoreSvg } from '../render/ScoreSvg'
import {
  getScore,
  instrumentOf,
  keyLabelOf,
  MODE_LABEL,
  putScore,
  titleOf,
  writeLastOpened,
  type ScoreMode,
  type ScoreRecord,
} from '../store/library'

/** 改动停手多久之后落盘 */
const AUTOSAVE_DELAY = 700

const MODE_BUTTONS: { mode: ScoreMode; title: string }[] = [
  { mode: 'xiao', title: '简谱 + 每个音的八孔箫指法' },
  { mode: 'dizi', title: '简谱 + 每个音的六孔笛指法' },
  { mode: 'jianpu', title: '只排简谱，不画指法' },
]

export interface EditorPageProps {
  id: string
  onOpenTutorial: () => void
  onGoLibrary: () => void
}

export function EditorPage({ id, onOpenTutorial, onGoLibrary }: EditorPageProps) {
  const [record, setRecord] = useState<ScoreRecord | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')

  const [fields, setFields] = useState(EMPTY_FIELDS)
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<ScoreMode>('xiao')
  const [policy, setPolicy] = useState<AmbiguousPolicy>('闭')
  const [dirty, setDirty] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [watermark, setWatermark] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // ---- 读盘 ----
  useEffect(() => {
    let alive = true
    setStatus('loading')
    getScore(id)
      .then((r) => {
        if (!alive) return
        if (!r) {
          setStatus('missing')
          return
        }
        const parts = splitDsl(r.dsl)
        setFields(parts.fields)
        setBody(parts.body)
        setMode(r.mode)
        setRecord(r)
        setDirty(false)
        setStatus('ready')
        writeLastOpened(r.id)
      })
      .catch((e) => {
        if (!alive) return
        setLoadError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [id])

  // 笛谱把「箫调」写成「笛调」落盘，导出的 .txt 一看就知道是笛谱
  const dsl = useMemo(() => buildDsl(fields, body, keyLabelOf(mode)), [fields, body, mode])

  // ---- 自动存盘 ----
  useEffect(() => {
    if (status !== 'ready' || !record) return
    if (dsl === record.dsl && mode === record.mode) return
    setDirty(true)
    const timer = setTimeout(() => {
      const next: ScoreRecord = { ...record, dsl, mode, title: titleOf(dsl), updatedAt: Date.now() }
      putScore(next)
        .then(() => {
          setRecord(next)
          setDirty(false)
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
    }, AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [dsl, mode, record, status])

  const jianpu = mode === 'jianpu'
  const instrument = instrumentOf(mode)
  const result = useMemo(
    () => compile(dsl, instrument ? { instrument } : { omitFingering: true }),
    [dsl, instrument],
  )
  const errors = result.issues.filter((i) => i.severity === 'error')
  const warnings = result.issues.filter((i) => i.severity === 'warning')

  // 给「调号」输入框当占位提示用；箫调(笛调)/筒音作 填得不对时为 null
  const derivedKey = useMemo(() => {
    const tone = /^([#b])?([1-7])$/.exec(fields.筒音作.trim())
    if (!tone) return null
    return deriveKeySignature(fields.箫调, Number(tone[2]), tone[1] as '#' | 'b' | undefined)
  }, [fields.箫调, fields.筒音作])

  const setField = useCallback(
    (key: HeaderKey, value: string) => {
      // 换管子的调：谱头 调号 与正文 \key 一起挪，曲中转调的幅度才不变（见 core/transpose.ts）
      if (key === '箫调') {
        const next = retuneFields(fields, body, value)
        setFields(next.fields)
        if (next.body !== body) setBody(next.body)
        return
      }
      setFields((prev) => ({ ...prev, [key]: value }))
    },
    [fields, body],
  )

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

  if (status === 'loading') return <p className="page-note">读取中…</p>
  if (status === 'missing') {
    return (
      <div className="page-note">
        <p>这首谱子不在谱库里了（可能已被删除）。</p>
        <button className="primary" onClick={onGoLibrary}>
          回谱库
        </button>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="page-note">
        <p className="error">打不开谱库：{loadError}</p>
        <button onClick={onGoLibrary}>回谱库</button>
      </div>
    )
  }

  const canExport = !!result.score && !!result.layout
  // 播放前先过体检：有错误的谱子连时值都算不准，不给播
  const canPlay = canExport && errors.length === 0

  return (
    <div className="app">
      <header className="topbar">
        <button className="ghost" onClick={onGoLibrary} title="回到谱库">
          ‹ 谱库
        </button>
        <h1 className="doc-title">{fields.标题?.trim() || '未命名'}</h1>
        <span className="save-state">{dirty ? '保存中…' : '已保存'}</span>

        <div className="controls">
          <div className="segmented" role="group" aria-label="谱面类型">
            {MODE_BUTTONS.map(({ mode: m, title }) => (
              <button key={m} className={mode === m ? 'on' : undefined} onClick={() => setMode(m)} title={title}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          {/* 只有箫的表里有「可开可闭」；笛和纯简谱用不上这个开关 */}
          {mode !== 'xiao' ? null : (
            <label>
              ◎ 可开可闭
              <select value={policy} onChange={(e) => setPolicy(e.target.value as AmbiguousPolicy)}>
                <option value="闭">渲染成闭</option>
                <option value="开">渲染成开</option>
              </select>
            </label>
          )}

          <button onClick={onOpenTutorial}>教程</button>
          <button
            onClick={() => setPlayerOpen(true)}
            disabled={!canPlay}
            title={
              canPlay
                ? jianpu
                  ? '跟着谱子播放（钢琴音）'
                  : `跟着谱子播放（${instrument?.short}声 + 动态洞洞谱）`
                : '谱子有错误，修好才能播放'
            }
          >
            ▶ 播放
          </button>
          <button className="primary" onClick={() => setDialogOpen(true)} disabled={!canExport}>
            导出…
          </button>
        </div>
      </header>

      <main className="panes">
        <section className="editor">
          <HeaderForm fields={fields} onChange={setField} derivedKey={derivedKey} instrument={instrument} />

          <div className="body-label">正文（音符流）　· 打 \ 弹出命令面板</div>
          <BodyEditor value={body} onChange={setBody} />

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

      {playerOpen && result.score && result.layout ? (
        <PlayerDialog
          score={result.score}
          layout={result.layout}
          mode={mode}
          ambiguousPolicy={policy}
          warnings={warnings}
          onClose={() => setPlayerOpen(false)}
        />
      ) : null}

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
