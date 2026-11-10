import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, AppSettings } from '../api'
import { useEventBus } from '../App'

const price = (v: number | null) => (v === null ? '?' : `$${v.toFixed(2)}`)

export default function SettingsPage() {
  const [data, setData] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')
  const { subscribe, offline } = useEventBus()

  const load = useCallback(async () => {
    try {
      setData(await api.settings())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // 다른 사람이 설정을 바꾸면 이 화면에도 바로 반영한다
  useEffect(() => {
    void load()
    return subscribe((e) => {
      if (e.type === 'settings.changed' || e.type === 'resync') void load()
    })
  }, [load, subscribe])

  const choose = async (id: string) => {
    if (!data || id === data.model || saving) return
    setSaving(id)
    try {
      setData(await api.updateSettings({ model: id }))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving('')
    }
  }

  return (
    <>
      <div className="settings-head">
        <h1>설정</h1>
        <Link to="/" className="chip-link">
          세션 목록
        </Link>
      </div>

      {error && <p className="error">{error}</p>}
      {data === null && !error && <p className="muted">불러오는 중…</p>}

      {data && (
        <section className="card settings-card">
          <h2>번역 모델</h2>
          <p className="muted small">
            메뉴판을 읽고 번역할 AI 모델입니다. 접속한 모두에게 같이 적용되며, 바꾼 뒤에 분석하는 사진부터 쓰입니다.
          </p>
          {data.engine === 'fake' && (
            <p className="small settings-warn">지금은 데모 엔진으로 실행 중이라 선택한 모델이 실제 분석에 쓰이지 않습니다.</p>
          )}
          <div className="model-list" role="radiogroup" aria-label="번역 모델">
            {data.models.map((m) => {
              const selected = m.id === data.model
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`model-option${selected ? ' selected' : ''}`}
                  disabled={offline || (saving !== '' && saving !== m.id)}
                  onClick={() => void choose(m.id)}
                >
                  <span className="model-radio" aria-hidden />
                  <span className="model-text">
                    <span className="model-name">
                      {m.label}
                      {m.id === data.default_model && <span className="chip">기본값</span>}
                    </span>
                    <span className="muted small">{m.hint}</span>
                    <span className="muted small">
                      100만 토큰당 입력 {price(m.input_usd_per_mtok)} · 출력 {price(m.output_usd_per_mtok)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="muted small">
            이미 번역된 메뉴는 그대로입니다. 새 모델로 다시 번역하려면 세션의 "메뉴판 다시 불러오기" 를 누르세요.
          </p>
        </section>
      )}
    </>
  )
}
