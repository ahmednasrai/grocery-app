const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function buildUrl(path) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function request(path, options = {}) {
  const response = await fetch(buildUrl(path), {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Request failed');
  }

  return response.json();
}

export async function fetchProducts() {
  return request('/api/products');
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

export async function scanImage(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(buildUrl('/api/scan'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Scan failed');
  }

  return response.json();
}
