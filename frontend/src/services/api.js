const API_BASE_URL = 'http://localhost:8000';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
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

  const response = await fetch(`${API_BASE_URL}/api/scan`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Scan failed');
  }

  return response.json();
}
