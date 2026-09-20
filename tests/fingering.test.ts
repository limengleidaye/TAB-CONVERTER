import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  deriveKeySignature,
  lookupFingering,
  semitoneOf,
  tongyinSemitone,
} from '../src/core/fingering/derive'
import {
  FINGERING_TABLE,
  HOLE,
  HOLE_ORDER,
  SYMBOL_HOLE,
  TABLE_LENGTH,
  resolveHole,
} from '../src/core/fingering/table'

const REPO = join(import.meta.dirname, '..')

/** 从 md 原文重新解析指法表，校验 TS 里的转录没有漂移 */
function parseTableFromMarkdown(): number[][] {
  const md = readFileSync(join(REPO, '八孔洞箫指法表.md'), 'utf8')
  const rows: number[][] = []
  for (const hole of HOLE_ORDER) {
    const line = md.split('\n').find((l) => l.startsWith(`| ${hole} `))
    if (!line) throw new Error(`md 里找不到「${hole}」这一行`)
    const cells = line
      .split('|')
      .slice(2, -1)
      .map((c) => c.trim())
    rows.push(cells.map((c) => SYMBOL_HOLE[c]))
  }
  // 转置成 table[index][holeIdx]
  return Array.from({ length: TABLE_LENGTH }, (_, col) => rows.map((r) => r[col]))
}

describe('指法表转录', () => {
  it('与 八孔洞箫指法表.md 逐格一致', () => {
    const fromMd = parseTableFromMarkdown()
    expect(fromMd).toHaveLength(TABLE_LENGTH)
    for (let i = 0; i < TABLE_LENGTH; i++) {
      expect(Array.from(FINGERING_TABLE[i]), `音位${i + 1}`).toEqual(fromMd[i])
    }
  })

  it('每个音位 8 个孔', () => {
    for (const holes of FINGERING_TABLE) expect(holes).toHaveLength(8)
  })

  it('◎ 默认按「闭」渲染（与两张原图一致）', () => {
    expect(resolveHole(HOLE.EITHER)).toBe(HOLE.CLOSED)
    expect(resolveHole(HOLE.EITHER, '开')).toBe(HOLE.OPEN)
    expect(resolveHole(HOLE.HALF)).toBe(HOLE.HALF)
  })
})

describe('半音 / 查表', () => {
  it('唱名半音偏移', () => {
    expect(semitoneOf(1, 0)).toBe(0)
    expect(semitoneOf(5, 0)).toBe(7)
    expect(semitoneOf(5, -1)).toBe(-5)
    expect(semitoneOf(5, 0, '#')).toBe(8)
    expect(semitoneOf(7, 0, 'b')).toBe(10)
  })

  it('b7 与 #6 是同一个 index', () => {
    const a = lookupFingering({ degree: 7, octave: 0, accidental: 'b' }, 2)
    const b = lookupFingering({ degree: 6, octave: 0, accidental: '#' }, 2)
    expect(a.index).toBe(b.index)
  })

  it('筒音作2：筒音半音值为 -10', () => {
    expect(tongyinSemitone(2)).toBe(-10)
  })

  // 需求文档 §6.4 的 worked example，已用两张原图逐格验证
  it.each([
    { name: '低音6', degree: 6, octave: -1, index: 7 },
    { name: '中音1', degree: 1, octave: 0, index: 10 },
    { name: '中音2', degree: 2, octave: 0, index: 12 },
    { name: '中音3', degree: 3, octave: 0, index: 14 },
    { name: '中音5', degree: 5, octave: 0, index: 17 },
  ])('筒音作2 时 $name → 音位 ${index}', ({ degree, octave, index }) => {
    expect(lookupFingering({ degree, octave }, 2).index).toBe(index)
  })

  it('换筒音作法只平移索引，不换表', () => {
    const at2 = lookupFingering({ degree: 5, octave: 0 }, 2).index
    const at5 = lookupFingering({ degree: 5, octave: 0 }, 5).index
    expect(at2).toBe(17)
    expect(at5).toBe(12)
  })

  it('原图核对：筒音作2 的低音6 / 中音1 / 中音2 / 中音3 孔位', () => {
    const closed = HOLE.CLOSED
    const open = HOLE.OPEN
    const either = HOLE.EITHER
    // 自上而下：第八孔 → 第一孔
    expect(Array.from(lookupFingering({ degree: 6, octave: -1 }, 2).holes!)).toEqual([
      closed, closed, closed, open, open, open, either, open,
    ])
    expect(Array.from(lookupFingering({ degree: 1, octave: 0 }, 2).holes!)).toEqual([
      open, closed, closed, closed, open, open, either, open,
    ])
    expect(Array.from(lookupFingering({ degree: 2, octave: 0 }, 2).holes!)).toEqual([
      open, closed, closed, closed, closed, closed, closed, closed,
    ])
    expect(Array.from(lookupFingering({ degree: 3, octave: 0 }, 2).holes!)).toEqual([
      closed, closed, closed, closed, closed, closed, closed, open,
    ])
  })

  it('超出音域时返回 outOfRange', () => {
    expect(lookupFingering({ degree: 1, octave: -2 }, 2).outOfRange).toBe(true)
    expect(lookupFingering({ degree: 1, octave: 3 }, 2).outOfRange).toBe(true)
  })
})

describe('调号推导（§6.5）', () => {
  it('G调箫 + 筒音作2 → 1=C', () => {
    expect(deriveKeySignature('G', 2)).toBe('1=C')
  })

  it('G调箫 + 筒音作5 → 1=G', () => {
    expect(deriveKeySignature('G', 5)).toBe('1=G')
  })

  it('F调箫 + 筒音作5 → 1=F', () => {
    expect(deriveKeySignature('F', 5)).toBe('1=F')
  })

  it('F调箫 + 筒音作2 → 1=♭B', () => {
    expect(deriveKeySignature('F', 2)).toBe('1=♭B')
  })

  it('无法识别的箫调返回 null', () => {
    expect(deriveKeySignature('H', 2)).toBeNull()
  })
})
