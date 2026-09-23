/**
 * 谱库页：本地存着的所有谱子。
 *
 * 导入导出的格式选择见 store/library.ts 的开头——单首就是 DSL 原文 .txt，
 * 整库备份才用 JSON。浏览器清站点数据会连 IndexedDB 一起清掉，所以页面上
 * 明写一句「重要的谱子记得导出备份」，这不是客套话。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buildDsl, splitDsl } from '../core/dsl'
import { download } from '../export/exporters'
import { SAMPLES } from '../samples'
import { CATALOG, searchCatalog, type CatalogEntry } from '../samples/catalog'
import {
  BLANK_DSL,
  createRecord,
  guessMode,
  keyLabelOf,
  deleteScore,
  listScores,
  parseBundle,
  putScore,
  putScores,
  resolveCollisions,
  safeFileName,
  serializeBundle,
  sortByUpdated,
  titleOf,
  MODE_LABEL,
  type ScoreMode,
  type ScoreRecord,
} from '../store/library'

export interface LibraryPageProps {
  onOpenTutorial: () => void
  onOpen: (id: string) => void
}

export function LibraryPage({ onOpenTutorial, onOpen }: LibraryPageProps) {
  const [items, setItems] = useState<ScoreRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchCatalog(query), [query])

  const reload = useCallback(() => {
    listScores()
      .then(setItems)
      .catch((e) => {
        setItems([])
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [])

  useEffect(reload, [reload])

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  const create = useCallback(
    async (dsl: string, mode: ScoreMode = 'xiao') => {
      try {
        const rec = createRecord(dsl, mode)
        await putScore(rec)
        onOpen(rec.id)
      } catch (e) {
        fail(e)
      }
    },
    [onOpen],
  )

  const duplicate = useCallback(
    async (rec: ScoreRecord) => {
      try {
        const parts = splitDsl(rec.dsl)
        parts.fields.标题 = `${parts.fields.标题 || '未命名'} 副本`
        const copy = createRecord(buildDsl(parts.fields, parts.body, keyLabelOf(rec.mode)), rec.mode)
        await putScore(copy)
        reload()
      } catch (e) {
        fail(e)
      }
    },
    [reload],
  )

  /** 标题就是谱头里的「标题」字段，改名即改那一行 */
  const rename = useCallback(
    async (rec: ScoreRecord) => {
      const next = window.prompt('新的标题', rec.title)?.trim()
      if (!next || next === rec.title) return
      try {
        const parts = splitDsl(rec.dsl)
        parts.fields.标题 = next
        const dsl = buildDsl(parts.fields, parts.body)
        await putScore({ ...rec, dsl, title: titleOf(dsl), updatedAt: Date.now() })
        reload()
      } catch (e) {
        fail(e)
      }
    },
    [reload],
  )

  const remove = useCallback(
    async (rec: ScoreRecord) => {
      if (!window.confirm(`删除《${rec.title}》？删掉就找不回来了。`)) return
      try {
        await deleteScore(rec.id)
        reload()
      } catch (e) {
        fail(e)
      }
    },
    [reload],
  )

  const exportOne = useCallback((rec: ScoreRecord) => {
    download(new Blob([rec.dsl], { type: 'text/plain;charset=utf-8' }), `${safeFileName(rec.title)}.txt`)
  }, [])

  const exportAll = useCallback(() => {
    if (!items?.length) return
    const stamp = new Date().toISOString().slice(0, 10)
    download(
      new Blob([serializeBundle(items)], { type: 'application/json;charset=utf-8' }),
      `竹谱备份-${stamp}.json`,
    )
  }, [items])

  const importFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      setError(null)
      const existing = new Set((items ?? []).map((r) => r.id))
      const incoming: ScoreRecord[] = []
      const failed: string[] = []

      for (const file of Array.from(files)) {
        try {
          const text = await file.text()
          if (/\.json$/i.test(file.name)) {
            incoming.push(...resolveCollisions(parseBundle(text), existing))
          } else {
            incoming.push(createRecord(text, guessMode(text)))
          }
        } catch (e) {
          failed.push(`${file.name}：${e instanceof Error ? e.message : String(e)}`)
        }
      }

      if (incoming.length > 0) {
        try {
          await putScores(incoming)
          setItems((prev) => sortByUpdated([...(prev ?? []), ...incoming]))
        } catch (e) {
          fail(e)
        }
      }
      setNotice(
        `导入 ${incoming.length} 首${failed.length ? `，${failed.length} 个文件没读进来` : ''}`,
      )
      if (failed.length) setError(failed.join('\n'))
      if (fileRef.current) fileRef.current.value = ''
    },
    [items],
  )

  return (
    <div className="app library">
      <header className="topbar">
        <h1>竹谱</h1>
        <div className="controls">
          <button onClick={onOpenTutorial}>教程</button>
          <button onClick={() => fileRef.current?.click()}>导入…</button>
          <button onClick={exportAll} disabled={!items?.length}>
            导出全部
          </button>
          <button className="primary" onClick={() => void create(BLANK_DSL)}>
            ＋ 新建
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".txt,.json,text/plain,application/json"
          hidden
          onChange={(e) => void importFiles(e.target.files)}
        />
      </header>

      <main className="library-body">
        {error ? <p className="lib-error">{error}</p> : null}
        {notice ? <p className="lib-notice">{notice}</p> : null}

        <section>
          <h2>我的谱子{items?.length ? ` · ${items.length}` : ''}</h2>
          {items === null ? (
            <p className="page-note">读取中…</p>
          ) : items.length === 0 ? (
            <p className="page-note">还空着。点右上角「新建」，或者从下面的示例曲目、曲库里抄一首开始改。</p>
          ) : (
            <ul className="score-list">
              {items.map((rec) => (
                <li key={rec.id}>
                  <button className="score-open" onClick={() => onOpen(rec.id)}>
                    <span className="score-title">{rec.title}</span>
                    <span className={`badge ${rec.mode}`}>
                      {MODE_LABEL[rec.mode] ?? MODE_LABEL.xiao}
                    </span>
                    <span className="score-time">{fmtDate(rec.updatedAt)}</span>
                  </button>
                  <span className="score-actions">
                    <button onClick={() => void rename(rec)}>改名</button>
                    <button onClick={() => void duplicate(rec)}>复制</button>
                    <button onClick={() => exportOne(rec)}>导出</button>
                    <button className="danger" onClick={() => void remove(rec)}>
                      删除
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>示例曲目</h2>
          <p className="page-note">
            加进谱库后就是你自己的副本，随便改，不影响原件。
          </p>
          <ul className="score-list">
            {SAMPLES.map((s) => (
              <SampleRow key={s.name} entry={s} onAdd={() => void create(s.dsl, s.mode)} />
            ))}
          </ul>
        </section>

        <section>
          <div className="section-head">
            <h2>曲库 · {CATALOG.length}</h2>
            <input
              className="catalog-search"
              type="search"
              value={query}
              placeholder="按标题搜，如「兰亭」"
              aria-label="按标题搜索曲库"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {found.length === 0 ? (
            <p className="page-note">曲库里没有标题含「{query.trim()}」的曲子。</p>
          ) : (
            <ul className="score-list">
              {found.map((s) => (
                <SampleRow key={s.name} entry={s} onAdd={() => void create(s.dsl, s.mode)} />
              ))}
            </ul>
          )}
        </section>

        <p className="lib-footnote">
          谱子存在这台电脑的浏览器里（IndexedDB）。清理浏览器站点数据会一并清掉，
          重要的谱子记得用「导出全部」存一份备份。
        </p>
      </main>
    </div>
  )
}

/** 示例曲目和曲库共用的一行：标题、说明、「加进我的谱库」 */
function SampleRow({ entry, onAdd }: { entry: CatalogEntry; onAdd: () => void }) {
  return (
    <li>
      <span className="score-open sample">
        <span className="score-title">{entry.name}</span>
        <span className="score-note">{entry.note}</span>
      </span>
      <span className="score-actions">
        <button onClick={onAdd}>加进我的谱库</button>
      </span>
    </li>
  )
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
