import { FormEvent, useState } from 'react'
import { api, SessionDetail, SessionPatch } from '../api'
import { formatVisit, googleMapsUrl, isoToLocalInput, localInputToIso } from '../format'
import { MapPinIcon } from './icons'

// 세션 상단: 제목 + 가게 정보(상호명, 주소, 구글 맵) + 방문 일시. 탭하면 편집 폼이 열린다.
export default function SessionInfoCard({
  session,
  onError,
  onDelete,
}: {
  session: SessionDetail
  onError: (m: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const mapUrl = googleMapsUrl(session)
  const hasStore = session.store_name || session.address || session.lat !== null || session.map_url

  return (
    <div className="card session-info">
      <div className="info-head">
        <div>
          <h1>{session.name}</h1>
          {session.store_name && session.store_name !== session.name && <div className="store-name">{session.store_name}</div>}
          {session.visited_at ? (
            <div className="muted small">방문 {formatVisit(session.visited_at)}</div>
          ) : (
            <div className="muted small">방문 일시 미입력</div>
          )}
          {session.address && <div className="small address">{session.address}</div>}
        </div>
        <button className="small-btn" onClick={() => setEditing(true)}>
          편집
        </button>
      </div>

      <div className="row info-actions">
        {mapUrl ? (
          <a className="btn-link" href={mapUrl} target="_blank" rel="noopener noreferrer">
            <MapPinIcon /> 구글 맵에서 보기
          </a>
        ) : (
          <span className="muted small">가게 정보를 입력하면 지도 링크가 생깁니다.</span>
        )}
        {!hasStore && !mapUrl && null}
      </div>
      {session.note && <p className="muted small note">{session.note}</p>}

      {editing && <EditDialog session={session} onClose={() => setEditing(false)} onError={onError} onDelete={onDelete} />}
    </div>
  )
}

function EditDialog({
  session,
  onClose,
  onError,
  onDelete,
}: {
  session: SessionDetail
  onClose: () => void
  onError: (m: string) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(session.name)
  const [storeName, setStoreName] = useState(session.store_name)
  const [address, setAddress] = useState(session.address)
  const [mapUrl, setMapUrl] = useState(session.map_url)
  const [visited, setVisited] = useState(isoToLocalInput(session.visited_at))
  const [note, setNote] = useState(session.note)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    session.lat !== null && session.lng !== null ? { lat: session.lat, lng: session.lng } : null,
  )
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)

  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) {
      onError('이 브라우저에서는 위치 정보를 사용할 수 없습니다.')
      return
    }
    if (!window.isSecureContext) {
      onError('위치 정보는 HTTPS 에서만 사용할 수 있습니다. 주소를 직접 입력하거나 지도 링크를 붙여 넣어 주세요.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) })
        setLocating(false)
      },
      (err) => {
        onError(`위치를 가져오지 못했습니다: ${err.message}`)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!name.trim()) return
    const patch: SessionPatch = {
      name: name.trim(),
      store_name: storeName.trim(),
      address: address.trim(),
      map_url: mapUrl.trim(),
      note,
    }
    if (coords) {
      patch.lat = coords.lat
      patch.lng = coords.lng
    } else if (session.lat !== null) {
      patch.clear_location = true
    }
    const iso = localInputToIso(visited)
    if (iso) patch.visited_at = iso
    else if (session.visited_at) patch.clear_visited_at = true

    setSaving(true)
    try {
      await api.updateSession(session.id, patch)
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-body form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>세션 정보</h2>

        <label>
          <span>
            세션 이름 <span className="req">*</span>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </label>
        <label>
          상호명
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} maxLength={200} placeholder="메뉴판에 적힌 가게 이름" />
        </label>
        <label>
          주소
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} placeholder="도로명 주소 또는 지역" />
        </label>
        <label>
          구글 맵 링크
          <input
            value={mapUrl}
            onChange={(e) => setMapUrl(e.target.value)}
            maxLength={1000}
            inputMode="url"
            placeholder="https://maps.app.goo.gl/… (공유 링크 붙여넣기)"
          />
        </label>

        <div className="field">
          <span>현재 위치</span>
          <div className="row">
            <button type="button" onClick={useCurrentLocation} disabled={locating}>
              {locating ? '위치 확인 중…' : '📍 현재 위치 저장'}
            </button>
            {coords && (
              <>
                <span className="muted small">
                  {coords.lat}, {coords.lng}
                </span>
                <button type="button" className="small-btn" onClick={() => setCoords(null)}>
                  지우기
                </button>
              </>
            )}
          </div>
        </div>

        <label>
          <span>
            방문 일시 <span className="muted small">(선택)</span>
          </span>
          <div className="row">
            <input type="datetime-local" value={visited} onChange={(e) => setVisited(e.target.value)} />
            <button type="button" className="small-btn" onClick={() => setVisited(isoToLocalInput(new Date().toISOString()))}>
              지금
            </button>
            {visited && (
              <button type="button" className="small-btn" onClick={() => setVisited('')}>
                지우기
              </button>
            )}
          </div>
        </label>

        <label>
          메모
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>

        <div className="row form-actions">
          <button type="button" className="danger" onClick={onDelete}>
            세션 삭제
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={saving || !name.trim()}>
            저장
          </button>
        </div>
      </form>
    </div>
  )
}
