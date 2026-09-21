/**
 * DSL 正文分词器。
 * 头部（键值对）由 parseHeader 单独处理，这里只切正文音符流。
 */

import { findCommand, parseMeter, sectionOf, tempoOf } from './commands'
import type { Accidental, Meter, TempoMark } from './types'

export type TokenKind =
  | 'note' // 音符 / 休止符
  | 'dash' // 延音横线 -
  | 'lparen' // (
  | 'rparen' // )
  | 'lbrace' // {
  | 'rbrace' // }
  | 'langle' // <  倚音开始
  | 'rangle' // >  倚音结束
  | 'tupletOpen' // N:{
  | 'barline' // |
  | 'finalBarline' // ||
  | 'repeatStart' // |:
  | 'repeatEnd' // :|
  | 'volta' // [1.  [2.
  | 'meter' // \meter=3/4 曲中变拍号
  | 'tempo' // 速度=88 / 渐快 / 渐慢 / 原速 / 延长
  | 'section' // D.C. / D.S. / Fine / Coda / %
  | 'fermata' // 自由延长，加在前一个音上

export interface Token {
  kind: TokenKind
  span: [number, number]
  raw: string
  /* note */
  degree?: number
  accidental?: Accidental
  octave?: number
  dotted?: boolean
  /** 后缀 ~：与下一个音相连（延音线） */
  tie?: boolean
  /** 各段歌词，`/` 分段 */
  lyrics?: string[]
  /* tuplet */
  tupletN?: number
  /* volta */
  volta?: number
  /* meter */
  meter?: Meter
  /* tempo */
  tempo?: TempoMark
  /* section */
  section?: string
}

export interface TokenizeResult {
  tokens: Token[]
  errors: { message: string; span: [number, number] }[]
}

/**
 * 歌词字符：汉字（含扩展区、兼容区，以及々〆 等重文号）。
 * 用 Unicode Script 属性，比手写码点区间可读，也不会漏掉扩展区。
 * 带空格/标点的词块走 "…" 引号分支，不归这里管。
 */
const LYRIC_CHAR = /\p{Script=Han}/u

/**
 * 兼容别名。首选写法是反斜杠命令（见 core/commands.ts）——
 * 正文里的中文一律当歌词，让中文再兼任记号会有歧义。
 * 这些旧写法继续认，但界面与教程只展示 \ 命令。
 */
const TEMPO_WORDS: Record<string, TempoMark> = {
  渐快: { kind: 'accel' },
  渐慢: { kind: 'rit' },
  原速: { kind: 'atempo' },
  'accel.': { kind: 'accel' },
  accel: { kind: 'accel' },
  'rit.': { kind: 'rit' },
  rit: { kind: 'rit' },
  'a tempo': { kind: 'atempo' },
}

const FERMATA_WORDS = ['延长']

const SECTION_WORDS: Record<string, string> = {
  'D.C.': 'D.C.',
  'D.S.': 'D.S.',
  Fine: 'Fine',
  Coda: 'Coda',
  '⊕': 'Coda',
  '%': 'Segno',
}

