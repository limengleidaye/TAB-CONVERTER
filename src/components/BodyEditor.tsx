import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { matchCommands, type DslCommand } from '../core/commands'

export interface BodyEditorProps {
  value: string
  onChange: (next: string) => void
}

interface Trigger {
  /** 反斜杠在文本里的下标 */
  at: number
  /** 反斜杠后面已经打出来的前缀 */
  prefix: string
  top: number
  left: number
}

/**
 * 正文编辑器：普通 textarea + 反斜杠命令补全。
 * 打一个 \ 就弹出命令面板，↑↓ 选，Enter / Tab 插入，Esc 关掉。
 */
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [active, setActive] = useState(0)

  const matches = useMemo(() => (trigger ? matchCommands(trigger.prefix) : []), [trigger])

  useEffect(() => {
    setActive(0)
  }, [trigger?.prefix])

  /** 光标左边最近的 \ 还没被空白打断的话，就认为正在打命令 */
  const refresh = useCallback(() => {
    const ta = ref.current
    if (!ta) return
    const pos = ta.selectionStart
    if (pos !== ta.selectionEnd) return setTrigger(null)

    const line = ta.value.lastIndexOf('\n', pos - 1) + 1
    const at = ta.value.lastIndexOf('\\', pos - 1)
    if (at < line) return setTrigger(null)

    const prefix = ta.value.slice(at + 1, pos)
    if (!/^[A-Za-z]*$/.test(prefix)) return setTrigger(null)

    const { top, left } = caretCoords(ta, at)
    setTrigger({ at, prefix, top, left })
  }, [])

  const insert = useCallback(
    (cmd: DslCommand) => {
      const ta = ref.current
      if (!ta || !trigger) return
      const before = ta.value.slice(0, trigger.at)
      const after = ta.value.slice(trigger.at + 1 + trigger.prefix.length)
      onChange(before + cmd.insert + after)
      setTrigger(null)

      // 有数值的命令（\tempo=88）插入后把数字选中，方便直接改
      const caret = trigger.at + (cmd.caretOffset ?? cmd.insert.length)
      const end = caret + (cmd.selectLength ?? 0)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(caret, end)
      })
    },
    [onChange, trigger],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trigger || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insert(matches[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setTrigger(null)
    }
  }

  return (
    <div className="body-editor">
      <textarea
        ref={ref}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value)
          requestAnimationFrame(refresh)
        }}
        onKeyUp={refresh}
        onClick={refresh}
        onKeyDown={onKeyDown}
        onBlur={() => setTrigger(null)}
      />

      {trigger && matches.length > 0 ? (
        <ul className="cmd-popup" style={{ top: trigger.top, left: trigger.left }}>
          {matches.map((c, i) => (
            <li
              key={c.name}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                insert(c)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <code>{c.insert}</code>
              <span className="cmd-render">{c.render}</span>
              <span className="cmd-desc">{c.desc}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * 求 textarea 里某个字符位置的像素坐标。
 * textarea 不暴露光标坐标，只能拿一个样式完全相同的隐藏 div 铺同样的文本，
 * 再读那个位置上 span 的 offset——这是这类补全控件的通用做法。
 */
const MIRROR_PROPS = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
  'lineHeight', 'textTransform', 'wordSpacing', 'tabSize',
] as const

function caretCoords(ta: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const mirror = document.createElement('div')
  const cs = getComputedStyle(ta)
  for (const prop of MIRROR_PROPS) mirror.style[prop] = cs[prop]
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'

  mirror.textContent = ta.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = ta.value.slice(index) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const top = marker.offsetTop - ta.scrollTop + parseFloat(cs.lineHeight || '18')
  const left = marker.offsetLeft - ta.scrollLeft
  document.body.removeChild(mirror)
  return { top, left }
}
