// Os funis do projeto: o desenho e as páginas que ele cria.
//
// O funil não publica nada sozinho. Cada etapa que vira página cria uma página comum do
// projeto (landing ou quiz), com a rota derivada do nome do funil e da etapa, e os botões
// dela já apontando para a etapa seguinte. Daí em diante a página é editada e publicada
// como qualquer outra.
import { destinosDaEtapa, grafoDoModelo, normalizarGrafo } from '../../public/funil.js';
import { etapaViraPagina, paginaDaEtapa } from '../../public/funis-etapas.js';
import { modelosDeFunil } from '../../public/funis-modelos.js';

const falhar = (mensagem, status = 400) => Object.assign(new Error(mensagem), { status, statusCode: status });
const nomeLimpo = (valor) => String(valor ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
const slug = (valor) => String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'etapa';

const registro = (linha) => linha && ({
  id: linha.id,
  projectId: linha.project_id,
  name: linha.name,
  graph: linha.graph,
  modelId: linha.model_id,
  revision: linha.lock_version,
  createdAt: linha.created_at,
  updatedAt: linha.updated_at,
});

export class FunnelRepository {
  constructor(database, { content } = {}) {
    this.database = database;
    this.content = content;
  }

  async listar({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT * FROM funnels WHERE company_id = $1 AND project_id = $2 AND deleted_at IS NULL ORDER BY updated_at DESC`,
      [companyId, projectId],
    );
    return rows.map(registro);
  }

  async buscar({ companyId, projectId, funnelId, client = this.database }) {
    const { rows } = await client.query(
      `SELECT * FROM funnels WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [companyId, projectId, funnelId],
    );
    if (!rows[0]) throw falhar('Funil não encontrado.', 404);
    return registro(rows[0]);
  }

  async criar({ companyId, projectId, actorId, name, modelId }) {
    const modelo = modelId ? modelosDeFunil.find((item) => item.id === modelId) : null;
    if (modelId && !modelo) throw falhar('Modelo de funil desconhecido.');
    // Modelo sem nenhuma página do Studio não está na galeria (ver funis-view.js).
    if (modelo && !modelo.nos.some((no) => etapaViraPagina(no.k))) throw falhar('Este modelo ainda não tem páginas que o Studio cria.');
    const nome = nomeLimpo(name) || modelo?.nome || 'Funil sem nome';
    const grafo = modelo ? grafoDoModelo(modelo) : normalizarGrafo({ nos: [{ id: 'n1', k: 'meta', nome: 'Anúncio', x: 0, y: 0 }, { id: 'n2', k: 'pagina', nome: 'Página de vendas', x: 320, y: 0 }], setas: [{ id: 's1', de: 'n1', para: 'n2' }] });
    const { rows } = await this.database.query(
      `INSERT INTO funnels (company_id, project_id, name, graph, model_id, created_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING *`,
      [companyId, projectId, nome, JSON.stringify(grafo), modelo?.id ?? null, actorId],
    );
    return registro(rows[0]);
  }

  async salvar({ companyId, projectId, funnelId, revision, name, graph }) {
    const grafo = normalizarGrafo(graph);
    const nome = nomeLimpo(name);
    if (!nome) throw falhar('Dê um nome ao funil.');
    const { rows } = await this.database.query(
      `UPDATE funnels SET name = $5, graph = $6::jsonb, lock_version = lock_version + 1, updated_at = now()
       WHERE company_id = $1 AND project_id = $2 AND id = $3 AND lock_version = $4 AND deleted_at IS NULL RETURNING *`,
      [companyId, projectId, funnelId, Number(revision), nome, JSON.stringify(grafo)],
    );
    if (!rows[0]) {
      await this.buscar({ companyId, projectId, funnelId });
      throw falhar('O funil mudou em outra aba. Recarregue antes de salvar.', 409);
    }
    return registro(rows[0]);
  }

  async remover({ companyId, projectId, funnelId }) {
    const { rowCount } = await this.database.query(
      `UPDATE funnels SET deleted_at = now() WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [companyId, projectId, funnelId],
    );
    if (!rowCount) throw falhar('Funil não encontrado.', 404);
    return { ok: true };
  }

  // Cria as páginas das etapas que ainda não têm (ou só das etapas pedidas), numa transação:
  // primeiro decide a rota de cada uma, depois monta cada página com os botões apontando
  // para as rotas vizinhas, e por fim guarda no desenho o id de cada página criada.
  async criarPaginas({ companyId, projectId, actorId, funnelId, etapaIds = null }) {
    if (!this.content) throw falhar('Criação de páginas indisponível.', 409);
    return this.database.transaction(async (client) => {
      const funil = await this.buscar({ companyId, projectId, funnelId, client });
      const grafo = normalizarGrafo(funil.graph);
      const alvo = grafo.nos.filter((no) => etapaViraPagina(no.k) && !no.pageId && (!etapaIds || etapaIds.includes(no.id)));
      if (!alvo.length) return { funnel: funil, criadas: [] };

      // Rota ocupada é rota de qualquer conteúdo do projeto, não só de página viva.
      const rotas = await client.query(
        `SELECT route.path, page.id AS page_id FROM project_routes route
         LEFT JOIN pages page ON page.route_id = route.id AND page.company_id = route.company_id AND page.deleted_at IS NULL
         WHERE route.company_id = $1 AND route.project_id = $2 AND route.deleted_at IS NULL`,
        [companyId, projectId],
      );
      const rotaPorPagina = new Map(rotas.rows.filter((linha) => linha.page_id).map((linha) => [linha.page_id, linha.path]));
      const usadas = new Set(rotas.rows.map((linha) => linha.path));
      const rotaNova = new Map();
      for (const no of alvo) {
        const base = `/${slug(funil.name)}-${slug(no.nome)}`.slice(0, 80);
        let rota = base; let n = 2;
        while (usadas.has(rota)) rota = `${base}-${n++}`;
        usadas.add(rota);
        rotaNova.set(no.id, rota);
      }
      const enderecoDaPagina = (no) => rotaNova.get(no.id) || (no.pageId ? rotaPorPagina.get(no.pageId) : '') || '';

      const criadas = [];
      for (const no of alvo) {
        const { kind, editorState } = paginaDaEtapa(no, destinosDaEtapa(grafo, no.id, enderecoDaPagina));
        const pagina = await this.content.createPage({
          companyId, projectId, actorId, client,
          name: `${funil.name} · ${no.nome}`.slice(0, 100), route: rotaNova.get(no.id), template: '', editorState, kind,
        });
        no.pageId = pagina.id;
        criadas.push({ etapaId: no.id, pageId: pagina.id, route: pagina.route, kind });
      }
      const { rows } = await client.query(
        `UPDATE funnels SET graph = $4::jsonb, lock_version = lock_version + 1, updated_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 RETURNING *`,
        [companyId, projectId, funnelId, JSON.stringify(grafo)],
      );
      return { funnel: registro(rows[0]), criadas };
    });
  }
}
