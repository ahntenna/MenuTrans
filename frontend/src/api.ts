// 백엔드 API 타입과 호출 함수

export interface MenuItem {
  id: string
  photo_id: string
  session_id: string
  position: number
  category: string
  original_name: string
  translated_name: string
  description: string
  price_text: string
  price_value: number | null
  tags: string[]
  /** 사진 속 위치 [x0, y0, x1, y1], 0~1000 정규화 (대략적인 값). 없으면 null */
  bbox: number[] | null
}

export interface MenuItemPatch {
  category?: string
  original_name?: string
  translated_name?: string
  description?: string
  price_text?: string
  tags?: string[]
}

export type PhotoStatus = 'pending' | 'processing' | 'done' | 'error'

export interface Photo {
  id: string
  session_id: string
  original_name: string
  content_type: string
  size_bytes: number
  status: PhotoStatus
  error: string
  detected_language: string
  currency: string
  restaurant_hint: string
  /** 모델이 먼저 보고한 예상 항목 수 (완료 후에는 실제 개수). 0 이면 아직 모름 */
  progress_total: number
  /** 마지막 분석의 사용량 */
  engine_model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number | null
  created_at: string
  started_at: string | null
  analyzed_at: string | null
  items: MenuItem[]
}

export interface Order {
  id: string
  session_id: string
  menu_item_id: string | null
  name_snapshot: string
  /** 원어 메뉴명 (예전 주문은 빈 문자열일 수 있음 → name_snapshot 으로 대체 표시) */
  original_name: string
  translated_name: string
  price_snapshot: string
  price_value: number | null
  quantity: number
  note: string
  created_at: string
}

export interface UsageSummary {
  calls: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface UsageReport {
  total: UsageSummary
  this_month: UsageSummary
  by_model: { model: string; calls: number; cost_usd: number }[]
}

export interface Rates {
  date: string
  fetched_at: string
  source: string
  stale: boolean
  /** 외화 1단위당 원화 */
  krw_per_unit: Record<string, number>
}

export interface SessionBase {
  id: string
  name: string
  note: string
  /** 가게 정보 */
  store_name: string
  address: string
  map_url: string
  lat: number | null
  lng: number | null
  /** 방문 일시 (선택, ISO UTC) */
  visited_at: string | null
  created_at: string
  updated_at: string
}

export interface SessionSummary extends SessionBase {
  photo_count: number
  item_count: number
  order_count: number
  pending_count: number
}

export interface SessionDetail extends SessionBase {
  photos: Photo[]
  orders: Order[]
  usage: UsageSummary
}

export interface SessionPatch {
  name?: string
  note?: string
  store_name?: string
  address?: string
  map_url?: string
  lat?: number
  lng?: number
  visited_at?: string
  clear_location?: boolean
  clear_visited_at?: boolean
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 인증이 풀렸을 때(401) App 이 로그인 화면으로 돌아가도록 알리는 이벤트 이름 */
export const UNAUTHORIZED_EVENT = 'mt:unauthorized'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. (오프라인)')
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/login')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    let detail = res.statusText
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg).replace(/^Value error, /, '')
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  authStatus: () => request<{ required: boolean; authenticated: boolean }>('/api/auth', { cache: 'no-store' }),
  login: (password: string) => request<{ ok: boolean }>('/api/login', json('POST', { password })),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  listSessions: (q = '') => request<SessionSummary[]>(q ? `/api/sessions?q=${encodeURIComponent(q)}` : '/api/sessions'),
  createSession: (name: string, note = '') => request<SessionDetail>('/api/sessions', json('POST', { name, note })),
  getSession: (id: string) => request<SessionDetail>(`/api/sessions/${id}`),
  updateSession: (id: string, patch: SessionPatch) => request<SessionDetail>(`/api/sessions/${id}`, json('PATCH', patch)),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  /** 메뉴판 다시 불러오기: 추출된 메뉴를 지우고 모든 사진을 다시 분석 */
  reanalyzeSession: (id: string) => request<SessionDetail>(`/api/sessions/${id}/reanalyze`, { method: 'POST' }),
  exportUrl: (id: string, format: 'md' | 'json') => `/api/sessions/${id}/export?format=${format}`,
  exportText: async (id: string) => {
    const res = await fetch(`/api/sessions/${id}/export?format=md`)
    if (!res.ok) throw new ApiError(res.status, '내보내기에 실패했습니다.')
    return res.text()
  },

  updateMenuItem: (itemId: string, patch: MenuItemPatch) =>
    request<MenuItem>(`/api/menu-items/${itemId}`, json('PATCH', patch)),
  deleteMenuItem: (itemId: string) => request<void>(`/api/menu-items/${itemId}`, { method: 'DELETE' }),

  uploadPhoto: (sessionId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file, file.name || 'photo.jpg')
    return request<Photo>(`/api/sessions/${sessionId}/photos`, { method: 'POST', body: fd })
  },
  retryPhoto: (photoId: string) => request<Photo>(`/api/photos/${photoId}/retry`, { method: 'POST' }),
  deletePhoto: (photoId: string) => request<void>(`/api/photos/${photoId}`, { method: 'DELETE' }),
  photoUrl: (photoId: string) => `/api/photos/${photoId}/file`,
  thumbUrl: (photoId: string) => `/api/photos/${photoId}/thumb`,

  createOrder: (
    sessionId: string,
    body: { menu_item_id?: string; name?: string; price_text?: string; quantity?: number; note?: string },
  ) => request<Order>(`/api/sessions/${sessionId}/orders`, json('POST', body)),
  updateOrder: (orderId: string, patch: { quantity?: number; note?: string }) =>
    request<Order>(`/api/orders/${orderId}`, json('PATCH', patch)),
  deleteOrder: (orderId: string) => request<void>(`/api/orders/${orderId}`, { method: 'DELETE' }),

  rates: () => request<Rates>('/api/rates'),
  usage: () => request<UsageReport>('/api/usage'),
}
