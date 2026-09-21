import type { HeaderFields, HeaderKey } from '../core/dsl'

/** 常见箫调（筒音作5 时的调） */
const XIAO_KEYS = ['G', 'F', 'D', 'C', 'A', 'bB', 'bE']

/** 筒音唱名；指法表里收录到 ♭7 */
const TONE_OPTIONS = ['1', '2', '3', '4', '5', '6', 'b7', '7']

const METERS = ['4/4', '3/4', '2/4', '2/2', '6/8', '3/8']

export interface HeaderFormProps {
  fields: HeaderFields
  onChange: (key: HeaderKey, value: string) => void
  /** 由 箫调 + 筒音作 推导出的调号，作为「调号」留空时的占位提示 */
  derivedKey: string | null
  /** 简谱模式下箫调/筒音作只影响不再显示的洞洞谱，收起来，调号改为直接填 */
  jianpu?: boolean
}

export function HeaderForm({ fields, onChange, derivedKey, jianpu = false }: HeaderFormProps) {
  const set = (key: HeaderKey) => (e: { target: { value: string } }) => onChange(key, e.target.value)

  return (
    <div className="header-form">
      <label className="wide">
        <span>标题</span>
        <input value={fields.标题} onChange={set('标题')} placeholder="必填" />
      </label>

      <label className="wide">
        <span>副标题</span>
        <input value={fields.副标题} onChange={set('副标题')} placeholder="如：箫筒音作2" />
      </label>

      <label className="wide">
        <span>制谱</span>
        <input value={fields.制谱} onChange={set('制谱')} placeholder="署名，渲染时自动加「制谱」二字" />
      </label>

      {jianpu ? null : (
      <label>
        <span>箫调</span>
        <select value={fields.箫调} onChange={set('箫调')}>
          {XIAO_KEYS.map((k) => (
            <option key={k} value={k}>
              {k}调
            </option>
          ))}
        </select>
      </label>
      )}

      {jianpu ? null : (
      <label>
        <span>筒音作</span>
        <select value={fields.筒音作} onChange={set('筒音作')}>
          {TONE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      )}

      <label>
        <span>拍号</span>
        <select value={fields.拍号} onChange={set('拍号')}>
          {METERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {METERS.includes(fields.拍号) ? null : <option value={fields.拍号}>{fields.拍号}</option>}
        </select>
      </label>

      <label>
        <span>速度</span>
        <input
          value={fields.速度}
          onChange={set('速度')}
          placeholder="BPM，留空不显示"
          inputMode="numeric"
        />
      </label>

      <label className={jianpu ? 'wide' : undefined}>
        <span>调号</span>
        <input
          value={fields.调号}
          onChange={set('调号')}
          placeholder={jianpu ? '如 1=C' : derivedKey ? `${derivedKey}（自动）` : '自动'}
        />
      </label>
    </div>
  )
}
