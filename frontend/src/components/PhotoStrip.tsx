import { useState } from 'react'
import { api, Photo } from '../api'
import { formatDate } from '../format'

const STATUS_LABEL: Record<Photo['status'], string> = {
  pending: '대기',
  processing: '분석 중',
  done: '완료',
  error: '실패',
}

export default function PhotoStrip({ photos, onError }: { photos: Photo[]; onError: (m: string) => void }) {
  const [open, setOpen] = useState<Photo | null>(null)

  const retry = async (p: Photo) => {
    try {
      await api.retryPhoto(p.id)
    } catch (e) {
      onError((e as Error).message)
    }
  }
  const remove = async (p: Photo) => {
    if (!window.confirm('이 사진과 추출된 메뉴를 삭제할까요? (주문 기록은 남습니다)')) return
    try {
      await api.deletePhoto(p.id)
      setOpen(null)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  if (photos.length === 0) return <p className="muted">아직 사진이 없습니다.</p>

  return (
    <>
      <ul className="photo-grid">
        {photos.map((p) => (
          <li key={p.id} className={`photo ${p.status}`} onClick={() => setOpen(p)}>
            <img src={api.thumbUrl(p.id)} alt={p.original_name} loading="lazy" />
            <div className="photo-meta">
              <span className={`status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
              {p.status === 'done' && <span className="small">{p.items.length}개</span>}
              {p.status === 'processing' && (
                <span className="small">
                  {p.items.length}
                  {p.progress_total > 0 ? ` / ${p.progress_total}` : ''}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {open && (
        <div className="modal" onClick={() => setOpen(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <img src={api.photoUrl(open.id)} alt={open.original_name} />
            <div className="modal-info">
              <p>
                <span className={`status ${open.status}`}>{STATUS_LABEL[open.status]}</span>{' '}
                <span className="muted small">{formatDate(open.created_at)}</span>
                {open.detected_language && <span className="chip">{open.detected_language}</span>}
                {open.restaurant_hint && <span className="chip">{open.restaurant_hint}</span>}
              </p>
              {open.error && <p className={open.status === 'error' ? 'error' : 'info'}>{open.error}</p>}
              {open.engine_model && (
                <p className="muted small">
                  마지막 분석: {open.engine_model} · 입력 {open.input_tokens.toLocaleString('ko-KR')} / 출력{' '}
                  {open.output_tokens.toLocaleString('ko-KR')} 토큰
                  {open.cost_usd !== null && ` · $${open.cost_usd.toFixed(4)}`}
                </p>
              )}
              <div className="row">
                {open.status !== 'processing' && <button onClick={() => retry(open)}>다시 분석</button>}
                <button className="danger" onClick={() => remove(open)}>
                  삭제
                </button>
                <button onClick={() => setOpen(null)}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
