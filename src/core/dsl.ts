/**
 * 谱头字段 ↔ DSL 文本 的互转。
 *
 * UI 把谱头做成表单、正文仍是文本框；两者在送进 compile() 之前拼回完整 DSL，
 * 这样解析器只认一种输入格式，不必为表单单开一条路径。
 */

import { HEADER_ALIASES, HEADER_KEYS, splitSections } from './parser'

export type HeaderKey = (typeof HEADER_KEYS)[number]
export type HeaderFields = Record<HeaderKey, string>

export const EMPTY_FIELDS: HeaderFields = {
  标题: '',
  副标题: '',
  制谱: '',
  箫调: 'G',
  筒音作: '2',
  调号: '',
  拍号: '4/4',
  速度: '',
}

/** 把完整 DSL 拆成「谱头字段」+「正文」 */
export function splitDsl(src: string): { fields: HeaderFields; body: string } {
  const { headerText, bodyText } = splitSections(src)
  const fields: HeaderFields = { ...EMPTY_FIELDS }
  // 没写的字段一律清空，避免残留默认值让用户以为自己填过
  for (const key of HEADER_KEYS) fields[key] = ''

  for (const line of headerText.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('//')) continue
    const m = /^([^:：]+)[:：]\s*(.*)$/.exec(t)
    if (!m) continue
    const key = (HEADER_ALIASES[m[1].trim()] ?? m[1].trim()) as HeaderKey
    if ((HEADER_KEYS as readonly string[]).includes(key)) fields[key] = m[2].trim()
  }

  return { fields, body: bodyText }
}

/**
 * 把「谱头字段」+「正文」拼回完整 DSL；空字段不输出。
 * keyLabel：「箫调」这一项落到文本里叫什么——笛谱写成「笛调」，读回来仍是同一个字段。
 */
export function buildDsl(fields: HeaderFields, body: string, keyLabel: '箫调' | '笛调' = '箫调'): string {
  const lines: string[] = []
  for (const key of HEADER_KEYS) {
    const value = fields[key]?.trim()
    if (value) lines.push(`${key === '箫调' ? keyLabel : key}: ${value}`)
  }
  return `${lines.join('\n')}\n\n${body}`
}
