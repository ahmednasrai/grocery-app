import { supabase } from './supabaseClient'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  ''

function buildUrl(path) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function resolveMediaUrl(url) {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url
  }
  return buildUrl(url)
}

async function authHeaders(extra = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

async function parseResponse(response) {
  if (response.status === 204) {
    return { success: true }
  }

  const text = await response.text()
  if (!text || !text.trim()) {
    return { success: true }
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON response from server')
  }
}

// GET deduplication: concurrent identical reads share one in-flight promise,
// and optional short TTL caching stops the dashboard polling loop from
// hammering the API with unchanged data every 20s.
const inFlight = new Map() // 'GET path' -> Promise
const memCache = new Map() // 'GET path' -> { expiresAt, value }
const keyFor = (method, path) => `${method} ${path}`

function invalidateCache(path) {
  const key = keyFor('GET', path)
  memCache.delete(key)
  inFlight.delete(key)
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const ttl = options.cacheTtl || 0
  const key = keyFor(method, path)

  if (method === 'GET') {
    const hit = memCache.get(key)
    if (hit && Date.now() < hit.expiresAt) return hit.value
    if (inFlight.has(key)) return inFlight.get(key)
  }

  const run = (async () => {
    const headers = await authHeaders(options.headers)
    const response = await fetch(buildUrl(path), {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      const detail = error.detail;
      const message = Array.isArray(detail)
        ? detail.map((item) => item.msg || item.message || JSON.stringify(item)).join(', ')
        : detail || error.message || 'Request failed'
      throw new Error(message)
    }

    const data = await parseResponse(response)
    if (method === 'GET' && ttl > 0) {
      memCache.set(key, { expiresAt: Date.now() + ttl, value: data })
    }
    return data
  })()

  if (method === 'GET') {
    inFlight.set(key, run)
    const release = () => { if (inFlight.get(key) === run) inFlight.delete(key) }
    run.then(release, release)
  }
  return run
}

const PRODUCTS_TTL = 20000

export async function fetchProducts() {
  const data = await request('/api/products', { cacheTtl: PRODUCTS_TTL })
  return Array.isArray(data) ? data : (data?.data || [])
}

export async function createProduct(product) {
  const result = await request('/api/products', {
    method: 'POST',
    body: JSON.stringify(product),
  })
  invalidateCache('/api/products')
  return result
}

export async function updateProduct(productId, fields) {
  const result = await request(`/api/products/${productId}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
  invalidateCache('/api/products')
  return result
}

export async function deleteProduct(productId) {
  const result = await request(`/api/products/${productId}`, {
    method: 'DELETE',
  })
  invalidateCache('/api/products')
  return result
}

export async function fetchSales({ from, to, limit } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (limit) params.set('limit', limit)
  const qs = params.toString()
  const data = await request(`/api/sales${qs ? `?${qs}` : ''}`)
  return Array.isArray(data) ? data : (data?.data || [])
}

export async function fetchSaleDetail(saleId) {
  const data = await request(`/api/sales/${saleId}`)
  return data
}

export async function createSaleReturn(saleId, payload) {
  const result = await request(`/api/sales/${saleId}/return`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  invalidateCache('/api/products')
  return result
}

export async function receiveStock(productId, { qty, unit }) {
  const result = await request(`/api/products/${productId}/receive-stock`, {
    method: 'POST',
    body: JSON.stringify({ qty, unit }),
  })
  invalidateCache('/api/products')
  return result
}

export async function adjustStock(productId, { operation, qty, unit }) {
  const result = await request(`/api/products/${productId}/adjust-stock`, {
    method: 'POST',
    body: JSON.stringify({ operation, qty, unit }),
  })
  invalidateCache('/api/products')
  return result
}

export async function fetchEmployeeSalesSummary({ from, to } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  const data = await request(`/api/sales/employee-summary${qs ? `?${qs}` : ''}`)
  return data || { total_amount: 0, invoice_count: 0, units_sold: 0, employees: [] }
}

export async function fetchEmployeeSalesDetail(employeeName, { from, to } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  const data = await request(`/api/sales/employees/${encodeURIComponent(employeeName)}${qs ? `?${qs}` : ''}`)
  return data
}

export async function createSale(salePayload) {
  const result = await request('/api/sales', {
    method: 'POST',
    body: JSON.stringify(salePayload),
  })
  invalidateCache('/api/products')
  return result
}

export async function uploadProductImage(file) {
  const formData = new FormData();
  formData.append('file', file);

  const headers = {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(buildUrl('/api/products/upload-image'), {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Upload failed');
  }

  const result = await parseResponse(response);
  invalidateCache('/api/products');
  return result;
}

export async function getMe() {
  return request('/api/auth/me')
}

export async function fetchUsers() {
  const data = await request('/api/users')
  return Array.isArray(data) ? data : []
}

export async function createUser(user) {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify(user),
  })
}

export async function updateUser(userId, fields) {
  return request(`/api/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
}

export { buildUrl, resolveMediaUrl };