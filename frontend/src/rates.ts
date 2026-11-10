// 원화 환산. 환율은 서버가 하루 한 번(그날 첫 요청 때) 받아 둔 값을 쓴다.
import { useEffect, useState } from 'react'
import { api, Rates } from './api'

let cached: Rates | null = null
let pending: Promise<Rates | null> | null = null

function loadRates(): Promise<Rates | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = api
      .rates()
      .then((r) => {
        cached = r
        return r
      })
      .catch(() => null)
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export function useRates(): Rates | null {
  const [rates, setRates] = useState<Rates | null>(cached)
  useEffect(() => {
    let alive = true
    void loadRates().then((r) => {
      if (alive && r) setRates(r)
    })
    return () => {
      alive = false
    }
  }, [])
  return rates
}

/** 외화 금액 → 원화. 통화를 모르거나 이미 원화면 null */
export function toKrw(value: number | null, currency: string, rates: Rates | null): number | null {
  if (value === null || !rates || !currency || currency === 'KRW') return null
  const rate = rates.krw_per_unit[currency]
  return rate ? value * rate : null
}

/** "≈ ₩12,300" (10원 단위 반올림) */
export function formatKrw(krw: number | null): string {
  if (krw === null) return ''
  return `≈ ₩${(Math.round(krw / 10) * 10).toLocaleString('ko-KR')}`
}

export function formatUsd(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`
}
