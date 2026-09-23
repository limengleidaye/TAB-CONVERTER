import { describe, expect, it } from 'vitest'

import { DSL_COMMANDS, findCommand, matchCommands, sectionOf, tempoOf } from '../src/core/commands'
import { compile } from '../src/core/pipeline'

const HEAD = '标题: T\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n'

describe('命令表', () => {
  it('命令名唯一，且 insert 都以 \\ 开头', () => {
    const names = DSL_COMMANDS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const c of DSL_COMMANDS) {
      expect(c.insert.startsWith('\\')).toBe(true)
      expect(c.insert.slice(1).toLowerCase().startsWith(c.name)).toBe(true)
    }
  })

  it('每条命令都全是 ASCII —— 中文只留给歌词', () => {
    for (const c of DSL_COMMANDS) {
      expect(c.insert, c.name).toMatch(/^[\x20-\x7e]+$/)
    }
  })

  it('每条命令都能被分词器认出来', () => {
    for (const c of DSL_COMMANDS) {
      const r = compile(`${HEAD}1 2 ${c.insert} 3 4 |`)
      const errors = r.issues.filter((i) => i.severity === 'error')
      expect(errors, `${c.insert}: ${errors.map((e) => e.message).join()}`).toEqual([])
    }
  })

  it('每条命令恰好归一类，不会两头落空也不会兼任', () => {
    for (const c of DSL_COMMANDS) {
      // fermata 既不是变速也不是段落：它是加在音符上的演奏法，单独一类。
      // meter 同理，它改的是小节的容量，不是速度；key 改的是唱名对应的音高。
      const kinds = [
        tempoOf(c.name, 88) !== null,
        sectionOf(c.name) !== null,
        c.name === 'fermata',
        c.name === 'meter',
        c.name === 'key',
      ].filter(Boolean)
      expect(kinds, c.name).toHaveLength(1)
    }
  })

  it('前缀筛选', () => {
    expect(matchCommands('').length).toBe(DSL_COMMANDS.length)
    expect(matchCommands('r').map((c) => c.name)).toEqual(['rit'])
    expect(matchCommands('a').map((c) => c.name).sort()).toEqual(['accel', 'atempo'])
    expect(matchCommands('zzz')).toEqual([])
  })

  it('findCommand 大小写不敏感', () => {
    expect(findCommand('RIT')?.name).toBe('rit')
    expect(findCommand('nope')).toBeUndefined()
  })

  it('带数值的命令给出了选中范围，方便插入后直接改数字', () => {
    const t = findCommand('tempo')!
    expect(t.caretOffset).toBeDefined()
    expect(t.selectLength).toBeGreaterThan(0)
    const num = t.insert.slice(t.caretOffset!, t.caretOffset! + t.selectLength!)
    expect(num).toMatch(/^\d+$/)
  })
})
