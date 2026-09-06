import { createHash } from 'node:crypto';
import { withTransaction } from '../db/postgres.mjs';
import { PIXEL_PROVIDERS, validatePixelConfiguration } from '../pixel-registry.mjs';

const PROVIDERS = Object.keys(PIXEL_PROVIDERS);

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { status: statusCode, statusCode });
}

function policyUrl(value) {
  const text = String(value ?? '').trim();
  let url;
  try { url = new URL(text); } catch { throw fail('A política de privacidade precisa usar HTTPS.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw fail('A política de privacidade precisa usar HTTPS.');
  return text;
}

function policyVersion(value) {
  const text = String(value ?? '').trim();
  if (!text) throw fail('A versão da política é obrigatória.');
  return text;
}

function tokenHash(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) throw fail('Token de consentimento inválido.');
  return createHash('sha256').update(value).digest('hex');
}

function publicationId(value) {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(text)) throw fail('Publicação inválida.');
  return text;
}

function publicationEnvironment(value) {
  if (value !== 'production' && value !== 'preview') throw fail('Ambiente da publicação inválido.');
  return value;
}

function snapshotHash(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) throw fail('Snapshot da publicação inválido.');
  return text;
}

function policyRecord(row) {
  return row ? {
    privacyPolicyUrl: row.privacy_policy_url,
    policyVersion: row.policy_version,
    consentExpiryDays: row.consent_expiry_days,
  } : null;
}

function persistedConfiguration(provider, value) {
  try { return validatePixelConfiguration(provider, value); }
  catch { return { enabled: false, identifier: null }; }
}

async function currentPolicy(client, { companyId, projectId, lock = false }) {
  const { rows } = await client.query(
    `SELECT privacy_policy_url, policy_version, consent_expiry_days
       FROM project_tracking_policies
      WHERE company_id = $1 AND project_id = $2 AND environment = 'production'${lock ? ' FOR UPDATE' : ''}`,
    [companyId, projectId],
  );
  return rows[0] ?? null;
}

async function scopedWebsite(client, { companyId, projectId, websiteId }) {
  const { rows } = await client.query(
    `SELECT id FROM analytics_websites
      WHERE id = $1 AND company_id = $2 AND project_id = $3 AND environment = 'production'`,
    [websiteId, companyId, projectId],
  );
  if (!rows.length) throw fail('Site de analytics não encontrado.', 404);
}

async function activePublication(client, { publicationId: publicId, environment, snapshotHash: hash }) {
  const publication = publicationId(publicId);
  const publicationEnvironmentValue = publicationEnvironment(environment);
  const snapshot = snapshotHash(hash);
  const { rows } = await client.query(
    `SELECT reservation.id AS reservation_id, reservation.company_id, reservation.project_id, website.id AS website_id
       FROM publication_build_reservations reservation
       JOIN deployment_runs run
         ON run.id = reservation.deployment_run_id
        AND run.company_id = reservation.company_id
        AND run.project_id = reservation.project_id
        AND run.environment = reservation.environment
       JOIN publication_tracking_artifacts artifact
         ON artifact.reservation_id = reservation.id
        AND artifact.deployment_run_id = run.id
        AND artifact.snapshot_hash = run.snapshot_hash
       JOIN analytics_websites website
         ON website.company_id = reservation.company_id
        AND website.project_id = reservation.project_id
        AND website.environment = reservation.environment
      WHERE reservation.public_id = $1
        AND reservation.environment = $2
        AND reservation.state = 'claimed'
        AND reservation.expires_at > now()
        AND run.status = 'READY'
        AND run.snapshot_hash = $3
        AND artifact.snapshot_hash = $3
        AND artifact.status IN ('ready', 'safe')`,
    [publication, publicationEnvironmentValue, snapshot],
  );
  if (!rows[0]) throw fail('Publicação ativa não encontrada.', 404);
  return {
    reservationId: rows[0].reservation_id,
    companyId: rows[0].company_id,
    projectId: rows[0].project_id,
    websiteId: rows[0].website_id,
    publicationId: publication,
    environment: publicationEnvironmentValue,
    snapshotHash: snapshot,
  };
}

