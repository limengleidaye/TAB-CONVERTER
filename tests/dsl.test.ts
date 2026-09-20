import { describe, expect, it } from 'vitest'

import { buildDsl, splitDsl } from '../src/core/dsl'
import { compile } from '../src/core/pipeline'
import { SAMPLES } from '../src/samples'

describe('谱头表单 ↔ DSL 互转', () => {
  it('拆出的字段与原文一致', () => {
    const { fields } = splitDsl(SAMPLES[0].dsl)
    expect(fields).toMatchObject({
      标题: '落了白',
      副标题: '箫筒音作2',
      制谱: '董咚咚（学箫版）',
      箫调: 'G',
      筒音作: '2',
      拍号: '4/4',
    })
    // 样例里没写的字段应为空，不能残留默认值
    expect(fields.速度).toBe('')
    expect(fields.调号).toBe('')
  })

  it('正文不含谱头行', () => {
    const { body } = splitDsl(SAMPLES[0].dsl)
    expect(body).not.toMatch(/标题|箫调|拍号/)
    expect(body.trimStart().startsWith('//')).toBe(true)
  })

  it.each(SAMPLES)('$name：拆开再拼回，编译结果不变', ({ dsl }) => {
    const { fields, body } = splitDsl(dsl)
    const rebuilt = buildDsl(fields, body)

    const a = compile(dsl)
    const b = compile(rebuilt)

    expect(b.issues).toEqual(a.issues)
    expect(b.score!.header).toEqual(a.score!.header)
    expect(b.score!.measures.length).toBe(a.score!.measures.length)
    expect(b.score!.measures.map((m) => m.beats)).toEqual(a.score!.measures.map((m) => m.beats))
    expect(b.layout!.keySignature).toBe(a.layout!.keySignature)
  })

  it('空字段不输出到 DSL', () => {
    const { fields, body } = splitDsl(SAMPLES[0].dsl)
    const out = buildDsl({ ...fields, 副标题: '', 制谱: '' }, body)
    expect(out).not.toMatch(/副标题|制谱/)
    expect(out).toMatch(/标题: 落了白/)
  })

  it('速度填了就出现在 DSL 与谱头里', () => {
    const { fields, body } = splitDsl(SAMPLES[0].dsl)
    const r = compile(buildDsl({ ...fields, 速度: '66' }, body))
    expect(r.score!.header.速度).toBe(66)
  })

  it('调号留空则自动推导，填了则以填的为准', () => {
    const { fields, body } = splitDsl(SAMPLES[0].dsl)
    expect(compile(buildDsl(fields, body)).layout!.keySignature).toBe('1=C')

    const overridden = compile(buildDsl({ ...fields, 调号: '1=D' }, body))
    expect(overridden.layout!.keySignature).toBe('1=D')
    expect(overridden.issues.some((i) => i.message.includes('不一致'))).toBe(true)
  })
})
