import { createHash, randomUUID } from 'node:crypto';
import { SecretVault } from './publication-repository.mjs';
import { IDENTIFICADORES_DE_CLIQUE, NOME_NA_PLATAFORMA } from '../conversion-consent-policy.mjs';
import { qualidadeDaCorrespondencia, resumoDaCorrespondencia } from '../qualidade-de-correspondencia.mjs';

const EVENTS = new Set(['lead', 'initiate_checkout', 'purchase', 'vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click']);
const ENVIRONMENTS = new Set(['preview', 'production']);
const ATTRIBUTION_KEYS = IDENTIFICADORES_DE_CLIQUE;

// A fila guardava os identificadores sob `attribution`, com os nomes da coleta, e os
// adaptadores liam `click_ids`, com os nomes das plataformas — duas chaves que nunca se
// encontravam. Resultado: nenhuma conversão levava identificador de clique a lugar
// nenhum, e Taboola e Google recusavam o evento exatamente por falta dele.
//
// A tradução de nome vem de `conversion-consent-policy.mjs`, que é a única lista. Só a
// derivação do `fbc` mora aqui, porque ela precisa do instante do evento.
function identificadoresDeClique(atribuicao, quando) {
  return Object.fromEntries(Object.entries(atribuicao).flatMap(([nome, valor]) => {
    const destino = NOME_NA_PLATAFORMA[nome];
    if (!destino || !valor) return [];
    // Formato documentado pela Meta: fb.<índice do subdomínio>.<criação em ms>.<fbclid>.
    // A idade do clique entra na atribuição, então o instante vai junto.
    return [[destino, nome === 'fbclid' ? `fb.1.${quando.getTime()}.${valor}` : valor]];
  }));
}
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 14_400_000, 43_200_000];

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function bindingScope({ companyId, projectId, environment }) { return `tracking-binding:${companyId}:${projectId}:${environment}:conversions`; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function contact(answers = {}) {
  const entries = Object.entries(answers && typeof answers === 'object' ? answers : {});
  const email = entries.find(([key, value]) => /e-?mail/i.test(key) && typeof value === 'string')?.[1];
  const phone = entries.find(([key, value]) => /(telefone|phone|celular|whatsapp)/i.test(key) && typeof value === 'string')?.[1];
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const normalizedPhone = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  return Object.fromEntries([
    ...(normalizedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ? [['email_sha256', hash(normalizedEmail)]] : []),
    ...(normalizedPhone.length >= 8 && normalizedPhone.length <= 15 ? [['phone_sha256', hash(normalizedPhone)]] : []),
  ]);
}
function attribution(values = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail('Identificadores de atribuição inválidos.');
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => ATTRIBUTION_KEYS.has(key) && typeof value === 'string' && value.length > 0 && value.length <= 512 ? [[key, value]] : []));
}
// O endereço da página onde a conversão aconteceu. Vai para a plataforma — a Meta o
// recebe como `event_source_url` e usa na atribuição —, então passa por três exigências:
// ser http(s), ser https (a página publicada sempre é; um endereço sem TLS aqui indica
// origem forjada) e perder a query string. A query carrega o identificador do clique, que
// já vai em campo próprio, e com frequência carrega o que a pessoa digitou no formulário.
function enderecoDeOrigem(valor) {
  if (typeof valor !== 'string' || !valor) return undefined;
  let url;
  try { url = new URL(valor); } catch { return undefined; }
  if (url.protocol !== 'https:') return undefined;
  return `${url.origin}${url.pathname}`.replace(/\/$/, '') || undefined;
}

function textoCurto(valor, limite = 190) {
  const limpo = String(valor ?? '').trim().replace(/[\r\n]/g, ' ');
  return limpo && limpo.length <= limite ? limpo : undefined;
}

function contextoDoFunil({ sourceUrl, contentId, contentName } = {}) {
  return {
    sourceUrl: enderecoDeOrigem(sourceUrl),
    params: Object.fromEntries(Object.entries({
      content_id: textoCurto(contentId),
      content_name: textoCurto(contentName),
    }).filter(([, valor]) => valor !== undefined)),
  };
}

