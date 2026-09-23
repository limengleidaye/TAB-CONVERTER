import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlayerDialog } from '../src/components/PlayerDialog'
import { buildDsl, splitDsl } from '../src/core/dsl'
import {
  deriveKeySignature,
  keySignaturePitchClass,
  lookupFingering,
} from '../src/core/fingering/derive'
import { DIZI_HOLE_ORDER, DIZI_TABLE, DIZI_TABLE_LENGTH } from '../src/core/fingering/dizi'
import { DIZI, XIAO } from '../src/core/fingering/instruments'
import { SYMBOL_HOLE } from '../src/core/fingering/table'
import { M } from '../src/core/layout'
import { parse } from '../src/core/parser'
import { compile } from '../src/core/pipeline'
import { buildTimeline } from '../src/core/playback'
import { guessMode, instrumentOf, keyLabelOf, normalizeMode } from '../src/store/library'

const REPO = join(import.meta.dirname, '..')

const SYM: Record<string, number> = { '●': 0, '○': 1, '◐': 2 }
const holesOf = (s: string) => Array.from(s, (c) => SYM[c])

describe('六孔笛指法表转录', () => {
  it('与 六孔笛指法表.md 逐格一致', () => {
    const md = readFileSync(join(REPO, '六孔笛指法表.md'), 'utf8')
    const rows = DIZI_HOLE_ORDER.map((hole) => {
      const line = md.split('\n').find((l) => l.startsWith(`| ${hole} `))
      if (!line) throw new Error(`md 里找不到「${hole}」这一行`)
      return line
        .split('|')
        .slice(2, -1)
        .map((c) => SYMBOL_HOLE[c.trim()])
    })
    for (let i = 0; i < DIZI_TABLE_LENGTH; i++) {
      expect(Array.from(DIZI_TABLE[i]), `音位${i + 1}`).toEqual(rows.map((r) => r[i]))
    }
  })

  it('每个音位 6 个孔，没有「可开可闭」', () => {
    for (const holes of DIZI_TABLE) {
      expect(holes).toHaveLength(6)
      expect(Array.from(holes).every((h) => h <= 2)).toBe(true)
    }
  })
})

/**
 * 原图逐格核对：七张「筒音作X指法表」原图（xdz.ilaozhu.com），每行按图抄下，「或」的两种按法用 | 分开。
 * 表里的按法必须是图上给出的其中一种。图上的 ◎（半孔）这里写作 ◐。
 */
