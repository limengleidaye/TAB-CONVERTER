/**
 * 转调 / 指法推导（需求文档 §6）。
 *
 * 核心：指法只由「筒音作X」决定，调号不参与。
 *   index = semitone(音) − semitone(筒音)，查同一张表。
 */

import type { Accidental, Header, NoteEvent, Score } from '../types'
import { XIAO, type InstrumentDef } from './instruments'

/** 唱名 1–7 相对本调 do 的半音偏移（大调音阶） */
export const DEGREE_SEMITONE = [0, 0, 2, 4, 5, 7, 9, 11] as const

export function accidentalShift(acc?: Accidental): number {
  if (acc === '#') return 1
  if (acc === 'b') return -1
  return 0
}

/** 某音的绝对半音值（以本调 do = 0，中音八度为 0） */
export function semitoneOf(degree: number, octave: number, acc?: Accidental): number {
  return DEGREE_SEMITONE[degree] + accidentalShift(acc) + 12 * octave
}

/** 筒音的半音值：筒音唱名取低八度（§6.2） */
export function tongyinSemitone(筒音作: number, acc?: Accidental): number {
  return semitoneOf(筒音作, -1, acc)
}

export interface FingeringLookup {
  index: number
  /** 各孔状态，下标 0 = 最上一孔（箫第八孔 / 笛第六孔）；越界时为 null */
  holes: Uint8Array | null
  /** 超出音域（index < 0 或 ≥ 表长） */
  outOfRange: boolean
}

/**
 * @param keyShift 曲中转调后，本调 do 相对起始调 do 高了几个半音（见 keyShifts）。
 *   箫还是那支箫，筒音作X 是按起始调定的；转调后的唱名先折回起始调再查表。
 * @param instrument 查哪张表；箫、笛的索引口径一样，都是距筒音的半音数。
 */
export function lookupFingering(
  note: Pick<NoteEvent, 'degree' | 'octave' | 'accidental'>,
  筒音作: number,
  筒音作Acc?: Accidental,
  keyShift = 0,
  instrument: InstrumentDef = XIAO,
): FingeringLookup {
  const index =
    semitoneOf(note.degree, note.octave, note.accidental) + keyShift - tongyinSemitone(筒音作, 筒音作Acc)
  if (index < 0 || index >= instrument.tableLength) {
    return { index, holes: null, outOfRange: true }
  }
  return { index, holes: instrument.table[index], outOfRange: false }
}

/* ---------- 调号推导（§6.5） ---------- */

const PITCH_CLASS: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

const PITCH_NAME = ['C', '♭D', 'D', '♭E', 'E', 'F', '♯F', 'G', '♭A', 'A', '♭B', 'B']

/** 把「箫调」文本（G / F / bB / 降B / G调…）归一到音高类 */
export function parseXiaoKey(text: string): number | null {
  const t = text.trim().replace(/调$/, '').replace(/♭/g, 'b').replace(/♯/g, '#').replace(/^降/, 'b').replace(/^升/, '#')
  const m = /^([b#])?([A-Ga-g])$/.exec(t)
  if (m) {
    const letter = m[2].toUpperCase()
    const key = (m[1] ?? '') + letter
    const alt = letter + (m[1] ?? '')
    return PITCH_CLASS[alt] ?? PITCH_CLASS[key] ?? null
  }
  return null
}

/** 箫调 X → 筒音音名：筒音是该调的 sol（+7 半音） */
export function tongyinPitchClass(xiaoKey: string): number | null {
  const pc = parseXiaoKey(xiaoKey)
  if (pc === null) return null
  return (pc + 7) % 12
}

/**
 * 调号文本（`1=C` / `1=♭B` / `1=bB`）→ 主音音高类。
 * 简谱模式的播放音高由它定：中音 1 落在 C4~B4 这个八度里。
 */
export function keySignaturePitchClass(ks: string | null): number | null {
  if (!ks) return null
  const m = /^\s*1\s*=\s*(.+)$/.exec(ks)
  if (!m) return null
  const t = m[1].trim().replace(/♭/g, 'b').replace(/♯/g, '#')
  const norm = /^([b#])?([A-Ga-g])$/.exec(t)
  if (!norm) return null
  const letter = norm[2].toUpperCase()
  const acc = norm[1] ?? ''
  return PITCH_CLASS[letter + acc] ?? PITCH_CLASS[acc + letter] ?? null
}

/**
 * 由 箫调 + 筒音作 推导调号主音。
 * 例：箫调 G → 筒音 D；筒音作 2 → 1 = D − 2 半音 = C。
 */
export function deriveKeySignature(xiaoKey: string, 筒音作: number, acc?: Accidental): string | null {
  const tongyin = tongyinPitchClass(xiaoKey)
  if (tongyin === null) return null
  const offset = DEGREE_SEMITONE[筒音作] + accidentalShift(acc)
  const pc = ((tongyin - offset) % 12 + 12) % 12
  return `1=${PITCH_NAME[pc]}`
}

/** 全曲起始调号：谱头写了 `调号:` 就用它（规范成 ♭/♯），没写再由 箫调 + 筒音作 推 */
export function startKeyOf(header: Header): string | null {
  return header.调号
    ? header.调号.replace(/\s/g, '').replace(/b/g, '♭').replace(/#/g, '♯')
    : deriveKeySignature(header.箫调, header.筒音作, header.筒音作Accidental)
}

/**
 * 各小节（按 score.measures 下标）的调，相对起始调高了几个半音。
 *
 * 取**最近**的那个方向，落在 (−6, +6]：1=F 转 1=G 是往上 2 个半音，转 1=♭E 是往下 2 个，
 * 而不是往上 10 个。简谱的转调几乎都是就近挪，这样前后两段的中音 1 挨在一起，
 * 播放不会突然跳一个八度，箫的指法也不会整段掉出音域。
 * 起始调认不出来时没法比，一律按 0。
 */
export function keyShifts(score: Score, startKey: string | null): number[] {
  const base = keySignaturePitchClass(startKey)
  let shift = 0
  return score.measures.map((m) => {
    if (m.keyChange && base !== null) {
      const pc = keySignaturePitchClass(m.keyChange)
      if (pc !== null) {
        const d = (((pc - base) % 12) + 12) % 12
        shift = d > 6 ? d - 12 : d
      }
    }
    return shift
  })
}