function record(row) {
  // `destination` faz parte da entrega, não é enfeite: é o que diz ao cliente para qual
  // plataforma este evento vai. Sem ele a entrega não tem endereço.
  return row && { id: row.id, destination: row.destination, companyId: row.company_id, projectId: row.project_id, environment: row.environment, propertyId: row.property_id, trackingEventId: row.tracking_event_id, eventName: row.event_name, status: row.status, attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, lastError: row.last_error || null, deliveredAt: row.delivered_at, createdAt: row.created_at };
}
function statusRecord(row) {
  const delivery = record(row);
  if (!delivery) return delivery;
  delete delivery.propertyId;
  delete delivery.trackingEventId;
  // A tela agrupa as entregas de um mesmo evento. `eventRef` é derivado do id de rastreio
  // para que ele continue fora da resposta; do payload só saem consentimento e conteúdo,
  // nunca os hashes de contato de `user`.
  return {
    ...delivery,
    eventRef: row.tracking_event_id ? createHash('sha256').update(String(row.tracking_event_id)).digest('hex').slice(0, 12) : null,
    destination: row.destination,
    consentState: row.payload?.consent_state ?? 'pending',
    contentId: row.payload?.params?.content_id ?? row.payload?.content_id ?? '',
    contentName: row.payload?.params?.content_name ?? '',
    // A nota sai calculada daqui: o que ela mede — hashes de contato e identificadores de
    // clique — não pode ir ao navegador, então o número vai sozinho.
    matchQuality: qualidadeDaCorrespondencia(row.payload ?? {}).percentual,
  };
}
export function commercialRetryDelay(attempt) { return BACKOFF_MS[Math.min(Math.max(1, attempt), BACKOFF_MS.length) - 1]; }
export const MAX_COMMERCIAL_ATTEMPTS = BACKOFF_MS.length;

