// 테마: 시스템 설정 따름(auto) / 라이트 / 다크. 선택은 기기에 저장한다.
// 첫 화면 깜빡임을 막기 위해 index.html 의 인라인 스크립트가 같은 키로 먼저 적용한다.
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'auto' | 'light' | 'dark'
const KEY = 'mt_theme'
const ORDER: Theme[] = ['auto', 'light', 'dark']
// 브라우저 상단 색(theme-color). styles.css 의 --bg 와 맞춘다.
const BG = { light: '#e8ebf1', dark: '#22262e' }

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const dark = theme === 'dark' || (theme === 'auto' && systemDark())
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? BG.dark : BG.light)
}

export function useTheme(): { theme: Theme; dark: boolean; cycle: () => void } {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [sysDark, setSysDark] = useState(systemDark)

  useEffect(() => {
    applyTheme(theme)
  }, [theme, sysDark])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSysDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const cycle = useCallback(() => {
    setTheme((prev) => {
      const next = ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length]
      try {
        if (next === 'auto') localStorage.removeItem(KEY)
        else localStorage.setItem(KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return { theme, dark: theme === 'dark' || (theme === 'auto' && sysDark), cycle }
}

export const THEME_LABEL: Record<Theme, string> = { auto: '시스템 설정', light: '라이트', dark: '다크' }
