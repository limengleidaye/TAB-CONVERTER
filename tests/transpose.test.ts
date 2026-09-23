import { describe, expect, it } from 'vitest'

import { buildDsl, splitDsl } from '../src/core/dsl'
import { DIZI } from '../src/core/fingering/instruments'
import { compile } from '../src/core/pipeline'
import { retuneFields } from '../src/core/transpose'
import { 假如爱有天意 } from '../src/samples/catalog'

const rangeWarnings = (dsl: string) =>
  compile(dsl, { instrument: DIZI }).issues.filter((i) => i.message.includes('音域'))

describe('换箫调 / 笛调时 \\key 一起挪', () => {
  it('《假如爱有天意》F 调笛换 C 调笛：三处 \\key 跟着降纯四度，不再超音域', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    fields.调号 = ''
    const next = retuneFields(fields, body, 'C')
    expect(next.fields.箫调).toBe('C')
    expect(next.body).toContain('\\key=bB')
    expect(next.body).toContain('\\key=D')
    expect(next.body).toContain('\\key=C')
    expect(next.body).not.toMatch(/\\key=(bE|G|F)\b/)
    expect(rangeWarnings(buildDsl(next.fields, next.body, '笛调'))).toEqual([])
  })

  it('不挪 \\key 时就是截图里的那 4 条超音域警告（对照组）', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    fields.调号 = ''
    expect(rangeWarnings(buildDsl({ ...fields, 箫调: 'C' }, body, '笛调'))).toHaveLength(4)
  })

  it('谱头手写的调号跟着挪', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    expect(fields.调号).toBe('1=F')
    expect(retuneFields(fields, body, 'C').fields.调号).toBe('1=C')
    expect(retuneFields(fields, body, 'G').fields.调号).toBe('1=G')
  })

  it('换过去再换回来，原样复原', () => {
    const { fields, body } = splitDsl(假如爱有天意)
    const there = retuneFields(fields, body, 'C')
    const back = retuneFields(there.fields, there.body, 'F')
    expect(back.body).toBe(body)
    expect(back.fields).toEqual(fields)
  })

  it('注释里的 \\key 不动；认不出的调只改这一项', () => {
    const fields = { ...splitDsl('标题: x\n箫调: F\n筒音作: 5\n拍号: 4/4\n\n1 |').fields }
    const body = '// 这里 \\key=G 只是备注\n1 2 3 4 | \\key=G 5 6 7 1^ |\n'
    const next = retuneFields(fields, body, 'C')
    expect(next.body).toBe('// 这里 \\key=G 只是备注\n1 2 3 4 | \\key=D 5 6 7 1^ |\n')

    const odd = retuneFields(fields, body, 'H')
    expect(odd.fields.箫调).toBe('H')
    expect(odd.body).toBe(body)
  })
})