export class ConversionsOutboxRepository {
  constructor(database, { vault = new SecretVault({ masterKey: process.env.TRACKING_MASTER_KEY }) } = {}) { this.database = database; this.vault = vault; }
  async enqueue(client, { companyId, projectId, environment, trackingEventId, eventName, consentState = 'pending', answers = {}, attribution: rawAttribution = {}, params = {}, contexto = {}, at = new Date() }) {
    if (!ENVIRONMENTS.has(environment) || !EVENTS.has(eventName) || !['pending', 'denied', 'granted'].includes(consentState)) throw fail('Evento comercial inválido.');
    const binding = await client.query(
      `SELECT encrypted_remote_reference FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND engine = 'conversions' AND status = 'ready'`,
      [companyId, projectId, environment],
    );
    if (!binding.rows[0]?.encrypted_remote_reference) return null;
    const propertyId = this.vault.decrypt(binding.rows[0].encrypted_remote_reference, bindingScope({ companyId, projectId, environment }));
    if (!/^[a-z0-9][a-z0-9_]{0,99}$/.test(propertyId)) throw fail('Identificador da propriedade inválido.', 503);
    // Uma linha por destino configurado. Antes havia uma só, endereçada ao gateway, que
    // abria o leque do outro lado: se um destino recusasse, a repetição levava o evento de
    // novo a todos os outros. Aqui cada plataforma tem a própria tentativa e a própria
    // morte, e a fila conta uma entrega por destino em vez de uma por evento.
    const configurados = (await client.query(
      `SELECT provider FROM tracking_destinations WHERE company_id = $1 AND project_id = $2 AND environment = $3 ORDER BY provider`,
      [companyId, projectId, environment],
    )).rows.map((row) => row.provider);
    if (!configurados.length) return null;
    const cleanAttribution = attribution(rawAttribution);
    const cliques = identificadoresDeClique(cleanAttribution, at);
    const funil = contextoDoFunil(contexto);
    const payload = { property_id: propertyId, tracking_event_id: trackingEventId, event_name: eventName, event_time: Math.floor(at.getTime() / 1000), consent_state: consentState, user: consentState === 'granted' ? contact(answers) : {}, ...(Object.keys(cleanAttribution).length ? { attribution: cleanAttribution } : {}), ...(Object.keys(cliques).length ? { click_ids: cliques } : {}), ...(funil.sourceUrl ? { source_url: funil.sourceUrl } : {}), params: { ...funil.params, ...params } };
    await client.query(
      `INSERT INTO conversions_outbox (company_id, project_id, environment, property_id, tracking_event_id, event_name, destination, payload)
       SELECT $1, $2, $3, $4, $5, $6, destino, $7::jsonb FROM unnest($8::varchar[]) AS destino
       ON CONFLICT (company_id, project_id, property_id, tracking_event_id, event_name, destination) DO NOTHING`,
      [companyId, projectId, environment, propertyId, trackingEventId, eventName, JSON.stringify(payload), configurados],
    );
    // O retorno é o que ficou na fila, inserido agora ou já existente: é assim que o
    // chamador sabe que o evento está endereçado sem depender de ter sido o primeiro.
    const { rows } = await client.query(
      `SELECT * FROM conversions_outbox WHERE company_id = $1 AND project_id = $2 AND property_id = $3 AND tracking_event_id = $4 AND event_name = $5 ORDER BY destination`,
      [companyId, projectId, propertyId, trackingEventId, eventName],
    );
    return rows.map(record);
  }
  async claimNextDue({ leaseMs = 30_000 } = {}) {
    const token = randomUUID();
    const { rows } = await this.database.query(
      `WITH candidate AS (SELECT id FROM conversions_outbox WHERE ((status IN ('queued', 'retry') AND next_attempt_at <= now()) OR (status = 'running' AND lease_expires_at <= now())) ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       UPDATE conversions_outbox SET status = 'running', claim_token = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond'), updated_at = now() WHERE id = (SELECT id FROM candidate) RETURNING *`, [token, leaseMs],
    );
    return rows[0] ? { claimed: true, token, delivery: { ...record(rows[0]), payload: rows[0].payload } } : { claimed: false };
  }
  async markDelivered({ id, claimToken }) { const { rows } = await this.database.query(`UPDATE conversions_outbox SET status = 'delivered', attempt_count = attempt_count + 1, claim_token = NULL, lease_expires_at = NULL, last_error = NULL, delivered_at = now(), updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'running' RETURNING *`, [id, claimToken]); return record(rows[0]); }
  async markRetry({ id, claimToken, attemptCount, nextAttemptAt, lastError }) { const { rows } = await this.database.query(`UPDATE conversions_outbox SET status = 'retry', attempt_count = $3, next_attempt_at = $4, last_error = $5, claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'running' RETURNING *`, [id, claimToken, attemptCount, nextAttemptAt, String(lastError || 'delivery_failed').replace(/[\r\n]/g, ' ').slice(0, 240)]); return record(rows[0]); }
  async markDead({ id, claimToken, attemptCount, lastError }) { const { rows } = await this.database.query(`UPDATE conversions_outbox SET status = 'dead', attempt_count = $3, last_error = $4, claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'running' RETURNING *`, [id, claimToken, attemptCount, String(lastError || 'delivery_failed').replace(/[\r\n]/g, ' ').slice(0, 240)]); return record(rows[0]); }
  // O resumo da correspondência do projeto: quantos eventos, a média, e o que mais falta.
  // Fica aqui porque é onde o payload existe; a tela recebe só o que dá para mostrar.
  async matchQuality({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT payload FROM conversions_outbox WHERE company_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 500`,
      [companyId, projectId],
    );
    return resumoDaCorrespondencia(rows);
  }
  async status({ companyId, projectId }) { const { rows } = await this.database.query(`SELECT * FROM conversions_outbox WHERE company_id = $1 AND project_id = $2 ORDER BY created_at DESC`, [companyId, projectId]); return rows.map(statusRecord); }
}
