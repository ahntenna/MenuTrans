import { ChangeEvent, useRef, useState } from 'react'
import { api } from '../api'

// iOS Safari: capture="environment" 를 주면 바로 카메라가 열리고,
// 없는 input 은 "사진 보관함 / 사진 찍기 / 파일 선택" 시트가 뜬다.
export default function PhotoUploader({ sessionId, onError }: { sessionId: string; onError: (m: string) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)

  const onFiles = async (ev: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(ev.target.files ?? [])
    ev.target.value = '' // 같은 파일 다시 선택 가능하도록
    if (files.length === 0) return
    setUploading((n) => n + files.length)
    for (const f of files) {
      try {
        await api.uploadPhoto(sessionId, f)
      } catch (e) {
        onError(`업로드 실패 (${f.name}): ${(e as Error).message}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  return (
    <div className="uploader">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
      <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      <button className="primary big" onClick={() => cameraRef.current?.click()} disabled={uploading > 0}>
        📷 메뉴판 촬영
      </button>
      <button className="big" onClick={() => libraryRef.current?.click()} disabled={uploading > 0}>
        🖼 사진첩에서 선택
      </button>
      {uploading > 0 && <span className="muted small">업로드 중 {uploading}장…</span>}
    </div>
  )
}
