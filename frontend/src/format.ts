export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 방문 일시 표시: "2026년 11월 9일 (일) 오후 7:30" */
export function formatVisit(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatMoney(value: number | null, currency: string): string {
  if (value === null || Number.isNaN(value)) return ''
  try {
    if (currency) return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(value)
  } catch {
    /* 알 수 없는 통화 코드 */
  }
  return value.toLocaleString('ko-KR')
}

/** ISO(UTC) → <input type="datetime-local"> 값 (현지 시간, 'YYYY-MM-DDTHH:mm') */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local 값(현지 시간) → ISO(UTC). 비어 있으면 null */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value) // 로컬 타임존으로 해석됨
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 구글 맵 링크: 직접 입력한 링크 > 좌표 > 상호명/주소 검색 순 */
export function googleMapsUrl(s: { map_url: string; lat: number | null; lng: number | null; store_name: string; address: string; name: string }): string | null {
  if (s.map_url) return s.map_url
  if (s.lat !== null && s.lng !== null) return `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
  const q = [s.store_name || s.name, s.address].filter(Boolean).join(' ').trim()
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}
