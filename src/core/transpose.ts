/**
 * 换箫调 / 笛调时，把谱里写死的调一起挪。
 *
 * 筒音作不变、只换管子的调，意思是「同一套指法，换一支管子吹」：整首曲子跟着升降，
 * 洞洞谱一格不变。开头的调号是由 箫调 + 筒音作 推出来的，自己会跟着变；
 * 但谱头手写的 `调号:` 和正文里的 `\key=X` 都是**绝对**的调，不挪的话，
 * 曲中转调的幅度就变了（F 转 G 是升 2，换成 C 调管后 C 转 G 就成了降 5），
 * 后半段整段掉出音域。
 */

import type { HeaderFields } from './dsl'
import { keySignaturePitchClass, parseXiaoKey } from './fingering/derive'
import { tokenize } from './tokenize'

/** 与谱头表单里的调名写法一致（bB / bE），也是 \key= 能认的写法 */
const KEY_NAME = ['C', 'bD', 'D', 'bE', 'E', 'F', '#F', 'G', 'bA', 'A', 'bB', 'B']

function shiftName(pc: number, delta: number): string {
  return KEY_NAME[(((pc + delta) % 12) + 12) % 12]
}

/**
 * 把「箫调」改成 newKey，同时按同样的音程挪谱头 `调号:` 和正文里所有 `\key=X`。
 * 新旧调有一个认不出、或两者同音时，只改「箫调」这一项。
 * 注释里的 \key 不动（分词时已跳过注释）。
 */
export function retuneFields(
  fields: HeaderFields,
  body: string,
  newKey: string,
): { fields: HeaderFields; body: string } {
  const nextFields = { ...fields, 箫调: newKey }
  const from = parseXiaoKey(fields.箫调)
  const to = parseXiaoKey(newKey)
  if (from === null || to === null || from === to) return { fields: nextFields, body }
  const delta = to - from

  const written = fields.调号.trim() ? keySignaturePitchClass(fields.调号.replace(/\s/g, '')) : null
  if (written !== null) nextFields.调号 = `1=${shiftName(written, delta)}`

  // 从后往前替换，前面的下标才不会被改动带偏
  const keys = tokenize(body).tokens.filter((t) => t.kind === 'key' && t.key)
  let nextBody = body
  for (let k = keys.length - 1; k >= 0; k--) {
    const t = keys[k]
    const pc = keySignaturePitchClass(t.key!)
    if (pc === null) continue
    nextBody = nextBody.slice(0, t.span[0]) + `\\key=${shiftName(pc, delta)}` + nextBody.slice(t.span[1])
  }

  return { fields: nextFields, body: nextBody }
}
