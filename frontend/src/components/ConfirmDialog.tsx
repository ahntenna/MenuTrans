// 브라우저 기본 confirm/alert 대신 쓰는 앱 디자인의 메시지 상자.
// 어디서든 `await confirmDialog({...})` 로 부르고, 화면에는 App 에 한 번 올려 둔 <DialogHost /> 가 그린다.
import { useEffect, useRef, useState } from 'react'
import { TrashIcon } from './icons'

export interface DialogOptions {
  title: string
  /** 보조 설명. 줄바꿈(\n)은 그대로 표시된다 */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 삭제처럼 되돌릴 수 없는 동작: 확인 버튼을 위험색으로 */
  danger?: boolean
}

interface Request extends DialogOptions {
  kind: 'confirm' | 'alert'
  resolve: (ok: boolean) => void
}

let show: ((req: Request) => void) | null = null

function open(kind: Request['kind'], opts: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) show({ ...opts, kind, resolve })
    else resolve(kind === 'alert' ? true : window.confirm([opts.title, opts.message].filter(Boolean).join('\n'))) // 호스트가 없을 때의 대비
  })
}

/** 확인을 누르면 true, 취소·바깥 누름·Esc 는 false */
export const confirmDialog = (opts: DialogOptions) => open('confirm', opts)
/** 확인 버튼 하나만 있는 안내 */
export const alertDialog = (opts: DialogOptions) => open('alert', opts).then(() => undefined)

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null)
  const current = useRef<Request | null>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const cancelBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    show = (next) => {
      current.current?.resolve(false) // 이미 떠 있던 것은 취소로 닫는다
      current.current = next
      setReq(next)
    }
    return () => {
      show = null
      current.current?.resolve(false)
      current.current = null
    }
  }, [])

  const close = (ok: boolean) => {
    current.current?.resolve(ok)
    current.current = null
    setReq(null)
  }

  useEffect(() => {
    if (!req) return
    const before = document.activeElement as HTMLElement | null
    // 위험한 동작은 실수로 Enter 를 눌러도 실행되지 않도록 취소에 초점을 둔다
    ;(req.danger && req.kind === 'confirm' ? cancelBtn : confirmBtn).current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      before?.focus?.()
    }
  }, [req])

  if (!req) return null
  return (
    <div className="modal confirm-layer" onClick={() => close(false)}>
      <div
        className="confirm-box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={req.message ? 'confirm-message' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {req.danger && (
          <div className="confirm-icon" aria-hidden>
            <TrashIcon />
          </div>
        )}
        <h2 id="confirm-title">{req.title}</h2>
        {req.message && (
          <p id="confirm-message" className="muted">
            {req.message}
          </p>
        )}
        <div className="confirm-actions">
          {req.kind === 'confirm' && (
            <button type="button" ref={cancelBtn} onClick={() => close(false)}>
              {req.cancelLabel ?? '취소'}
            </button>
          )}
          <button type="button" ref={confirmBtn} className={req.danger ? 'danger-fill' : 'primary'} onClick={() => close(true)}>
            {req.confirmLabel ?? '확인'}
          </button>
        </div>
      </div>
    </div>
  )
}
