// O destino dos leads do projeto: um endereço só, para onde vai uma cópia de cada lead de
// qualquer página ou quiz. Antes o dono repetia o endereço em cada página, no botão Leads
// do editor; agora configura uma vez aqui, e a página só tem destino próprio se quiser
// sobrescrever (o servidor decide no envio do lead: página primeiro, senão o projeto).
//
// Cartão do contrato visual (wireframe, "Empresa e equipe"): `.surface` com `.surface-head`,
// campo empilhado, ajuda e as ações à direita.
export function criarCartaoDeLeads(doc, { api, toast = () => {} }) {
  const cartao = doc.createElement('section');
  cartao.id = 'project-leads-card';
  cartao.className = 'surface';
  cartao.innerHTML = '<div class="surface-head"><div><h2>Destino dos leads</h2>'
    + '<p class="helper">Todo lead capturado numa página ou quiz deste projeto vai também para o seu CRM.</p></div></div>'
    + '<form class="project-leads-form">'
    + '<label>Endereço do webhook (HTTPS)<input type="url" name="url" maxlength="2000" autocomplete="off" placeholder="https://seu-crm.com.br/webhook/leads"></label>'
    + '<p class="help">Enviamos uma cópia em JSON de cada lead para este endereço, para o seu CRM. '
    + 'Uma página ou quiz com destino próprio, definido no botão Leads do editor, sobrescreve este.</p>'
    + '<p class="form-error" role="alert"></p>'
    + '<div class="owner-form-actions"><button type="button" id="project-leads-remove">Remover</button>'
    + '<button type="submit" class="primary" id="project-leads-save">Salvar</button></div>'
    + '</form>';
  const form = cartao.querySelector('form');
  const campo = form.elements.url;
  const erro = cartao.querySelector('.form-error');
  const remover = cartao.querySelector('#project-leads-remove');
  const salvar = cartao.querySelector('#project-leads-save');
  let projectId = '';
  let salvo = false;

  const mostrar = (estado) => {
    salvo = Boolean(estado?.configured);
    campo.value = estado?.url ?? '';
    remover.disabled = !salvo;
  };
  const rota = () => `/projects/${projectId}/lead-webhook`;
  // Salvar e remover usam a mesma rota; só um dos dois roda por vez.
  const executar = async (corpo, aviso) => {
    erro.textContent = '';
    remover.disabled = true;
    salvar.disabled = true;
    try {
      mostrar(await api(rota(), 'PUT', corpo));
      toast(aviso);
    } catch (falha) {
      // O que a pessoa digitou fica no campo: errar a URL não pode custar redigitá-la.
      erro.textContent = falha?.message || 'Não foi possível salvar o destino dos leads.';
      remover.disabled = !salvo;
    } finally {
      salvar.disabled = false;
    }
  };

  cartao.carregar = async (id) => {
    projectId = id;
    erro.textContent = '';
    remover.disabled = true;
    campo.value = '';
    try {
      mostrar(await api(rota()));
    } catch (falha) {
      erro.textContent = falha?.message || 'Não foi possível carregar o destino dos leads.';
    }
  };
  cartao.aoSalvar = async (evento) => {
    evento?.preventDefault?.();
    await executar({ url: campo.value.trim() }, 'Destino dos leads salvo.');
  };
  cartao.aoRemover = async () => {
    await executar({ remove: true }, 'Destino dos leads removido.');
  };
  form.addEventListener('submit', cartao.aoSalvar);
  remover.addEventListener('click', cartao.aoRemover);
  return cartao;
}