export class PixelRepository {
  constructor(database) { this.database = database; }

  async savePolicy({ companyId, projectId, privacyPolicyUrl, policyVersion: version }) {
    const url = policyUrl(privacyPolicyUrl);
    const currentVersion = policyVersion(version);
    return withTransaction(this.database, async (client) => {
      const previous = await currentPolicy(client, { companyId, projectId, lock: true });
      const { rows } = await client.query(
        `INSERT INTO project_tracking_policies
           (company_id, project_id, environment, privacy_policy_url, policy_version, consent_expiry_days, updated_at)
         VALUES ($1, $2, 'production', $3, $4, 365, now())
         ON CONFLICT (company_id, project_id, environment)
         DO UPDATE SET privacy_policy_url = EXCLUDED.privacy_policy_url, policy_version = EXCLUDED.policy_version,
                       consent_expiry_days = 365, updated_at = now()
         RETURNING privacy_policy_url, policy_version, consent_expiry_days`,
        [companyId, projectId, url, currentVersion],
      );
      if (previous && (previous.privacy_policy_url !== url || previous.policy_version !== currentVersion)) {
        await client.query(
          `UPDATE analytics_consents SET revoked_at = now()
            WHERE company_id = $1 AND project_id = $2 AND revoked_at IS NULL`,
          [companyId, projectId],
        );
      }
      return policyRecord(rows[0]);
    });
  }

  async policy({ companyId, projectId }) {
    return policyRecord(await currentPolicy(this.database, { companyId, projectId }));
  }

  async resolveActivePublication(input) {
    return activePublication(this.database, input);
  }

