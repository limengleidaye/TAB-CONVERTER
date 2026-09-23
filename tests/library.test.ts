import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EditorPage } from '../src/components/EditorPage'
import { LibraryPage } from '../src/components/LibraryPage'

import { buildDsl, splitDsl } from '../src/core/dsl'
import { compile } from '../src/core/pipeline'
import { buildTimeline } from '../src/core/playback'
import {
  BLANK_DSL,
  createRecord,
  parseBundle,
  resolveCollisions,
  safeFileName,
  serializeBundle,
  sortByUpdated,
  titleOf,
} from '../src/store/library'
import { SAMPLES } from '../src/samples'
import { CATALOG, searchCatalog } from '../src/samples/catalog'
import { 落了白 } from '../src/samples/reference'

describe('谱库：记录', () => {
  it('标题取自谱头，空标题兜底', () => {
    expect(titleOf(落了白)).toBe('落了白')
    expect(titleOf('箫调: G\n\n1 2 3 4 |')).toBe('未命名')
  })

  it('新记录带独立 id 与时间戳，默认是洞洞谱', () => {
    const a = createRecord(落了白)
    const b = createRecord(落了白)
    expect(a.id).not.toBe(b.id)
    expect(a.mode).toBe('xiao')
    expect(a.title).toBe('落了白')
    expect(a.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('文件名里的非法字符换成下划线', () => {
    expect(safeFileName('落了白')).toBe('落了白')
    expect(safeFileName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
    expect(safeFileName('   ')).toBe('未命名')
  })

  it('按更新时间倒序，不改动原数组', () => {
    const list = [
      { ...createRecord('标题: 甲\n\n1 |'), updatedAt: 100 },
      { ...createRecord('标题: 乙\n\n1 |'), updatedAt: 300 },
      { ...createRecord('标题: 丙\n\n1 |'), updatedAt: 200 },
    ]
    expect(sortByUpdated(list).map((r) => r.title)).toEqual(['乙', '丙', '甲'])
    expect(list[0].title).toBe('甲')
  })
})

describe('谱库：整库备份', () => {
  it('导出再导入，内容一字不差', () => {
    const recs = [createRecord(落了白), createRecord('标题: 小曲\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n1 2 |', 'jianpu')]
    const back = parseBundle(serializeBundle(recs))
    expect(back).toEqual(recs)
  })

  it('缺字段的条目就地补齐，不整份拒绝', () => {
    const json = JSON.stringify({ scores: [{ dsl: '标题: 补出来的\n\n1 |' }, { dsl: '   ' }] })
    const back = parseBundle(json)
    expect(back).toHaveLength(1)
    expect(back[0].title).toBe('补出来的')
    expect(back[0].mode).toBe('xiao')
    expect(back[0].id).toBeTruthy()
  })

  it('不是备份文件就明确报错', () => {
    expect(() => parseBundle('不是 json')).toThrow(/JSON/)
    expect(() => parseBundle('{"hello":1}')).toThrow(/scores/)
    expect(() => parseBundle('{"scores":[]}')).toThrow(/没有可用的谱子/)
  })

  it('导入撞 id 时换新 id，绝不覆盖库里已有的', () => {
    const mine = createRecord(落了白)
    const incoming = [{ ...mine, title: '别人的同 id 谱子' }]
    const fixed = resolveCollisions(incoming, new Set([mine.id]))
    expect(fixed[0].id).not.toBe(mine.id)
    expect(fixed[0].dsl).toBe(mine.dsl)
  })
})

describe('改名 = 改谱头里的标题字段', () => {
  it('只动标题那一行，正文原样', () => {
    const parts = splitDsl(落了白)
    parts.fields.标题 = '改过的名字'
    const dsl = buildDsl(parts.fields, parts.body)
    expect(titleOf(dsl)).toBe('改过的名字')
    expect(splitDsl(dsl).body).toBe(splitDsl(落了白).body)
  })
})

describe('纯简谱模式', () => {
  it('不排洞洞谱那一带', () => {
    const r = compile(落了白, { omitFingering: true })
    expect(r.layout!.omitFingering).toBe(true)
    expect(r.layout!.bands.fingerH).toBe(0)
  })

  it('音高只看调号：中音 1 落在中央 C', () => {
    const src = '标题: 测试\n调号: 1=C\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n1 2 3 4 |'
    const r = compile(src, { omitFingering: true })
    const tl = buildTimeline(r.score!, r.layout!, { mode: 'jianpu' })
    expect(tl.steps[0].freq!).toBeCloseTo(261.63, 1) // C4
    expect(tl.steps[1].freq!).toBeCloseTo(293.66, 1) // D4
  })

  it('换个调号，整体跟着移调', () => {
    const src = '标题: 测试\n调号: 1=D\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n1 2 3 4 |'
    const r = compile(src, { omitFingering: true })
    const tl = buildTimeline(r.score!, r.layout!, { mode: 'jianpu' })
    expect(tl.steps[0].freq!).toBeCloseTo(293.66, 1) // D4
  })

  it('调号与箫调不一致时，简谱模式不该拿箫来卡', () => {
    // 1=F 的简谱配 D 调箫筒音作4（推导出 1=E）：箫谱模式该警告，简谱模式不该
    const src = '标题: 测试\n调号: 1=F\n箫调: D\n筒音作: 4\n拍号: 4/4\n\n1 2 3 4 |'
    expect(compile(src).issues.map((i) => i.message)).toContain(
      '「调号:1=F」与 箫调D + 筒音作4 推导出的 1=E 不一致',
    )
    expect(compile(src, { omitFingering: true }).issues).toEqual([])
  })

  it('超出箫音域的音，简谱模式也不该报——谱面上根本没有箫', () => {
    const src = '标题: 测试\n调号: 1=C\n箫调: G\n筒音作: 2\n拍号: 4/4\n\n1__ 2 3 4 |'
    expect(compile(src).issues.map((i) => i.message).join()).toMatch(/超出八孔箫音域/)
    expect(compile(src, { omitFingering: true }).issues).toEqual([])
  })

  it('简谱模式下，调号和箫调都没有才提示', () => {
    const noKey = '标题: 测试\n箫调: 火星调\n筒音作: 2\n拍号: 4/4\n\n1 2 3 4 |'
    expect(compile(noKey, { omitFingering: true }).issues.map((i) => i.message).join()).toMatch(
      /没写「调号」/,
    )
    const hasKey = '标题: 测试\n调号: 1=C\n箫调: 火星调\n筒音作: 2\n拍号: 4/4\n\n1 2 3 4 |'
    expect(compile(hasKey, { omitFingering: true }).issues).toEqual([])
  })

  it('箫模式仍按箫的音域走：G 调箫中音 1 在 C5', () => {
    const src = '标题: 测试\n箫调: G\n筒音作: 2\n拍号: 4/4\n速度: 60\n\n1 2 3 4 |'
    const r = compile(src)
    const tl = buildTimeline(r.score!, r.layout!)
    expect(tl.steps[0].freq!).toBeCloseTo(523.25, 1) // C5
  })
})

describe('示例曲目', () => {
  it('三首：一首讲写法，两首箫谱', () => {
    expect(SAMPLES.map((s) => s.name)).toEqual(['写法示范', '茉莉花', '送别'])
    expect(SAMPLES.every((s) => s.mode === 'xiao')).toBe(true)
  })

  it.each([...SAMPLES, ...CATALOG])('$name：0 错误 0 警告', ({ dsl, mode }) => {
    // 示例是用户打开的第一样东西，左下角不该一上来就是红黄字
    const r = compile(dsl, { omitFingering: mode === 'jianpu' })
    expect(r.issues).toEqual([])
    expect(r.layout).not.toBeNull()
  })

  it('《写法示范》把该演示的记号都用上了', () => {
    const r = compile(SAMPLES[0].dsl)
    const notes = r.score!.measures.flatMap((m) => m.notes)
    expect(notes.some((n) => n.accidental)).toBe(true)
    expect(notes.some((n) => n.dotted)).toBe(true)
    expect(notes.some((n) => n.beams >= 2)).toBe(true)
    expect(notes.some((n) => n.type === 'dash')).toBe(true)
    expect(notes.some((n) => n.tiedFromPrev)).toBe(true)
    expect(notes.some((n) => n.slurStart)).toBe(true)
    expect(notes.some((n) => n.graces?.length)).toBe(true)
    expect(notes.some((n) => n.tupletStart)).toBe(true)
    expect(notes.some((n) => n.lyrics)).toBe(true)
    expect(notes.some((n) => n.fermata)).toBe(true)
    expect(notes.some((n) => n.tempoMark)).toBe(true)
    expect(r.score!.measures.some((m) => m.volta)).toBe(true)
    expect(r.score!.measures.some((m) => m.closeBarline === 'repeatEnd')).toBe(true)
    expect(r.score!.measures.some((m) => m.marks.length > 0)).toBe(true)
  })
})

describe('曲库', () => {
  it('全是纯简谱，曲名不重复，也不和示例曲目撞名', () => {
    expect(CATALOG.length).toBeGreaterThan(0)
    expect(CATALOG.every((s) => s.mode === 'jianpu')).toBe(true)
    const names = [...SAMPLES, ...CATALOG].map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('曲名与谱头「标题」一致——搜的是列表上看到的名字，加进谱库后也叫这个', () => {
    for (const s of CATALOG) expect(s.dsl, s.name).toMatch(new RegExp(`^标题: ${s.name}$`, 'm'))
  })

  it('没写关键字就全给', () => {
    expect(searchCatalog('')).toEqual(CATALOG)
    expect(searchCatalog('   ')).toEqual(CATALOG)
  })

  it('按标题里的关键字搜', () => {
    expect(searchCatalog('兰亭').map((s) => s.name)).toEqual(['兰亭序'])
    expect(searchCatalog('不存在的歌')).toEqual([])
  })

  it('空格隔开的几个关键字都要命中', () => {
    const entries = [
      { name: '烟花易冷', dsl: '', mode: 'jianpu' as const, note: '' },
      { name: '烟雨', dsl: '', mode: 'jianpu' as const, note: '' },
    ]
    expect(searchCatalog('烟', entries)).toHaveLength(2)
    expect(searchCatalog('烟 冷', entries).map((s) => s.name)).toEqual(['烟花易冷'])
  })

  it('不分大小写，间隔号和空白不影响', () => {
    expect(searchCatalog('雪见落入凡尘').map((s) => s.name)).toEqual(['雪见·落入凡尘'])
    const entries = [{ name: 'Fairy Tail', dsl: '', mode: 'jianpu' as const, note: '' }]
    expect(searchCatalog('fairy', entries)).toHaveLength(1)
  })
})

describe('页面能渲染出来（拦一道 JSX / 导入的低级错误）', () => {
  it('谱库页：读盘前先给个「读取中」，不炸', () => {
    const html = renderToStaticMarkup(
      createElement(LibraryPage, { onOpenTutorial: () => {}, onOpen: () => {} }),
    )
    expect(html).toContain('竹谱')
    expect(html).toContain('示例曲目')
    expect(html).toContain('茉莉花')
    expect(html).toContain('写法示范')
    expect(html).toContain('曲库')
    expect(html).toContain('兰亭序')
    expect(html).toContain('按标题搜索曲库')
    expect(html).toContain('读取中')
  })

  it('编辑器页：同上', () => {
    const html = renderToStaticMarkup(
      createElement(EditorPage, { id: 'nope', onOpenTutorial: () => {}, onGoLibrary: () => {} }),
    )
    expect(html).toContain('读取中')
  })

  it('新建用的空白谱本身是能编译通过的', () => {
    const r = compile(BLANK_DSL)
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    expect(r.layout).not.toBeNull()
  })
})