const CHARTS: Record<number, [string, string][]> = {
  1: [
    ['1_', '●●●●●●'], ['2_', '●●●●●○'], ['3_', '●●●●○○'], ['4_', '●●●○○○'], ['5_', '●●○○○○'],
    ['6_', '●○○○○○'], ['7_', '○○○○○○'], ['1', '●●●●●●|○●●●●●'], ['2', '●●●●●○'], ['3', '●●●●○○'],
    ['4', '●●●○○○'], ['5', '●●○○○○'], ['6', '●○○○○○'], ['7', '○○○○○○'],
    ['1^', '○●●●●●|○●●○○○'], ['2^', '●●○●●○'],
  ],
  2: [
    ['2_', '●●●●●●'], ['3_', '●●●●●○'], ['4_', '●●●●○●|●●●●◐○'], ['5_', '●●●○○○'], ['6_', '●●○○○○'],
    ['7_', '●○○○○○'], ['1', '○●●○○○|◐○○○○○'], ['2', '○●●●●●|●●●●●●'], ['3', '●●●●●○'],
    ['4', '●●●●○●|●●●●◐○'], ['5', '●●●○○○'], ['6', '●●○○○○'], ['7', '●○○○○○'],
    ['1^', '○●●●●○|◐○○○○○'], ['2^', '○●●●●●|○●●○○○'], ['3^', '●●○●●○'],
  ],
  3: [
    ['3_', '●●●●●●'], ['4_', '●●●●●◐'], ['5_', '●●●●○●|●●●●◐○'], ['6_', '●●●○○○'], ['7_', '●●○○○○'],
    ['1', '●◐○○○○|●○●●●○'], ['2', '○●●○○○|◐○○○○○'], ['3', '●●●●●●|○●●●●●'], ['4', '●●●●●◐'],
    ['5', '●●●●○●|●●●●◐○'], ['6', '●●●○○○'], ['7', '●●○○○○'], ['1^', '●◐○○○○|●○●○○○'],
    ['2^', '○●●●●○|◐○○○○○'], ['3^', '○●●●●●|○●●○○○'], ['4^', '●●◐●●○'],
  ],
  4: [
    ['4_', '●●●●●●'], ['5_', '●●●●●○'], ['6_', '●●●●○○'], ['7_', '●●◐○○○'], ['1', '●●○○○○'],
    ['2', '●○○○○○'], ['3', '○○○○○○'], ['4', '○●●●●●'], ['5', '●●●●●○'], ['6', '●●●●○○'],
    ['7', '●●◐○○○'], ['1^', '●●○○○○'], ['2^', '●○○○○○'], ['3^', '○○○○○○'],
    ['4^', '○●●●●●|○●●○○○'], ['5^', '●●○●●○'],
  ],
  5: [
    ['5_', '●●●●●●'], ['6_', '●●●●●○'], ['7_', '●●●●○○'], ['1', '●●●○○○'], ['2', '●●○○○○'],
    ['3', '●○○○○○'], ['4', '○●●○○○|◐○○○○○'], ['5', '○●●●●●|●●●●●●'], ['6', '●●●●●○'],
    ['7', '●●●●○○'], ['1^', '●●●○○○'], ['2^', '●●○○○○'], ['3^', '●○○○○○'],
    ['4^', '○●●●●○|◐○○○○○'], ['5^', '○●●●●●|○●●○○○'], ['6^', '●●○●●○'],
  ],
  6: [
    ['6_', '●●●●●●'], ['7_', '●●●●●○'], ['1', '●●●●○●|●●●●◐○'], ['2', '●●●○○○'], ['3', '●●○○○○'],
    ['4', '●◐○○○○|●○●●●○'], ['5', '○●●○○○|◐○○○○○'], ['6', '●●●●●●|○●●●●●'], ['7', '●●●●●○'],
    ['1^', '●●●●○●|●●●●◐○'], ['2^', '●●●○○○'], ['3^', '●●○○○○'], ['4^', '●◐○○○○|●○●○○○'],
    ['5^', '○●●●●○|◐○○○○○'], ['6^', '○●●●●●|○●●○○○'], ['7^', '●●○●●○'],
  ],
  7: [
    ['7_', '●●●●●●'], ['1', '●●●●●◐'], ['2', '●●●●○●'], ['3', '●●●○○○'], ['4', '●●◐○○○'],
    ['5', '●◐○○○○'],
    // 图上画的是 ○○●●○○，与其余六张图的同一音位（○●●○○○ / ◐○○○○○）都对不上，表里没采用
    ['6', '○○●●○○|○●●○○○'],
    ['7', '○●●●●●'], ['1^', '●●●●●◐'], ['2^', '●●●●○●'], ['3^', '●●●○○○'], ['4^', '●●◐○○○'],
    ['5^', '●◐○○○○'], ['6^', '○●●●●○|◐○○○○○'], ['7^', '○●●●●●|○●●○○○'],
    // 图上标「高音1」，按顺序其实是倍高音 1；与筒音作3 的高音4 同一音位，表里用了后者 ●●◐●●○
    ['1^^', '○●●○○◐|●●◐●●○'],
  ],
}

function noteOf(name: string) {
  const degree = Number(name[0])
  const octave = name.includes('_') ? -1 : (name.match(/\^/g) ?? []).length
  return { degree, octave }
}

describe('六孔笛：与七张原图逐格核对', () => {
  for (const [tone, rows] of Object.entries(CHARTS)) {
    it(`筒音作${tone}`, () => {
      for (const [name, options] of rows) {
        const hit = lookupFingering(noteOf(name), Number(tone), undefined, 0, DIZI)
        expect(hit.outOfRange, `${name} 超出音域`).toBe(false)
        const allowed = options.split('|').map(holesOf)
        expect(allowed, `筒音作${tone} ${name}`).toContainEqual(Array.from(hit.holes!))
      }
    })
  }

  it('筒音作5：低音5 → 高音6 共 27 个音位，再往上 / 往下都算出音域', () => {
    expect(lookupFingering({ degree: 5, octave: -1 }, 5, undefined, 0, DIZI).index).toBe(0)
    expect(lookupFingering({ degree: 6, octave: 1 }, 5, undefined, 0, DIZI).index).toBe(26)
    expect(lookupFingering({ degree: 7, octave: 1 }, 5, undefined, 0, DIZI).outOfRange).toBe(true)
    expect(lookupFingering({ degree: 4, octave: -1 }, 5, undefined, 0, DIZI).outOfRange).toBe(true)
  })
})

/** 原图笛子转调表：笛子本调 × 筒音作法 → 调号 */
const KEY_CHART: Record<string, Record<number, string>> = {
  C: { 5: 'C', 1: 'G', 2: 'F', 3: 'bE', 6: 'bB' },
  D: { 5: 'D', 1: 'A', 2: 'G', 3: 'F', 6: 'C' },
  E: { 5: 'E', 1: 'B', 2: 'A', 3: 'G', 6: 'D' },
  F: { 5: 'F', 1: 'C', 2: 'bB', 3: 'bA', 6: 'bE' },
  G: { 5: 'G', 1: 'D', 2: 'C', 3: 'bB', 6: 'F' },
  A: { 5: 'A', 1: 'E', 2: 'D', 3: 'C', 6: 'G' },
  bB: { 5: 'bB', 1: 'F', 2: 'bE', 3: 'bD', 6: 'bA' },
}

