import { useEffect, useRef } from 'react'

import { SnippetPreview } from './SnippetPreview'
import { TUTORIAL_SECTIONS, type TutorialSection } from './tutorialContent'

export interface TutorialDialogProps {
  onClose: () => void
}

export function TutorialDialog({ onClose }: TutorialDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const jump = (id: string) => {
    bodyRef.current?.querySelector(`#tut-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-tutorial" onMouseDown={(e) => e.stopPropagation()}>
        <header className="tut-head">
          <h2>箫谱生成器 · 使用说明</h2>
          <button onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <nav className="tut-nav">
          {TUTORIAL_SECTIONS.filter((s) => !s.title.startsWith('　')).map((s) => (
            <button key={s.id} onClick={() => jump(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>

        <div className="tut-body" ref={bodyRef}>
          {TUTORIAL_SECTIONS.map((s) => (
            <Section key={s.id} section={s} />
          ))}
          <p className="tut-footer">
            随时可以点右上角<b>「说明」</b>重新打开这份文档。
          </p>
        </div>

        <footer className="modal-actions">
          <button className="primary" onClick={onClose}>
            开始使用
          </button>
        </footer>
      </div>
    </div>
  )
}

function Section({ section }: { section: TutorialSection }) {
  return (
    <section className="tut-section" id={`tut-${section.id}`}>
      <h3>{section.title}</h3>
      {section.intro ? <p>{section.intro}</p> : null}

      {section.rows ? (
        <table className="tut-table">
          <tbody>
            {section.rows.map(([k, v], i) => (
              <tr key={i}>
                <th>
                  <code>{k}</code>
                </th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {section.examples?.map((ex, i) => (
        <figure className="tut-example" key={i}>
          <pre className="tut-code">{ex.body}</pre>
          <SnippetPreview body={ex.body} hideFingering={ex.hideFingering} />
          {ex.caption ? <figcaption>{ex.caption}</figcaption> : null}
        </figure>
      ))}

      {section.note ? <p className="tut-note">{section.note}</p> : null}
    </section>
  )
}
