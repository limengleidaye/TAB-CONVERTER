/**
 * 本地谱库：IndexedDB 存谱子，纯文本 DSL 进出。
 *
 * 两条原则：
 *   1. **文件格式就是 DSL 原文**。单首导出的 .txt 就是你在编辑器里写的那段字，
 *      人能读、能发给别人、能塞进 git——不另造一套 JSON 包装。
 *      整库备份才用 JSON，因为它要带上标题、模式、时间这些库内元数据。
 *   2. **纯逻辑与 IndexedDB 分开**。序列化、解析、取标题都是纯函数（有单测），
 *      IndexedDB 那几个调用只是薄薄一层壳。
 */

import { splitDsl } from '../core/dsl'
import { splitSections } from '../core/parser'
import { INSTRUMENTS, type InstrumentDef } from '../core/fingering/instruments'

const DB_NAME = 'zhupu'
const DB_VERSION = 1
const STORE = 'scores'

/** 这首谱子给谁看：箫谱、笛谱（都带洞洞谱），还是纯简谱 */
export type ScoreMode = 'xiao' | 'dizi' | 'jianpu'

export const MODE_LABEL: Readonly<Record<ScoreMode, string>> = {
  xiao: '箫谱',
  dizi: '笛谱',
  jianpu: '纯简谱',
}

/** 这个模式要画哪支管子的洞洞谱；纯简谱为 null */
export function instrumentOf(mode: ScoreMode): InstrumentDef | null {
  return mode === 'jianpu' ? null : INSTRUMENTS[mode]
}

/** 谱头「箫调」这一项写成什么：笛谱写「笛调」 */
export function keyLabelOf(mode: ScoreMode): '箫调' | '笛调' {
  return mode === 'dizi' ? '笛调' : '箫调'
}

/**
 * 单首 .txt 导入时没有模式信息，只能看谱头猜：写了「笛调:」就是笛谱，否则按箫谱。
 * 纯简谱与箫谱的文本长得一样，分不出来，导进来后在编辑器里切一下即可。
 */
export function guessMode(dsl: string): ScoreMode {
  return /^\s*笛调\s*[:：]/m.test(splitSections(dsl).headerText) ? 'dizi' : 'xiao'
}

/** 认不出的一律当箫谱：早先的记录只有 xiao / jianpu 两种 */
export function normalizeMode(mode: unknown): ScoreMode {
  return mode === 'jianpu' || mode === 'dizi' ? mode : 'xiao'
}

export interface ScoreRecord {
  id: string
  /** 冗余存一份，列表页就不必把每首都解析一遍 */
  title: string
  dsl: string
  mode: ScoreMode
  createdAt: number
  updatedAt: number
}

export const BUNDLE_FORMAT = 'zhupu-library'
const BUNDLE_VERSION = 1

/** 新建时的空白谱：给最小可用的谱头，正文留一小节，省得一上来就是一串报错 */
export const BLANK_DSL = `标题: 未命名
箫调: G
筒音作: 2
拍号: 4/4

1 2 3 4 |
`

/* ---------------- 纯函数 ---------------- */

export function titleOf(dsl: string): string {
  const t = splitDsl(dsl).fields.标题?.trim()
  return t || '未命名'
}

export function newId(): string {
  // crypto.randomUUID 在非 https 的旧浏览器里可能没有
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function createRecord(dsl: string, mode: ScoreMode = 'xiao'): ScoreRecord {
  const now = Date.now()
  return { id: newId(), title: titleOf(dsl), dsl, mode, createdAt: now, updatedAt: now }
}

/** 文件名里不能带的字符一律换成下划线；空标题兜底 */
export function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned.slice(0, 80) || '未命名'
}

export function serializeBundle(records: ScoreRecord[]): string {
  return JSON.stringify(
    {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      scores: records,
    },
    null,
    2,
  )
}

/**
 * 解析整库备份。容错从宽：只要能认出 dsl 字段就收，缺标题/时间就地补——
 * 备份文件是用户自己手里的东西，宁可收下也别整份拒绝。
 */
export function parseBundle(text: string): ScoreRecord[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('不是合法的 JSON 文件')
  }
  const list = (data as { scores?: unknown })?.scores
  if (!Array.isArray(list)) throw new Error('这个 JSON 里没有 scores 列表，不像是谱库备份')

  const out: ScoreRecord[] = []
  for (const raw of list) {
    const r = raw as Partial<ScoreRecord>
    if (typeof r?.dsl !== 'string' || !r.dsl.trim()) continue
    const now = Date.now()
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      title: typeof r.title === 'string' && r.title.trim() ? r.title : titleOf(r.dsl),
      dsl: r.dsl,
      mode: normalizeMode(r.mode),
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    })
  }
  if (out.length === 0) throw new Error('备份里没有可用的谱子')
  return out
}

/** 导入时撞 id 就换一个新的，绝不覆盖库里已有的谱子 */
export function resolveCollisions(incoming: ScoreRecord[], existingIds: Set<string>): ScoreRecord[] {
  return incoming.map((r) => (existingIds.has(r.id) ? { ...r, id: newId() } : r))
}

export function sortByUpdated(records: ScoreRecord[]): ScoreRecord[] {
  return [...records].sort((a, b) => b.updatedAt - a.updatedAt)
}

/* ---------------- IndexedDB ---------------- */

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个浏览器不支持 IndexedDB，谱库用不了（无痕模式下也可能被禁用）'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打不开本地数据库'))
  })
  // 失败就别把失败的 promise 缓存住，下次还能重试
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('数据库操作失败'))
      }),
  )
}

export async function listScores(): Promise<ScoreRecord[]> {
  const all = await run<ScoreRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ScoreRecord[]>)
  return sortByUpdated(all)
}

export async function getScore(id: string): Promise<ScoreRecord | null> {
  const rec = await run<ScoreRecord | undefined>(
    'readonly',
    (s) => s.get(id) as IDBRequest<ScoreRecord | undefined>,
  )
  return rec ?? null
}

export async function putScore(rec: ScoreRecord): Promise<void> {
  await run('readwrite', (s) => s.put(rec) as IDBRequest<IDBValidKey>)
}

export async function putScores(recs: ScoreRecord[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const r of recs) store.put(r)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('批量写入失败'))
  })
}

export async function deleteScore(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
}

/* ---------------- 上次打开的谱子 ---------------- */

const LAST_KEY = 'zhupu:last-opened'

export function readLastOpened(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export function writeLastOpened(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    /* 隐私模式下写不进去，不影响使用 */
  }
}
