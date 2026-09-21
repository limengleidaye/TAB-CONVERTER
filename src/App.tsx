/**
 * 路由外壳。两个页面：谱库 `#/library` 与编辑器 `#/edit/<id>`。
 *
 * 自己解析 hash，不引路由库：统共两条路径，但前进/后退、刷新回到原处、
 * 地址能收藏这几件事是真的需要——弹窗式的谱库做不到。
 */

import { useCallback, useEffect, useState } from 'react'

import { EditorPage } from './components/EditorPage'
import { LibraryPage } from './components/LibraryPage'
import { TutorialDialog } from './components/TutorialDialog'
import { getScore, readLastOpened } from './store/library'

type Route = { name: 'library' } | { name: 'edit'; id: string } | { name: 'resolving' }

/** 首次打开自动弹教程；localStorage 在隐私模式下会抛错，一律兜住 */
const TUTORIAL_SEEN_KEY = 'xiao-tab:tutorial-seen'

function readTutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
  } catch {
    /* 读不到就每次都弹，不影响使用 */
  }
}

function parseHash(hash: string): Route {
  const m = /^#\/edit\/(.+)$/.exec(hash)
  if (m) return { name: 'edit', id: decodeURIComponent(m[1]) }
  if (hash === '#/library') return { name: 'library' }
  // 空 hash：还不知道去哪，等下面那个 effect 查完上次打开的谱子再定
  return { name: 'resolving' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  const [tutorialOpen, setTutorialOpen] = useState(() => !readTutorialSeen())

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 直接进站（没有 hash）：上次打开的谱子还在就接着写，否则去谱库
  useEffect(() => {
    if (route.name !== 'resolving') return
    let alive = true
    const last = readLastOpened()
    const settle = (hash: string) => {
      if (!alive) return
      location.replace(hash)
      setRoute(parseHash(hash))
    }
    if (!last) {
      settle('#/library')
      return
    }
    getScore(last)
      .then((rec) => settle(rec ? `#/edit/${encodeURIComponent(last)}` : '#/library'))
      .catch(() => settle('#/library'))
    return () => {
      alive = false
    }
  }, [route.name])

  const go = useCallback((hash: string) => {
    location.hash = hash
  }, [])

  const closeTutorial = useCallback(() => {
    setTutorialOpen(false)
    markTutorialSeen()
  }, [])

  const openTutorial = useCallback(() => setTutorialOpen(true), [])

  return (
    <>
      {route.name === 'edit' ? (
        <EditorPage
          key={route.id}
          id={route.id}
          onOpenTutorial={openTutorial}
          onGoLibrary={() => go('#/library')}
        />
      ) : route.name === 'library' ? (
        <LibraryPage
          onOpenTutorial={openTutorial}
          onOpen={(id) => go(`#/edit/${encodeURIComponent(id)}`)}
        />
      ) : (
        <p className="page-note">读取中…</p>
      )}

      {tutorialOpen ? <TutorialDialog onClose={closeTutorial} /> : null}
    </>
  )
}
