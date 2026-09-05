import { Publisher } from './publisher.mjs';

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }

function publicRun(run, snapshot) {
  return snapshot ? { ...run, snapshotHash: snapshot.hash, manifest: snapshot.manifest } : run;
}

export class PublicationService {
  constructor({ snapshotBuilder, integrations, deployments, publisherFactory = (credentials) => new Publisher(credentials), audit, domains } = {}) {
    this.snapshotBuilder = snapshotBuilder;
    this.integrations = integrations;
    this.deployments = deployments;
    this.publisherFactory = publisherFactory;
    this.audit = audit || { record: async () => {} };
    this.domains = domains;
  }

  async publisher(scope) {
    const credentials = await this.integrations.credentials(scope);
    if (!credentials) throw fail('Conecte a Vercel neste projeto antes de publicar.', 409);
    return { credentials, publisher: this.publisherFactory(credentials) };
  }

  async send({ companyId, projectId, requestedBy, environment, expectedRevision, idempotencyKey, snapshot }) {
    const scope = { companyId, projectId };
    const { credentials, publisher } = await this.publisher(scope);
    const run = await this.deployments.createOrGet({ companyId, projectId, environment, snapshotHash: snapshot.hash, expectedRevision, requestedBy, idempotencyKey });
    if (run.externalDeploymentId) return publicRun(run, snapshot);
    try {
      const result = await publisher.publish({
        projectId: credentials.vercelProjectId,
        teamId: credentials.teamId,
        environment,
        files: snapshot.files,
        snapshotHash: snapshot.hash,
        revision: expectedRevision,
      });
      const persisted = await this.deployments.updateExternal({
        companyId, projectId, runId: run.id,
        externalDeploymentId: result.id,
        externalProjectId: result.projectId || credentials.vercelProjectId,
        url: result.url,
        status: result.state || 'QUEUED',
      });
      await this.audit.record({ companyId, projectId, actorUserId: requestedBy, action: `deployment.${environment}.success`, resourceType: 'deployment_run', resourceId: run.id, revision: expectedRevision, result: 'success', metadata: { snapshotHash: snapshot.hash } });
      return publicRun({ ...persisted, url: result.url || persisted.url }, snapshot);
    } catch (error) {
      await this.deployments.updateStatus({ companyId, projectId, runId: run.id, status: 'ERROR', error: error.message }).catch(() => {});
      await this.audit.record({ companyId, projectId, actorUserId: requestedBy, action: `deployment.${environment}.failure`, resourceType: 'deployment_run', resourceId: run.id, revision: expectedRevision, result: 'failure', metadata: { snapshotHash: snapshot.hash } }).catch(() => {});
      throw error;
    }
  }

  async preview(input) {
    const snapshot = await this.snapshotBuilder.build(input);
    await this.audit.record({ companyId: input.companyId, projectId: input.projectId, actorUserId: input.requestedBy, action: 'deployment.preview.request', resourceType: 'project', resourceId: input.projectId, revision: input.expectedRevision, result: 'requested', metadata: { snapshotHash: snapshot.hash } });
    return this.send({ ...input, environment: 'preview', snapshot });
  }

  async overview({ companyId, projectId }) {
    return {
      integration: await this.integrations.publicSettings({ companyId, projectId }),
      run: await this.deployments.latest({ companyId, projectId }),
    };
  }

  async production(input) {
    if (input.confirmed !== true) throw fail('A confirmação da publicação em produção é obrigatória.', 409);
    if (!input.previewRunId) throw fail('Valide uma prévia antes de publicar em produção.', 409);
    const snapshot = await this.snapshotBuilder.build(input);
    const preview = await this.deployments.find({ companyId: input.companyId, projectId: input.projectId, runId: input.previewRunId });
    if (!preview || preview.status !== 'READY' || preview.snapshotHash.toLowerCase() !== snapshot.hash.toLowerCase()) throw fail('A prévia validada não corresponde ao snapshot atual.', 409);
    await this.audit.record({ companyId: input.companyId, projectId: input.projectId, actorUserId: input.requestedBy, action: 'deployment.production.request', resourceType: 'project', resourceId: input.projectId, revision: input.expectedRevision, result: 'requested', metadata: { snapshotHash: snapshot.hash, previewRunId: input.previewRunId } });
    return this.send({ ...input, environment: 'production', snapshot });
  }

  async status({ companyId, projectId, runId }) {
    const run = await this.deployments.find({ companyId, projectId, runId });
    if (!run) throw fail('Execução não encontrada.', 404);
    if (!run.externalDeploymentId || ['READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(run.status)) return run;
    const { publisher } = await this.publisher({ companyId, projectId });
    const state = await publisher.status(run.externalDeploymentId);
    return this.deployments.updateStatus({ companyId, projectId, runId, status: state.state, url: state.url });
  }

  async domain({ companyId, projectId, requestedBy, runId, domain }) {
    const run = await this.deployments.find({ companyId, projectId, runId });
    if (!run || run.environment !== 'production') throw fail('Publique em produção antes de configurar o domínio.', 409);
    if (run.status !== 'READY') throw fail('O domínio só pode ser configurado após a publicação estar no ar.', 409);
    const { credentials, publisher } = await this.publisher({ companyId, projectId });
    const result = await publisher.domain({ projectId: credentials.vercelProjectId, domain });
    if (this.domains) await this.domains.save({ companyId, projectId, environment: 'production', domain: result.name || domain, verificationStatus: result.verified ? 'verified' : 'pending' });
    await this.audit.record({ companyId, projectId, actorUserId: requestedBy, action: 'domain.configure.success', resourceType: 'deployment_run', resourceId: run.id, result: 'success', metadata: { domain: result.name || domain } });
    return result;
  }
}
