import { resolveConsentState } from './conversion-consent-policy.mjs';
import { runtimeManifest } from './runtime-gateway-security.mjs';

const ACTIONS = Object.freeze({ grant: 'granted', deny: 'denied', revoke: 'denied' });

export class RuntimeConsentGateway {
  constructor({ repository } = {}) {
    if (!repository || typeof repository.currentForOrigin !== 'function' || typeof repository.currentConsent !== 'function' || typeof repository.recordConsent !== 'function') throw new Error('Repositório de consentimento obrigatório.');
    this.repository = repository;
  }

  async handle({ method, publicationId, origin, subjectId, body = {} } = {}) {
    const row = await this.repository.currentForOrigin({ publicationId, origin });
    const manifest = row?.publicationId ? row : runtimeManifest(row);
    if (!manifest) return { state: 'pending' };
    const storedConsent = await this.repository.currentConsent({ manifest, subjectId });
    if (method === 'GET') return { state: resolveConsentState({ manifest, storedConsent }) };
    if (method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(ACTIONS, body.action)) throw Object.assign(new Error('Ação de consentimento inválida.'), { status: 400 });
    const state = ACTIONS[body.action];
    await this.repository.recordConsent({ manifest, subjectId, state });
    return { state };
  }
}
