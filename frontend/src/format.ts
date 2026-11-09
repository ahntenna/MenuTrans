export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