export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = []
  const errors: { message: string; span: [number, number] }[] = []
  let i = 0

  const push = (t: Token) => tokens.push(t)

  while (i < src.length) {
    const ch = src[i]

    // 空白
    if (/\s/.test(ch)) {
      i++
      continue
    }

    // 注释：// 到行尾
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }

    const start = i

    // 多字符记号优先
    if (src.startsWith('||', i)) {
      push({ kind: 'finalBarline', span: [i, i + 2], raw: '||' })
      i += 2
      continue
    }
    if (src.startsWith('|:', i)) {
      push({ kind: 'repeatStart', span: [i, i + 2], raw: '|:' })
      i += 2
      continue
    }
    if (src.startsWith(':|', i)) {
      push({ kind: 'repeatEnd', span: [i, i + 2], raw: ':|' })
      i += 2
      continue
    }

    // 房子 [1.  [2.
    const volta = /^\[(\d+)\.?/.exec(src.slice(i))
    if (volta) {
      push({
        kind: 'volta',
        span: [i, i + volta[0].length],
        raw: volta[0],
        volta: Number(volta[1]),
      })
      i += volta[0].length
      continue
    }

    // 连音组 N:{
    const tuplet = /^(\d+):\{/.exec(src.slice(i))
    if (tuplet) {
      push({
        kind: 'tupletOpen',
        span: [i, i + tuplet[0].length],
        raw: tuplet[0],
        tupletN: Number(tuplet[1]),
      })
      i += tuplet[0].length
      continue
    }

    // 反斜杠命令：\rit \dc \tempo=88 …
    if (ch === '\\') {
      // 值部分收成字符串：\tempo=88 要数字，\meter=3/4 要分数，各自校验
      const m = /^\\([A-Za-z]+)(?:\s*=\s*(\d+(?:\s*\/\s*\d+)?))?/.exec(src.slice(i))
      const cmd = m ? findCommand(m[1]) : undefined
      if (!m || !cmd) {
        const end = m ? i + m[0].length : i + 1
        errors.push({ message: `未知命令 "${src.slice(i, end)}"`, span: [i, end] })
        i = end
        continue
      }
      const raw = m[0]
      const rawValue = m[2]
      const value = rawValue !== undefined && /^\d+$/.test(rawValue) ? Number(rawValue) : undefined
      if (cmd.name === 'tempo' && value === undefined) {
        errors.push({ message: '\\tempo 要带数值，例如 \\tempo=88', span: [i, i + raw.length] })
        i += raw.length
        continue
      }
      if (cmd.name === 'meter') {
        const meter = parseMeter(rawValue)
        if (!meter) {
          errors.push({
            message: '\\meter 要带拍号，例如 \\meter=3/4（分母只能是 2 4 8 16）',
            span: [i, i + raw.length],
          })
        } else {
          push({ kind: 'meter', span: [i, i + raw.length], raw, meter })
        }
        i += raw.length
        continue
      }
      if (cmd.name === 'fermata') {
        push({ kind: 'fermata', span: [i, i + raw.length], raw })
        i += raw.length
        continue
      }
      const tempo = tempoOf(cmd.name, value)
      if (tempo) {
        push({ kind: 'tempo', span: [i, i + raw.length], raw, tempo })
        i += raw.length
        continue
      }
      const section = sectionOf(cmd.name)
      if (section) {
        push({ kind: 'section', span: [i, i + raw.length], raw, section })
        i += raw.length
        continue
      }
      errors.push({ message: `未知命令 "${raw}"`, span: [i, i + raw.length] })
      i += raw.length
      continue
    }

    // 变速：速度=88（兼容写法）
    const bpm = /^速度\s*[=＝]\s*(\d+)/.exec(src.slice(i))
    if (bpm) {
      push({
        kind: 'tempo',
        span: [i, i + bpm[0].length],
        raw: bpm[0],
        tempo: { kind: 'bpm', bpm: Number(bpm[1]) },
      })
      i += bpm[0].length
      continue
    }

    // 变速关键字 / 段落记号（含 "a tempo" 这种带空格的）
    const wordHit = matchWord(src, i)
    if (wordHit) {
      const { word, len } = wordHit
      if (word === '延长') {
        push({ kind: 'fermata', span: [i, i + len], raw: word })
        i += len
        continue
      }
      if (TEMPO_WORDS[word]) {
        push({ kind: 'tempo', span: [i, i + len], raw: word, tempo: TEMPO_WORDS[word] })
      } else {
        push({ kind: 'section', span: [i, i + len], raw: word, section: SECTION_WORDS[word] })
      }
      i += len
      continue
    }

    switch (ch) {
      case '(':
        push({ kind: 'lparen', span: [i, i + 1], raw: ch })
        i++
        continue
      case ')':
        push({ kind: 'rparen', span: [i, i + 1], raw: ch })
        i++
        continue
      case '{':
        push({ kind: 'lbrace', span: [i, i + 1], raw: ch })
        i++
        continue
      case '}':
        push({ kind: 'rbrace', span: [i, i + 1], raw: ch })
        i++
        continue
      case '<':
        push({ kind: 'langle', span: [i, i + 1], raw: ch })
        i++
        continue
      case '>':
        push({ kind: 'rangle', span: [i, i + 1], raw: ch })
        i++
        continue
      case '|':
        push({ kind: 'barline', span: [i, i + 1], raw: ch })
        i++
        continue
      case '-':
        push({ kind: 'dash', span: [i, i + 1], raw: ch })
        i++
        continue
    }

    // 音符：[#bn]? [0-7] (^+|_+)? .? ~?  后接可选歌词
    const note = /^([#bn])?([0-7])(\^+|_+)?(\.)?(~)?/.exec(src.slice(i))
    if (note && note[2] !== undefined) {
      let j = i + note[0].length

      /** 一段歌词：紧跟的中文字串，或 "..." 包裹的任意词块 */
      const readVerse = (): string | undefined => {
        if (src[j] === '"') {
          const end = src.indexOf('"', j + 1)
          if (end === -1) {
            errors.push({ message: '歌词引号未闭合', span: [j, src.length] })
            j = src.length
            return undefined
          }
          const text = src.slice(j + 1, end)
          j = end + 1
          return text
        }
        let k = j
        while (k < src.length && LYRIC_CHAR.test(src[k])) k++
        if (k === j) return undefined
        const text = src.slice(j, k)
        j = k
        return text
      }

      // 多段歌词用 / 分段：`1长/韶`。
      // 分隔符在引号**外面**——引号保护内容，所以 `1"a/b"` 是一段带斜杠的词，
      // 英文段各自加引号即可：`1"la la"/"na na"`。
      let lyrics: string[] | undefined
      const firstVerse = readVerse()
      if (firstVerse !== undefined) {
        lyrics = [firstVerse]
        while (src[j] === '/') {
          const slashAt = j
          j++
          const next = readVerse()
          if (next === undefined) {
            errors.push({
              message: '"/" 后面要接下一段歌词，例如 1长/韶',
              span: [slashAt, j],
            })
            break
          }
          lyrics.push(next)
        }
      }

      const octaveRaw = note[3] ?? ''
      // 注意别写成 -octaveRaw.length：空后缀会得到 -0
      const octave = octaveRaw === '' ? 0 : octaveRaw[0] === '^' ? octaveRaw.length : -octaveRaw.length

      push({
        kind: 'note',
        span: [start, j],
        raw: src.slice(start, j),
        degree: Number(note[2]),
        accidental: note[1] as Accidental | undefined,
        octave,
        dotted: note[4] === '.',
        tie: note[5] === '~',
        lyrics,
      })
      i = j
      continue
    }

    // 走到这里说明无法识别
    let k = i
    while (k < src.length && !/\s/.test(src[k])) k++
    errors.push({ message: `无法识别的记号 "${src.slice(i, k)}"`, span: [i, k] })
    i = k === i ? i + 1 : k
  }

  return { tokens, errors }
}

/** 匹配变速/段落关键字，返回命中的词与消耗长度（"a tempo" 允许中间有空格） */
function matchWord(src: string, i: number): { word: string; len: number } | null {
  const candidates = [...Object.keys(TEMPO_WORDS), ...Object.keys(SECTION_WORDS), ...FERMATA_WORDS]
  // 长词优先，避免 "rit" 抢在 "rit." 前面
  candidates.sort((a, b) => b.length - a.length)
  for (const word of candidates) {
    if (!src.startsWith(word, i)) continue
    const after = src[i + word.length]
    // 关键字必须整体成 token（后面是空白或结束），否则可能是别的东西
    if (after !== undefined && !/\s/.test(after) && after !== '|') continue
    return { word, len: word.length }
  }
  return null
}
