import { useEffect, useState } from 'react'
import { Photo } from '../api'

// 분석 중인 사진마다 진행률을 보여 준다.
// - 예상 항목 수(progress_total) 가 오기 전: "메뉴판 읽는 중" (불확정 바)
// - 이후: 번역된 개수 / 예상 개수 와 경과 시간
export default function ProgressBanner({ photos }: { photos: Photo[] }) {
  const active = photos.filter((p) => p.status === 'pending' || p.status === 'processing')
  const [, tick] = useState(0)

  useEffect(() => {
    if (active.length === 0) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [active.length])

  if (active.length === 0) return null

  return (
    <div className="progress-list">
      {active.map((p, idx) => {
        const done = p.items.length
        const total = p.progress_total
        const started = p.started_at ?? p.created_at
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(started).getTime()) / 1000))
        const pct = total > 0 ? Math.min(97, Math.round((done / total) * 100)) : 0
        let label: string
        if (p.status === 'pending') label = '대기 중'
        else if (total === 0 && done === 0) label = '메뉴판 읽는 중'
        else if (total > 0) label = `${done} / 약 ${total}개 번역됨`
        else label = `${done}개 번역됨`
        return (
          <div key={p.id} className="progress card">
            <div className="progress-head">
              <span>
                사진 {active.length > 1 ? `${idx + 1}/${active.length} ` : ''}
                <strong>{label}</strong>
              </span>
              <span className="muted small">{formatElapsed(elapsed)}</span>
            </div>
            <div className={`bar ${total > 0 && p.status === 'processing' ? '' : 'indeterminate'}`}>
              <div className="bar-fill" style={total > 0 ? { width: `${pct}%` } : undefined} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}초`
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`
}
