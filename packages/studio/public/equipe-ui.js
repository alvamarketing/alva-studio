// Convidar alguém para a equipe. Enquanto o Studio não envia e-mail, quem convida recebe o
// link e o manda como preferir — é o que o n8n faz quando não há SMTP configurado, e é
// melhor do que um convite que promete um e-mail que nunca chega.
const PAPEIS = [
  ['editor', 'Editor — cria e edita conteúdo dos projetos liberados'],
  ['analyst', 'Analista — só acompanha números e leads'],
  ['admin', 'Administrador — faz tudo, inclusive convidar'],
];
const NOME_DO_PAPEL = { editor: 'editor', analyst: 'analista', admin: 'administrador' };

export function textoDoConvite({ email = '', companyName = '', role = 'editor' } = {}) {
  return {
    titulo: `Você foi convidado para a ${companyName}`,
    descricao: `Crie sua senha para entrar como ${NOME_DO_PAPEL[role] ?? role} com o e-mail ${email}.`,
  };
}

export function formularioDeConvite(doc, { convidar }) {
  const bloco = doc.createElement('div');
  bloco.className = 'convite-bloco';
  const form = doc.createElement('form');
  form.className = 'convite-form';
  form.innerHTML = '<label>E-mail de quem entra<input type="email" name="email" required maxlength="254" placeholder="pessoa@empresa.com.br"></label>'
    + `<label>O que essa pessoa pode fazer<select name="role">${PAPEIS.map(([valor, rotulo]) => `<option value="${valor}">${rotulo}</option>`).join('')}</select></label>`
    + '<div class="owner-form-actions"><button class="primary" type="submit">Convidar</button></div>';
  const erro = doc.createElement('p');
  erro.className = 'form-error';
  erro.setAttribute('role', 'alert');
  const resultado = doc.createElement('div');
  resultado.className = 'convite-resultado';
  resultado.hidden = true;
  bloco.append(form, erro, resultado);

  bloco.aoEnviar = async (evento) => {
    evento?.preventDefault?.();
    erro.textContent = '';
    const email = form.elements.email.value.trim();
    const role = form.elements.role.value;
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      const convite = await convidar({ email, role });
      resultado.hidden = false;
      resultado.innerHTML = '';
      const aviso = doc.createElement('p');
      aviso.innerHTML = `Convite criado para <strong></strong>. Envie este link — ele vale por sete dias.`;
      aviso.querySelector('strong').textContent = convite.email || email;
      const campo = doc.createElement('input');
      campo.className = 'convite-link';
      campo.readOnly = true;
      campo.value = convite.link || '';
      campo.setAttribute('aria-label', 'Link do convite');
      const copiar = doc.createElement('button');
      copiar.type = 'button';
      copiar.textContent = 'Copiar link';
      copiar.onclick = () => {
        campo.select?.();
        globalThis.navigator?.clipboard?.writeText?.(campo.value);
        copiar.textContent = 'Link copiado';
      };
      resultado.append(aviso, campo, copiar);
      form.reset();
    } catch (falha) {
      erro.textContent = falha?.message || 'Não foi possível convidar.';
    } finally {
      botao.disabled = false;
    }
  };
  form.addEventListener('submit', bloco.aoEnviar);
  return bloco;
}

// Os convites que ainda esperam resposta, com o e-mail e quando vencem.
export function listaDeConvites(doc, convites = []) {
  const bloco = doc.createElement('div');
  bloco.className = 'convite-pendentes';
  if (!convites.length) return bloco;
  const titulo = doc.createElement('h3');
  titulo.textContent = 'Convites enviados';
  bloco.append(titulo);
  for (const convite of convites) {
    const item = doc.createElement('div');
    item.className = 'member-item';
    const identidade = doc.createElement('div');
    const email = doc.createElement('strong');
    email.textContent = convite.email;
    const prazo = doc.createElement('span');
    const vence = new Date(convite.expiresAt);
    prazo.textContent = Number.isNaN(vence.getTime()) ? 'Aguardando resposta' : `Aguardando resposta · vence em ${vence.toLocaleDateString('pt-BR')}`;
    identidade.append(email, prazo);
    const papel = doc.createElement('span');
    papel.className = 'role-chip';
    papel.textContent = NOME_DO_PAPEL[convite.role] ?? convite.role;
    item.append(identidade, papel);
    bloco.append(item);
  }
  return bloco;
}
