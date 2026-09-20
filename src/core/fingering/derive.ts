/**
 * 转调 / 指法推导（需求文档 §6）。
 *
 * 核心：指法只由「筒音作X」决定，调号不参与。
 *   index = semitone(音) − semitone(筒音)，查同一张表。
 */

import type { Accidental, NoteEvent } from '../types'
import { FINGERING_TABLE, TABLE_LENGTH } from './table'

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
  /** 长度 8，下标 0 = 第八孔（最上格）；越界时为 null */
  holes: Uint8Array | null
  /** 超出音域（index < 0 或 ≥ 32） */
  outOfRange: boolean
}

export function lookupFingering(
  note: Pick<NoteEvent, 'degree' | 'octave' | 'accidental'>,
  筒音作: number,
  筒音作Acc?: Accidental,
): FingeringLookup {
  const index = semitoneOf(note.degree, note.octave, note.accidental) - tongyinSemitone(筒音作, 筒音作Acc)
  if (index < 0 || index >= TABLE_LENGTH) {
    return { index, holes: null, outOfRange: true }
  }
  return { index, holes: FINGERING_TABLE[index], outOfRange: false }
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
