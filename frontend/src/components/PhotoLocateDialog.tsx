import { useRef } from 'react'
import { api, MenuItem } from '../api'

// 메뉴 항목이 원본 사진의 어디에 있는지 표시한다. 좌표는 모델이 추정한 대략적인 값이다.
export default function PhotoLocateDialog({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const b = item.bbox

  // 여백을 조금 둬서 글자를 가리지 않게 한다 (0~1000 → %)
  const pad = 8
  const style = b
    ? {
        left: `${Math.max(0, b[0] - pad) / 10}%`,
        top: `${Math.max(0, b[1] - pad) / 10}%`,
        width: `${(Math.min(1000, b[2] + pad) - Math.max(0, b[0] - pad)) / 10}%`,
        height: `${(Math.min(1000, b[3] + pad) - Math.max(0, b[1] - pad)) / 10}%`,
      }
    : undefined

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body locate" onClick={(e) => e.stopPropagation()}>
        <div className="locate-head">
          <div>
            <strong>{item.original_name}</strong>
            <div className="muted small">{item.translated_name}</div>
          </div>
          <button onClick={onClose}>닫기</button>
        </div>
        <div className="locate-scroll">
          <div className="locate-stage">
            <img
              src={api.photoUrl(item.photo_id)}
              alt="메뉴판 원본"
              onLoad={() => boxRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
            />
            {style && <div ref={boxRef} className="locate-box" style={style} />}
          </div>
        </div>
        <p className="muted small locate-note">
          {b ? '표시 위치는 대략적인 추정값입니다.' : '이 항목은 위치 정보가 없습니다. "메뉴판 다시 불러오기" 후에 표시됩니다.'}
        </p>
      </div>
    </div>
  )
}
