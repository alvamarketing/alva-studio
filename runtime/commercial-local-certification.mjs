export const LOCAL_CERTIFICATION_STAGES = Object.freeze([
  'creation',
  'provisioning_fake',
  'publication_fake',
  'visit_and_lead',
  'conversion_fake',
  'billing_fake',
  'mcp',
  'tenant_isolation',
  'publication_rollback',
]);

export const LOCAL_SECRET_INVENTORY = Object.freeze([
  Object.freeze({ name: 'STUDIO_DATABASE_URL', location: 'ambiente do runtime', purpose: 'PostgreSQL do Studio' }),
  Object.freeze({ name: 'STUDIO_POSTGRES_PASSWORD', location: 'ambiente do runtime', purpose: 'PostgreSQL do Studio' }),
  Object.freeze({ name: 'UMAMI_POSTGRES_PASSWORD', location: 'ambiente do runtime', purpose: 'PostgreSQL do Umami' }),
  Object.freeze({ name: 'UMAMI_APP_SECRET', location: 'ambiente do runtime', purpose: 'sessão do Umami' }),
  Object.freeze({ name: 'UMAMI_USERNAME', location: 'ambiente do runtime', purpose: 'conta técnica do Umami' }),
  Object.freeze({ name: 'UMAMI_PASSWORD', location: 'ambiente do runtime', purpose: 'conta técnica do Umami' }),
  Object.freeze({ name: 'NVS_MARIADB_PASSWORD', location: 'ambiente do runtime', purpose: 'MariaDB do NVS' }),
  Object.freeze({ name: 'TRACKING_MASTER_KEY', location: 'ambiente do runtime', purpose: 'cofre de tracking' }),
  Object.freeze({ name: 'NVS_INTERNAL_HMAC_SECRET', location: 'ambiente do runtime', purpose: 'HMAC interno NVS' }),
  Object.freeze({ name: 'VERCEL_MASTER_KEY', location: 'ambiente do Studio', purpose: 'cofre de publicação' }),
  Object.freeze({ name: 'PUBLICATION_RUNTIME_HMAC_SECRET', location: 'ambiente do Studio', purpose: 'gateway de publicação' }),
  Object.freeze({ name: 'ASAAS_SANDBOX_API_KEY', location: 'cofre sandbox', purpose: 'checkout e reconciliação sandbox' }),
  Object.freeze({ name: 'ASAAS_SANDBOX_WEBHOOK_TOKEN', location: 'cofre sandbox', purpose: 'autenticação do webhook sandbox' }),
  Object.freeze({ name: 'ASAAS_PRODUCTION_API_KEY', location: 'cofre produção', purpose: 'checkout e reconciliação produção' }),
  Object.freeze({ name: 'ASAAS_PRODUCTION_WEBHOOK_TOKEN', location: 'cofre produção', purpose: 'autenticação do webhook produção' }),
]);

const REQUIRED_OFF_FLAGS = Object.freeze([
  'UMAMI_RUNTIME_ENABLED',
  'NVS_RUNTIME_ENABLED',
  'PIXELS_ENABLED',
  'MEDIA_PIPELINE_ENABLED',
  'BILLING_ENFORCEMENT',
]);

function assertSafeLocalEnvironment(environment = {}) {
  for (const name of REQUIRED_OFF_FLAGS) {
    if (environment[name] === 'true' || environment[name] === true)
      throw new Error(`A certificação local exige ${name} desligada.`);
  }
}

export function runLocalCommercialCertification({ environment = {}, steps } = {}) {
  assertSafeLocalEnvironment(environment);
  if (!steps || typeof steps !== 'object') throw new Error('Matriz local obrigatória.');
  for (const stage of LOCAL_CERTIFICATION_STAGES) {
    if (typeof steps[stage] !== 'function') throw new Error(`Etapa local ausente: ${stage}.`);
  }
  return (async () => {
    const results = [];
    for (const stage of LOCAL_CERTIFICATION_STAGES) {
      const result = await steps[stage]();
      results.push({ stage, ...(result && typeof result === 'object' ? result : {}) });
    }
    return results;
  })();
}