describe('笛子转调表', () => {
  for (const [key, row] of Object.entries(KEY_CHART)) {
    it(`${key} 调笛`, () => {
      for (const [tone, expected] of Object.entries(row)) {
        const derived = deriveKeySignature(key, Number(tone))
        expect(keySignaturePitchClass(derived), `${key}调笛 筒音作${tone}`).toBe(
          keySignaturePitchClass(`1=${expected}`),
        )
      }
    })
  }
})

const D_DIZI = `标题: 笛测试
笛调: D
筒音作: 5
拍号: 4/4

5_ 1 5 1^ |
`

describe('笛谱：谱头、校验、排版、播放', () => {
  it('「笛调:」与「箫调:」是同一字段', () => {
    const r = parse(D_DIZI)
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.score!.header.箫调).toBe('D')
  })

  it('谱头表单往返：笛谱写回「笛调:」，箫谱写回「箫调:」', () => {
    const { fields, body } = splitDsl(D_DIZI)
    expect(fields.箫调).toBe('D')
    expect(buildDsl(fields, body, keyLabelOf('dizi'))).toContain('笛调: D')
    expect(buildDsl(fields, body, keyLabelOf('xiao'))).toContain('箫调: D')
  })

  it('D 调笛筒音作 5 → 1=D，筒音 A4 = 440Hz', () => {
    const r = compile(D_DIZI, { instrument: DIZI })
    expect(r.layout!.keySignature).toBe('1=D')
    const tl = buildTimeline(r.score!, r.layout!, { mode: 'dizi' })
    expect(tl.steps[0].freq).toBeCloseTo(440, 3)
    // 中音 1 = D5
    expect(tl.steps[1].freq).toBeCloseTo(587.33, 1)
  })

  it('同一份谱按箫播，筒音落在箫的音区（G 调箫筒音 D4）', () => {
    const src = D_DIZI.replace('笛调: D', '箫调: G')
    const r = compile(src, { instrument: XIAO })
    const tl = buildTimeline(r.score!, r.layout!, { mode: 'xiao' })
    expect(tl.steps[0].freq).toBeCloseTo(293.66, 1)
  })

  it('洞洞谱一列按六个孔、两段排高', () => {
    const r = compile(D_DIZI, { instrument: DIZI })
    const b = r.layout!.bands
    expect(b.fingerH).toBe(b.fingerLabelH + M.fingerCellH * 6 + M.fingerSepH)
    expect(r.layout!.instrument).toBe(DIZI)
  })

  it('超出音域的警告写的是六孔笛', () => {
    const src = D_DIZI.replace('5_ 1 5 1^ |', '3^^ 1 5 1^ |')
    const msgs = compile(src, { instrument: DIZI }).issues.map((i) => i.message)
    expect(msgs.some((m) => m.includes('六孔笛音域') && m.includes('表长 27'))).toBe(true)
  })

  it('调号对不上时，警告里叫「笛调」', () => {
    const src = D_DIZI.replace('筒音作: 5', '筒音作: 5\n调号: 1=C')
    const msgs = compile(src, { instrument: DIZI }).issues.map((i) => i.message)
    expect(msgs.some((m) => m.includes('笛调D'))).toBe(true)
  })

  it('播放窗：笛谱有洞洞谱条，音色是笛声', () => {
    const r = compile(D_DIZI, { instrument: DIZI })
    const html = renderToStaticMarkup(
      createElement(PlayerDialog, {
        score: r.score!,
        layout: r.layout!,
        mode: 'dizi',
        ambiguousPolicy: '闭' as const,
        warnings: [],
        onClose: () => {},
      }),
    )
    expect(html).toContain('player-strip')
    expect(html).toContain('笛声')
  })
})

describe('谱库：三种谱面类型', () => {
  it('旧记录只有 xiao / jianpu，认不出的当箫谱', () => {
    expect(normalizeMode('dizi')).toBe('dizi')
    expect(normalizeMode('jianpu')).toBe('jianpu')
    expect(normalizeMode(undefined)).toBe('xiao')
    expect(normalizeMode('whatever')).toBe('xiao')
  })

  it('导入 .txt 时，谱头写了「笛调:」就当笛谱', () => {
    expect(guessMode(D_DIZI)).toBe('dizi')
    expect(guessMode(D_DIZI.replace('笛调', '箫调'))).toBe('xiao')
    // 正文里出现「笛调」字样不算
    expect(guessMode('标题: x\n箫调: G\n筒音作: 5\n拍号: 4/4\n\n笛调: 1 2 |')).toBe('xiao')
  })

  it('模式 → 乐器', () => {
    expect(instrumentOf('xiao')).toBe(XIAO)
    expect(instrumentOf('dizi')).toBe(DIZI)
    expect(instrumentOf('jianpu')).toBeNull()
  })
})
