import { createHash } from 'node:crypto';
import { consentScope } from '../conversion-consent-policy.mjs';

function scope(input) {
  if (!input?.companyId || !input?.projectId || !input?.environment) throw new Error('Escopo de publicação inválido.');
  return [input.companyId, input.projectId, input.environment];
}
function consentScopeHash(manifest) { return createHash('sha256').update(JSON.stringify(consentScope(manifest))).digest('hex'); }

export class PublicationRuntimeRepository {
  constructor(database) { if (!database || typeof database.query !== 'function') throw new Error('Banco obrigatório.'); this.database = database; }

  async saveManifest({ companyId, projectId, manifest }) {
    const [company, project, environment] = scope({ companyId, projectId, environment: manifest.environment });
    const { rows } = await this.database.query(
      `INSERT INTO publication_runtime_manifests
        (company_id, project_id, environment, publication_id, snapshot_hash, version, policy_version, origin, domain, policy, providers)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
       ON CONFLICT (company_id, project_id, environment, publication_id)
       DO UPDATE SET snapshot_hash=EXCLUDED.snapshot_hash, version=EXCLUDED.version, policy_version=EXCLUDED.policy_version, origin=EXCLUDED.origin, domain=EXCLUDED.domain,
         policy=EXCLUDED.policy, providers=EXCLUDED.providers, revoked_at=NULL, updated_at=now()
       RETURNING publication_id, snapshot_hash, version, policy_version, origin, domain, environment, policy, providers, revoked_at`,
      [company, project, environment, manifest.publicationId, manifest.snapshotHash, manifest.version, manifest.policyVersion, manifest.origin, manifest.domain, JSON.stringify(manifest.consent), JSON.stringify(manifest.providers)],
    );
    return rows[0];
  }

  async current({ companyId, projectId, environment, publicationId }) {
    const [company, project, target] = scope({ companyId, projectId, environment });
    const { rows } = await this.database.query(
      `SELECT publication_id, snapshot_hash, version, policy_version, origin, domain, environment, policy, providers, revoked_at
         FROM publication_runtime_manifests
        WHERE company_id=$1 AND project_id=$2 AND environment=$3 AND ($4::text IS NULL OR publication_id=$4)
          AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
      [company, project, target, publicationId || null],
    );
    return rows[0] || null;
  }

  async currentForOrigin({ publicationId, origin }) {
    if (typeof publicationId !== 'string' || typeof origin !== 'string') return null;
    const { rows } = await this.database.query(
      `SELECT company_id, project_id, publication_id, snapshot_hash, version, policy_version, origin, domain, environment, policy, providers, revoked_at
         FROM publication_runtime_manifests
        WHERE publication_id=$1 AND origin=$2 AND revoked_at IS NULL LIMIT 1`,
      [publicationId, origin],
    );
    return rows[0] || null;
  }

  async revoke({ companyId, projectId, environment, publicationId }) {
    const [company, project, target] = scope({ companyId, projectId, environment });
    const { rows } = await this.database.query(
      `UPDATE publication_runtime_manifests SET revoked_at=COALESCE(revoked_at, now()), updated_at=now()
        WHERE company_id=$1 AND project_id=$2 AND environment=$3 AND publication_id=$4 RETURNING publication_id, revoked_at`,
      [company, project, target, publicationId],
    );
    return rows[0] || null;
  }

  async recordConsent({ manifest, subjectId, state }) {
    if (!manifest?.publicationId || typeof subjectId !== 'string' || !/^[A-Za-z0-9._~-]{16,160}$/.test(subjectId) || !['pending', 'denied', 'granted'].includes(state)) throw fail('Registro de consentimento inválido.');
    const scopeHash = consentScopeHash(manifest);
    const { rows } = await this.database.query(
      `INSERT INTO publication_runtime_consents (publication_id, consent_subject, scope_hash, state)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (publication_id, consent_subject, scope_hash)
       DO UPDATE SET state=EXCLUDED.state, updated_at=now()
       RETURNING state, scope_hash, updated_at`,
      [manifest.publicationId, subjectId, scopeHash, state],
    );
    return rows[0];
  }

  async currentConsent({ manifest, subjectId }) {
    if (!manifest?.publicationId || typeof subjectId !== 'string') return null;
    const { rows } = await this.database.query(
      `SELECT state, scope_hash, updated_at FROM publication_runtime_consents
        WHERE publication_id=$1 AND consent_subject=$2 AND scope_hash=$3 LIMIT 1`,
      [manifest.publicationId, subjectId, consentScopeHash(manifest)],
    );
    return rows[0] || null;
  }

  async claimNonce({ publicationId, nonce, expiresAt }) {
    const run = async (client) => {
      await client.query('DELETE FROM publication_runtime_replays WHERE expires_at <= now()');
      const { rowCount } = await client.query(
        `INSERT INTO publication_runtime_replays (publication_id, nonce, expires_at) VALUES ($1,$2,$3)
         ON CONFLICT (publication_id, nonce) DO NOTHING`, [publicationId, nonce, expiresAt],
      );
      return rowCount === 1;
    };
    return this.database.transaction ? this.database.transaction(run) : run(this.database);
  }
}
