import { createHmac, randomBytes } from 'node:crypto';

function unavailable(service) { return new Error(`${service} indisponível para provisionamento.`); }
async function json(response) {
  if (Number(response.headers?.get?.('content-length') || 0) > 16 * 1024) throw unavailable('Resposta do motor');
  try { return await response.json(); } catch { return {}; }
}

export class UmamiClient {
  constructor({ baseUrl = process.env.UMAMI_INTERNAL_URL, username = process.env.UMAMI_USERNAME, password = process.env.UMAMI_PASSWORD, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
    this.baseUrl = baseUrl?.replace(/\/$/, ''); this.username = username; this.password = password; this.fetch = fetchImpl; this.token = null; this.timeoutMs = timeoutMs;
  }
  async #token() {
    if (this.token) return this.token;
    if (!this.baseUrl || !this.username || !this.password) throw unavailable('Umami');
    const response = await this.fetch(`${this.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: this.username, password: this.password }), signal: AbortSignal.timeout(this.timeoutMs) });
    const payload = await json(response); if (!response.ok || typeof payload.token !== 'string') throw unavailable('Umami');
    this.token = payload.token; return this.token;
  }
  async provision({ bindingId, projectName, projectSlug, environment }) {
    const request = async (path, init = {}, retry = true) => {
      const token = await this.#token();
      const response = await this.fetch(`${this.baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status === 401 && retry) { this.token = null; return request(path, init, false); }
      return response;
    };
    const body = { id: bindingId, name: `${projectName} (${environment})`, domain: `${environment}-${projectSlug}.tracking.internal` };
    let response = await request('/api/websites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) response = await request(`/api/websites/${encodeURIComponent(bindingId)}`);
    const payload = await json(response);
    if (!response.ok || payload.id !== bindingId || payload.name !== body.name || payload.domain !== body.domain) throw unavailable('Umami');
    return { remoteId: bindingId };
  }
}

export class NvsClient {
  constructor({ baseUrl = process.env.NVS_INTERNAL_URL, secret = process.env.NVS_INTERNAL_HMAC_SECRET, fetchImpl = fetch, now = () => Date.now(), timeoutMs = 5000 } = {}) { this.baseUrl = baseUrl?.replace(/\/$/, ''); this.secret = secret; this.fetch = fetchImpl; this.now = now; this.timeoutMs = timeoutMs; }
  async provision({ propertyId, projectName, environment, destinations }) {
    if (!this.baseUrl || !this.secret) throw unavailable('NVS');
    const body = JSON.stringify({ property_id: propertyId, name: `${projectName} (${environment})`, destinations: destinations || {} });
    const timestamp = String(Math.floor(this.now() / 1000)); const nonce = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', this.secret).update(`${timestamp}\n${nonce}\n${body}`).digest('hex');
    const response = await this.fetch(`${this.baseUrl}/internal/v1/properties`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NVS-Timestamp': timestamp, 'X-NVS-Nonce': nonce, 'X-NVS-Signature': signature }, body, signal: AbortSignal.timeout(this.timeoutMs) });
    const payload = await json(response);
    if (!response.ok || payload?.property?.property_id !== propertyId) throw unavailable('NVS');
    return { remoteId: propertyId };
  }
}
