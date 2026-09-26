import { buildConversion, buildProviderConversion, CONVERSION_PROVIDERS, resolveConsentState } from './conversion-consent-policy.mjs';

export class CommercialConversionService {
  constructor({ persist, enqueueConversion, adapters = {}, technicalEnabled = () => true } = {}) {
    if (typeof persist !== 'function' || typeof enqueueConversion !== 'function') throw new Error('Persistência comercial obrigatória.');
    this.persist = persist;
    this.enqueueConversion = enqueueConversion;
    this.adapters = adapters;
    this.technicalEnabled = technicalEnabled;
  }

  async deliver({ manifest, storedConsent, browserEvent, serverAnswers, enabledProviders = [] } = {}) {
    const consentState = resolveConsentState({ manifest, storedConsent });
    const conversao = buildConversion({ manifest, consentState, browserEvent, serverAnswers });
    await this.persist(conversao);
    await this.enqueueConversion(conversao);
    const enabled = new Set(enabledProviders);
    const delivered = []; const blocked = [];
    for (const provider of CONVERSION_PROVIDERS) {
      if (!this.technicalEnabled(provider)) { blocked.push(`${provider}:technical_disabled`); continue; }
      if (!enabled.has(provider) || typeof this.adapters[provider] !== 'function') { blocked.push(`${provider}:provider_disabled`); continue; }
      const payload = buildProviderConversion({ provider, manifest, consentState, browserEvent, serverAnswers });
      await this.adapters[provider](payload);
      delivered.push(provider);
    }
    return { consentState, trackingEventId: conversao.tracking_event_id, delivered, blocked };
  }
}
