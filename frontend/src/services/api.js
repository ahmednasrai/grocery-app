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

async function request(path, options = {}) {
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

  return parseResponse(response)
}

export async function fetchProducts() {
  const data = await request('/api/products')
  return Array.isArray(data) ? data : (data?.data || [])
}

export async function createProduct(product) {
  return request('/api/products', {
    method: 'POST',
    body: JSON.stringify(product),
  })
}

export async function updateProduct(productId, fields) {
  return request(`/api/products/${productId}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
}

export async function deleteProduct(productId) {
  return request(`/api/products/${productId}`, {
    method: 'DELETE',
  })
}

export async function fetchSales() {
  const data = await request('/api/sales')
  return Array.isArray(data) ? data : (data?.data || [])
}

export async function createSale(salePayload) {
  return request('/api/sales', {
    method: 'POST',
    body: JSON.stringify(salePayload),
  })
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

  return parseResponse(response);
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