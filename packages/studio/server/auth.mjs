import { mkdir, readFile, writeFile, rename, open, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const publicOwner = (o) => (o ? { name: o.name, email: o.email } : null);
export class Auth {
  constructor(
    dir,
    {
      now = Date.now,
      sessionTTL = 12 * 60 * 60 * 1000,
      setupLockTTL = 5 * 60 * 1000,
      token = process.env.VERCEL_TOKEN,
      teamId = process.env.VERCEL_TEAM_ID,
    } = {},
  ) {
    this.dir = dir;
    this.now = now;
    this.sessionTTL = sessionTTL;
    this.setupLockTTL = setupLockTTL;
    this.env = { token, teamId };
    this.sessions = new Map();
    this.attempts = new Map();
    this.queue = Promise.resolve();
  }
  async read() {
    try {
      return JSON.parse(await readFile(join(this.dir, 'owner.json'), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async save(value) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = join(this.dir, randomUUID() + '.tmp');
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, join(this.dir, 'owner.json'));
  }
  transaction(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  identity(input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)
      throw fail('Informe um nome com até 100 caracteres.');
    if (
      typeof input.email !== 'string' ||
      input.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
    )
      throw fail('Informe um e-mail válido.');
    return { name: input.name.trim(), email: input.email.trim().toLowerCase() };
  }
  async password(value) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 256)
      throw fail('Use uma senha entre 12 e 256 caracteres.');
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: (await scrypt(value, salt, 64)).toString('hex') };
  }
  async verify(value, owner) {
    if (typeof value !== 'string' || value.length > 256) return false;
    const result = await scrypt(value, owner?.password.salt || 'unconfigured-owner', 64);
    return timingSafeEqual(result, owner ? Buffer.from(owner.password.hash, 'hex') : Buffer.alloc(64));
  }
  limit(ip) {
    const time = this.now();
    for (const [key, item] of this.attempts) if (time >= item.until) this.attempts.delete(key);
    if (!this.attempts.has(ip)) {
      if (this.attempts.size >= 1024) throw fail('Tente novamente em alguns minutos.', 429);
      this.attempts.set(ip, { count: 0, until: time + 15 * 60 * 1000 });
    }
    if (++this.attempts.get(ip).count > 12) throw fail('Muitas tentativas. Tente novamente em 15 minutos.', 429);
  }
  token(req) {
    return req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('alva_session='))
      ?.slice(13);
  }
  key(token) {
    return createHash('sha256')
      .update(token || '')
      .digest('hex');
  }
  session(req) {
    const key = this.key(this.token(req));
    const item = this.sessions.get(key);
    if (item && item > this.now()) return true;
    this.sessions.delete(key);
    return false;
  }
  issue(res, secure) {
    for (const [key, expires] of this.sessions) if (expires <= this.now()) this.sessions.delete(key);
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(this.key(token), this.now() + this.sessionTTL);
    res.setHeader(
      'Set-Cookie',
      `alva_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionTTL / 1000)}${secure ? '; Secure' : ''}`,
    );
  }
  logout(req, res, secure) {
    this.sessions.delete(this.key(this.token(req)));
    res.setHeader(
      'Set-Cookie',
      `alva_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`,
    );
  }
  async state(req) {
    const o = await this.read();
    const authenticated = Boolean(o && this.session(req));
    return { setupRequired: !o, authenticated, owner: authenticated ? publicOwner(o) : null };
  }
  processAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  }
  async setupLock() {
    const file = join(this.dir, 'setup.lock');
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: this.now() }));
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (await this.read()) throw fail('O dono já foi configurado.', 409);
    let metadata;
    let info;
    try {
      info = await stat(file);
      metadata = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return this.setupLock();
    }
    const createdAt = Number.isFinite(metadata?.createdAt) ? metadata.createdAt : info?.mtimeMs;
    const stale = Number.isFinite(createdAt) && this.now() - createdAt >= this.setupLockTTL;
    if (!stale || this.processAlive(metadata?.pid)) throw fail('Configuração em andamento. Tente novamente.', 409);
    const staleFile = join(this.dir, `setup.lock.stale-${randomUUID()}`);
    try {
      await rename(file, staleFile);
    } catch (error) {
      if (error.code === 'ENOENT') return this.setupLock();
      throw fail('Configuração em andamento. Tente novamente.', 409);
    }
    try {
      return await this.setupLock();
    } finally {
      await unlink(staleFile).catch(() => {});
    }
  }
  setup(input) {
    return this.transaction(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const lock = await this.setupLock();
      try {
        if (await this.read()) throw fail('O dono já foi configurado.', 409);
        const o = { ...this.identity(input), password: await this.password(input.password) };
        await this.save(o);
        return publicOwner(o);
      } finally {
        await lock.close();
        await unlink(join(this.dir, 'setup.lock')).catch(() => {});
      }
    });
  }
  login(input) {
    return this.transaction(async () => {
      const o = await this.read();
      const valid = await this.verify(input.password, o);
      if (!o || !valid || typeof input.email !== 'string' || input.email.trim().toLowerCase() !== o.email)
        throw fail('E-mail ou senha incorretos.', 401);
      return publicOwner(o);
    });
  }
  account(input) {
    return this.transaction(async () => {
      const o = await this.read();
      if (!(await this.verify(input.currentPassword, o))) throw fail('Senha atual incorreta.', 401);
      Object.assign(o, this.identity(input));
      if (input.newPassword) o.password = await this.password(input.newPassword);
      await this.save(o);
      this.sessions.clear();
      return publicOwner(o);
    });
  }
  async encryptionKey() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const file = join(this.dir, 'secret.key');
    try {
      return await readFile(file);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const key = randomBytes(32);
    try {
      await writeFile(file, key, { flag: 'wx', mode: 0o600 });
      return key;
    } catch (e) {
      if (e.code === 'EEXIST') return readFile(file);
      throw e;
    }
  }
  async credentials() {
    const o = await this.read();
    const v = o?.vercel;
    if (v?.disconnected) return { token: null, teamId: null, source: null };
    if (!v) return { ...this.env, source: this.env.token ? 'environment' : null };
    let token = this.env.token;
    if (v.secret) {
      const d = createDecipheriv('aes-256-gcm', await this.encryptionKey(), Buffer.from(v.secret.iv, 'hex'));
      d.setAuthTag(Buffer.from(v.secret.tag, 'hex'));
      token = Buffer.concat([d.update(Buffer.from(v.secret.data, 'hex')), d.final()]).toString();
    }
    return { token, teamId: v.teamId, source: v.secret ? 'saved' : token ? 'environment' : null };
  }
  async settings() {
    const c = await this.credentials();
    return {
      vercel: {
        connected: Boolean(c.token),
        tokenConfigured: Boolean(c.token),
        teamId: c.teamId || '',
        source: c.source,
      },
    };
  }
  settingsUpdate(input) {
    return this.transaction(async () => {
      const o = await this.read();
      if (input.disconnect === true) o.vercel = { disconnected: true };
      else {
        if (
          input.teamId !== undefined &&
          (typeof input.teamId !== 'string' || (input.teamId && !/^team_[a-zA-Z0-9]+$/.test(input.teamId)))
        )
          throw fail('Informe um Team ID válido, iniciado por team_.');
        const currentTeamId = o.vercel?.teamId ?? this.env.teamId ?? '';
        o.vercel = { ...(o.vercel?.disconnected ? {} : o.vercel), teamId: input.teamId ?? currentTeamId };
        delete o.vercel.disconnected;
        if (input.token !== undefined && input.token !== '') {
          if (typeof input.token !== 'string' || input.token.length > 4096 || !/^[\x21-\x7e]+$/.test(input.token))
            throw fail('Token inválido.');
          const iv = randomBytes(12);
          const c = createCipheriv('aes-256-gcm', await this.encryptionKey(), iv);
          o.vercel.secret = {
            iv: iv.toString('hex'),
            data: Buffer.concat([c.update(input.token), c.final()]).toString('hex'),
            tag: c.getAuthTag().toString('hex'),
          };
        }
      }
      await this.save(o);
      if (input.disconnect === true)
        return { vercel: { connected: false, tokenConfigured: false, teamId: '', source: null } };
      return this.settings();
    });
  }
}