  async list({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT provider, configuration
         FROM project_integrations
        WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND provider = ANY($3::text[])`,
      [companyId, projectId, PROVIDERS],
    );
    const configured = new Map(rows.map((row) => [row.provider, row.configuration]));
    return PROVIDERS.map((provider) => ({ provider, ...persistedConfiguration(provider, configured.get(provider)) }));
  }

  async saveProvider({ companyId, projectId, provider, enabled, identifier }) {
    const configuration = validatePixelConfiguration(provider, { enabled, identifier });
    if (configuration.enabled && !await currentPolicy(this.database, { companyId, projectId }))
      throw fail('Defina a política de privacidade antes de habilitar pixels.', 409);
    await this.database.query(
      `INSERT INTO project_integrations (company_id, project_id, provider, environment, configuration, updated_at)
       VALUES ($1, $2, $3, 'production', $4::jsonb, now())
       ON CONFLICT (project_id, provider, environment)
       DO UPDATE SET company_id = EXCLUDED.company_id, configuration = EXCLUDED.configuration, updated_at = now()`,
      [companyId, projectId, provider, JSON.stringify(configuration)],
    );
    return { provider, ...configuration };
  }

  async publicProjection({ companyId, projectId, environment, pixelsEnabled }) {
    if (environment !== 'production' || pixelsEnabled !== true) {
      return { formatVersion: 1, trackerPublicId: null, policyUrl: null, policyVersion: null, consentExpiryDays: null, pixelsEnabled: false, pixels: [] };
    }
    const policy = await currentPolicy(this.database, { companyId, projectId });
    if (!policy) return { formatVersion: 1, trackerPublicId: null, policyUrl: null, policyVersion: null, consentExpiryDays: null, pixelsEnabled: false, pixels: [] };
    const { rows } = await this.database.query(
      `SELECT tracker_public_id FROM analytics_websites
        WHERE company_id = $1 AND project_id = $2 AND environment = 'production'`,
      [companyId, projectId],
    );
    const providers = await this.list({ companyId, projectId });
    return {
      formatVersion: 1,
      trackerPublicId: rows[0]?.tracker_public_id ?? null,
      policyUrl: policy.privacy_policy_url,
      policyVersion: policy.policy_version,
      consentExpiryDays: policy.consent_expiry_days,
      pixelsEnabled: true,
      pixels: providers.filter(({ enabled }) => enabled).map(({ provider, identifier }) => ({ provider, identifier })),
    };
  }

  async grantConsent({ consentToken, publicationId: publicId, environment, snapshotHash: snapshot }) {
    const tokenDigest = tokenHash(consentToken);
    return withTransaction(this.database, async (client) => {
      const scope = await activePublication(client, { publicationId: publicId, environment, snapshotHash: snapshot });
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${scope.websiteId}:advertising:${tokenDigest}`]);
      const policy = await currentPolicy(client, { companyId: scope.companyId, projectId: scope.projectId, lock: true });
      if (!policy) throw fail('Política de privacidade não configurada.', 409);
      const existing = await client.query(
        `SELECT id FROM analytics_consents
          WHERE company_id = $1 AND project_id = $2 AND website_id = $3 AND purpose = 'advertising'
            AND consent_token_hash = $4 AND policy_version = $5 AND revoked_at IS NULL AND expires_at > now()`,
        [scope.companyId, scope.projectId, scope.websiteId, tokenDigest, policy.policy_version],
      );
      if (existing.rows.length) return { advertising: 'granted', policyVersion: policy.policy_version };
      await client.query(
        `UPDATE analytics_consents SET revoked_at = now()
          WHERE company_id = $1 AND project_id = $2 AND website_id = $3 AND purpose = 'advertising'
            AND consent_token_hash = $4 AND revoked_at IS NULL`,
        [scope.companyId, scope.projectId, scope.websiteId, tokenDigest],
      );
      await client.query(
        `INSERT INTO analytics_consents
           (company_id, project_id, website_id, purpose, consent_token_hash, policy_version, expires_at, evidence)
         VALUES ($1, $2, $3, 'advertising', $4, $5, now() + make_interval(days => $6), $7::jsonb)`,
        [scope.companyId, scope.projectId, scope.websiteId, tokenDigest, policy.policy_version, policy.consent_expiry_days, JSON.stringify({ source: 'banner', publicationId: scope.publicationId })],
      );
      return { advertising: 'granted', policyVersion: policy.policy_version };
    });
  }

  async consentState({ consentToken, publicationId: publicId, environment, snapshotHash: snapshot }) {
    const tokenDigest = tokenHash(consentToken);
    const scope = await activePublication(this.database, { publicationId: publicId, environment, snapshotHash: snapshot });
    const policy = await currentPolicy(this.database, { companyId: scope.companyId, projectId: scope.projectId });
    if (!policy) return { advertising: 'denied', policyVersion: null };
    const { rows } = await this.database.query(
      `SELECT 1 FROM analytics_consents
        WHERE company_id = $1 AND project_id = $2 AND website_id = $3 AND purpose = 'advertising'
          AND consent_token_hash = $4 AND policy_version = $5 AND revoked_at IS NULL AND expires_at > now()`,
        [scope.companyId, scope.projectId, scope.websiteId, tokenDigest, policy.policy_version],
    );
    return { advertising: rows.length ? 'granted' : 'denied', policyVersion: policy.policy_version };
  }

  async revokeConsent({ consentToken, publicationId: publicId, environment, snapshotHash: snapshot }) {
    const tokenDigest = tokenHash(consentToken);
    return withTransaction(this.database, async (client) => {
      const scope = await activePublication(client, { publicationId: publicId, environment, snapshotHash: snapshot });
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${scope.websiteId}:advertising:${tokenDigest}`]);
      const policy = await currentPolicy(client, { companyId: scope.companyId, projectId: scope.projectId, lock: true });
      await client.query(
        `UPDATE analytics_consents SET revoked_at = now()
          WHERE company_id = $1 AND project_id = $2 AND website_id = $3 AND purpose = 'advertising'
            AND consent_token_hash = $4 AND revoked_at IS NULL`,
        [scope.companyId, scope.projectId, scope.websiteId, tokenDigest],
      );
      return { advertising: 'denied', policyVersion: policy?.policy_version ?? null };
    });
  }
}
