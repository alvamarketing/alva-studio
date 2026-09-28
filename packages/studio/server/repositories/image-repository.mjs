// As imagens anexadas do computador no editor de landing.
//
// O tipo vem dos primeiros bytes do arquivo, não do que o navegador declara: um arquivo
// renomeado para .png continua sendo o que é. SVG fica de fora — pode carregar script, e a
// imagem é servida no domínio do Studio.
import { createHash } from 'node:crypto';

export const TAMANHO_MAXIMO_DA_IMAGEM = 5 * 1024 * 1024;

function falhar(mensagem, status = 400) {
  return Object.assign(new Error(mensagem), { status, statusCode: status });
}

export function tipoDaImagem(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.alloc(0);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

export class ImageRepository {
  constructor(database, { publicOrigin = process.env.PUBLIC_ORIGIN } = {}) {
    this.database = database;
    this.publicOrigin = publicOrigin;
  }

  endereco(id, origem = this.publicOrigin) {
    return `${String(origem ?? '').replace(/\/$/, '')}/i/${id}`;
  }

  async salvar({ companyId, projectId, actorId, dados, origem }) {
    if (typeof dados !== 'string' || !dados) throw falhar('Escolha uma imagem.');
    const base64 = dados.replace(/^data:[^;,]*;base64,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw falhar('Arquivo de imagem inválido.');
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) throw falhar('Arquivo de imagem vazio.');
    if (bytes.length > TAMANHO_MAXIMO_DA_IMAGEM) throw falhar('A imagem passa de 5 MB. Reduza e tente de novo.', 413);
    const tipo = tipoDaImagem(bytes);
    if (!tipo) throw falhar('Use uma imagem PNG, JPEG, WebP ou GIF.');
    const { rows } = await this.database.query(
      `INSERT INTO project_images (company_id, project_id, content_type, bytes, size_bytes, sha256, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [companyId, projectId, tipo, bytes, bytes.length, createHash('sha256').update(bytes).digest('hex'), actorId ?? null],
    );
    return { id: rows[0].id, url: this.endereco(rows[0].id, origem), tipo, tamanho: bytes.length };
  }

  async buscar(id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id))) return null;
    const { rows } = await this.database.query('SELECT content_type, bytes, sha256 FROM project_images WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
}
