import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = join(dir, 'pages.json');
    this.queue = Promise.resolve();
  }
  async read() {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }
  valid(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw fail('Página inválida.');
  }
  async transaction(fn) {
    const run = this.queue.then(async () => {
      const rows = await this.read();
      const result = fn(rows);
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const temp = join(this.dir, randomUUID() + '.tmp');
      await writeFile(temp, JSON.stringify(rows), { mode: 0o600 });
      await rename(temp, this.file);
      return structuredClone(result);
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async list() {
    await this.queue;
    return (await this.read()).map(({ project, html, ...summary }) => summary);
  }
  async get(id) {
    this.valid(id);
    await this.queue;
    const p = (await this.read()).find((p) => p.id === id);
    if (!p) throw fail('Página não encontrada.', 404);
    return p;
  }
  async create({ name, template = 'services' }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100)
      throw fail('Informe um nome com até 100 caracteres.');
    return this.transaction((rows) => {
      const p = {
        id: randomUUID(),
        name: name.trim(),
        template: template === 'blank' ? 'blank' : 'services',
        project: null,
        html: '',
        domain: '',
        webhook: '',
        revision: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deployment: null,
      };
      rows.push(p);
      return p;
    });
  }
  async update(id, patch) {
    this.valid(id);
    return this.transaction((rows) => {
      const p = rows.find((p) => p.id === id);
      if (!p) throw fail('Página não encontrada.', 404);
      if (p.revision !== patch.revision) throw fail('A página mudou em outra aba. Reabra antes de salvar.', 409);
      if (patch.name !== undefined) {
        if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 100)
          throw fail('Nome inválido.');
        p.name = patch.name.trim();
      }
      if (patch.project !== undefined) {
        if (!patch.project || typeof patch.project !== 'object' || Array.isArray(patch.project))
          throw fail('Projeto inválido.');
        p.project = patch.project;
      }
      if (patch.html !== undefined) {
        if (typeof patch.html !== 'string') throw fail('HTML inválido.');
        p.html = patch.html;
      }
      if (patch.domain !== undefined) {
        if (
          typeof patch.domain !== 'string' ||
          (patch.domain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(patch.domain))
        )
          throw fail('Use um domínio sem https ou caminho.');
        p.domain = patch.domain;
      }
      if (patch.webhook !== undefined) {
        if (typeof patch.webhook !== 'string') throw fail('Endereço de formulário inválido.');
        if (patch.webhook) {
          let url;
          try {
            url = new URL(patch.webhook);
          } catch {
            throw fail('Endereço de formulário inválido.');
          }
          if (url.protocol !== 'https:' || url.username || url.password)
            throw fail('O formulário precisa de um endereço HTTPS sem credenciais.');
        }
        p.webhook = patch.webhook;
      }
      p.revision++;
      p.updatedAt = new Date().toISOString();
      return p;
    });
  }
  async duplicate(id) {
    const original = await this.get(id);
    return this.transaction((rows) => {
      const copy = {
        ...original,
        id: randomUUID(),
        name: (original.name + ' — cópia').slice(0, 100),
        domain: '',
        deployment: null,
        revision: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      rows.push(copy);
      return copy;
    });
  }
  async remove(id) {
    this.valid(id);
    return this.transaction((rows) => {
      const index = rows.findIndex((p) => p.id === id);
      if (index < 0) throw fail('Página não encontrada.', 404);
      rows.splice(index, 1);
      return { ok: true };
    });
  }
  async setDeployment(id, deployment, expectedId) {
    return this.transaction((rows) => {
      const p = rows.find((p) => p.id === id);
      if (!p) throw fail('Página removida durante a publicação.', 409);
      if (expectedId !== undefined && p.deployment?.id !== expectedId) return p;
      p.deployment = deployment;
      return p;
    });
  }
}
