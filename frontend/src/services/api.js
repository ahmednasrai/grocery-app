const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  '';

function buildUrl(path) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function resolveMediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url;
  }
  return buildUrl(url);
}

async function parseResponse(response) {
  if (response.status === 204) {
    return { success: true };
  }

  const text = await response.text();
  if (!text || !text.trim()) {
    return { success: true };
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON response from server');
  }
}

async function request(path, options = {}) {
  const response = await fetch(buildUrl(path), {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const detail = error.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg || item.message || JSON.stringify(item)).join(', ')
      : detail || error.message || 'Request failed';
    throw new Error(message);
  }

  return parseResponse(response);
}

export async function fetchProducts() {
  const data = await request('/api/products');
  return Array.isArray(data) ? data : (data?.data || []);
}

export async function createProduct(product) {
  return request('/api/products', {
    method: 'POST',
    body: JSON.stringify(product),
  });
}

export async function deleteProduct(productId) {
  return request(`/api/products/${productId}`, {
    method: 'DELETE',
  });
}

export async function createSale(salePayload) {
  return request('/api/sales', {
    method: 'POST',
    body: JSON.stringify(salePayload),
  });
}

export async function uploadProductImage(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(buildUrl('/api/products/upload-image'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Upload failed');
  }

  return parseResponse(response);
}

export async function scanImage(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(buildUrl('/api/scan'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Scan failed');
  }

  return parseResponse(response);
}

export async function identifyProduct(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(buildUrl('/api/scan/identify'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Identify failed');
  }

  return parseResponse(response);
}

export { buildUrl, resolveMediaUrl };
