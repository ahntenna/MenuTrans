import { ChangeEvent, useRef, useState } from 'react'
import { api } from '../api'
import { shrinkImage } from '../resize'

const SHRINK_KEY = 'mt_shrink'

function readShrinkPref(): boolean {
  try {
    return localStorage.getItem(SHRINK_KEY) === '1' // 기본값: 원본 그대로 (축소 안 함)
  } catch {
    return false
  }
}

// iOS Safari: capture="environment" 를 주면 바로 카메라가 열리고,
// 없는 input 은 "사진 보관함 / 사진 찍기 / 파일 선택" 시트가 뜬다.
export default function PhotoUploader({ sessionId, onError }: { sessionId: string; onError: (m: string) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [shrink, setShrink] = useState(readShrinkPref)

  const toggleShrink = (v: boolean) => {
    setShrink(v)
    try {
      localStorage.setItem(SHRINK_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const onFiles = async (ev: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(ev.target.files ?? [])
    ev.target.value = '' // 같은 파일 다시 선택 가능하도록
    if (files.length === 0) return
    setUploading((n) => n + files.length)
    for (const f of files) {
      try {
        await api.uploadPhoto(sessionId, shrink ? await shrinkImage(f) : f)
      } catch (e) {
        onError(`업로드 실패 (${f.name}): ${(e as Error).message}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  return (
    <div className="uploader-wrap">
      <div className="uploader">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
        <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
        <button className="primary big" onClick={() => cameraRef.current?.click()} disabled={uploading > 0}>
          📷 메뉴판 촬영
        </button>
        <button className="big" onClick={() => libraryRef.current?.click()} disabled={uploading > 0}>
          🖼 사진첩에서 선택
        </button>
      </div>
      <div className="uploader-opts">
        <label className="check">
          <input type="checkbox" checked={shrink} onChange={(e) => toggleShrink(e.target.checked)} />
          <span>업로드 전 사진 축소</span>
        </label>
        <span className="muted small">
          {uploading > 0 ? `업로드 중 ${uploading}장…` : shrink ? '빠르게 올라갑니다 (긴 변 2000px)' : '원본 그대로 올립니다 (느릴 수 있음)'}
        </span>
      </div>
    </div>
  )
}
