export function validatePasswordConfirmation(password, confirmation) {
  if (password !== confirmation) throw new Error('As senhas não conferem. Digite novamente.');
}
export function vercelPayload({ token, teamId }) {
  const payload = { teamId: String(teamId || '').trim() };
  if (String(token || '').trim()) payload.token = String(token).trim();
  return payload;
}
export function createOwnerUI({ api, onAuthenticated, onLoggedOut, onSettingsChanged, beforeLogout, toast }) {
  let session = null;
  const host = document.createElement('div');
  host.id = 'owner-root';
  host.innerHTML = `
    <section class="access-gate" id="access-gate" aria-label="Acesso ao Alva Studio" hidden>
      <div class="access-story"><a class="brand" href="/" aria-label="Alva Studio"><svg class="brand-symbol" aria-hidden="true" viewBox="0 0 720.5 1000"><use href="#alva-symbol"></use></svg><strong>ALVA</strong><span>Studio</span></a><div><span class="eyebrow">SEU ESPAÇO DE CRIAÇÃO</span><h1>Suas ideias.<br>Sua próxima<br><em>campanha.</em></h1><p>Crie páginas com a sua cara.<br>Do primeiro bloco à publicação.</p></div><small>ALVA MARKETING / STUDIO</small></div>
      <div class="access-panel"><form id="access-form"><span class="eyebrow" id="access-eyebrow">BEM-VINDO DE VOLTA</span><h2 id="access-title">Entre no seu Studio.</h2><p id="access-description">Use a conta que você criou para acessar suas páginas.</p><label id="access-name-label" hidden>Seu nome<input name="name" autocomplete="name" maxlength="100"></label><label>E-mail<input name="email" type="email" autocomplete="username" required maxlength="254" placeholder="voce@empresa.com.br"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><label id="access-confirm-label" hidden>Confirme a senha<input name="confirmation" type="password" autocomplete="new-password" maxlength="256"></label><p class="form-error" id="access-error" role="alert"></p><button class="primary" id="access-submit">Entrar</button><p class="access-footnote" id="access-footnote">Suas páginas ficam disponíveis após entrar.</p></form></div>
    </section>
    <dialog id="owner-dialog" class="owner-dialog"><header class="owner-header"><div><span class="eyebrow">ADMINISTRAÇÃO</span><h2>Seu Studio, do seu jeito.</h2></div><button type="button" id="owner-close" aria-label="Fechar administração">Fechar</button></header><div class="owner-tabs" role="tablist" aria-label="Configurações do aplicativo"><button type="button" role="tab" id="tab-account" aria-controls="panel-account" aria-selected="true" data-owner-tab="account">Minha conta</button><button type="button" role="tab" id="tab-vercel" aria-controls="panel-vercel" aria-selected="false" data-owner-tab="vercel">Publicação · Vercel</button></div>
    <section id="panel-account" role="tabpanel" aria-labelledby="tab-account"><form id="account-form"><p class="owner-description">Estes são os dados de acesso do dono do aplicativo.</p><div class="owner-two-col"><label>Seu nome<input name="name" required maxlength="100" autocomplete="name"></label><label>E-mail de acesso<input name="email" type="email" required maxlength="254" autocomplete="username"></label></div><label>Senha atual<input name="currentPassword" type="password" required autocomplete="current-password" placeholder="Confirme para salvar alterações" maxlength="256"></label><details class="owner-password"><summary>Trocar minha senha</summary><div class="owner-two-col"><label>Nova senha<input name="newPassword" type="password" minlength="12" maxlength="256" autocomplete="new-password" placeholder="Pelo menos 12 caracteres"></label><label>Confirme a nova senha<input name="confirmation" type="password" maxlength="256" autocomplete="new-password"></label></div></details><p class="form-error" id="account-error" role="alert"></p><div class="owner-form-actions"><button class="primary">Salvar minha conta</button></div></form><div class="owner-session"><div><strong>Sessão de acesso</strong><p>Encerre o acesso neste navegador quando terminar.</p></div><button type="button" id="owner-logout">Sair da conta</button></div></section>
    <section id="panel-vercel" role="tabpanel" aria-labelledby="tab-vercel" hidden><div class="vercel-intro"><div class="vercel-symbol" aria-hidden="true">▲</div><div><h3>Conecte sua conta Vercel</h3><p>Configure uma vez. Publique cada página em seu próprio projeto e domínio.</p></div></div><p class="connection" id="owner-vercel-status" role="status">Carregando conexão…</p><form id="vercel-form"><label>Token de acesso da Vercel<input name="token" type="password" autocomplete="off" placeholder="Cole seu token de acesso" maxlength="1024"></label><p class="help">O token fica protegido no servidor e não aparece nas páginas. <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">Criar um token na Vercel ↗</a></p><label>Identificador da equipe <span class="optional">(opcional)</span><input name="teamId" placeholder="team_…" autocomplete="off" maxlength="120"></label><p class="help">Preencha se você publica por uma equipe. Para uma conta pessoal, deixe em branco.</p><p class="form-error" id="vercel-error" role="alert"></p><div class="owner-form-actions"><button type="button" id="vercel-test">Testar conexão salva</button><button class="primary">Salvar conexão</button></div></form><div class="owner-session"><p>O domínio e o destino do formulário são configurados dentro de cada página.</p><button type="button" id="vercel-disconnect">Desconectar</button></div></section></dialog>`;
  document.body.append(host);
  const $ = (selector) => host.querySelector(selector);
  const gate = $('#access-gate');
  const accessForm = $('#access-form');
  const dialog = $('#owner-dialog');
  function showAccess(setupRequired = false) {
    if (dialog.open) dialog.close();
    gate.hidden = false;
    gate.dataset.setup = String(setupRequired);
    document.body.classList.add('access-locked');
    $('#access-title').textContent = setupRequired ? 'Crie sua conta de dono.' : 'Entre no seu Studio.';
    $('#access-eyebrow').textContent = setupRequired ? 'PRIMEIRO ACESSO' : 'BEM-VINDO DE VOLTA';
    $('#access-description').textContent = setupRequired
      ? 'Defina seu acesso para administrar o aplicativo. Suas páginas existentes serão preservadas.'
      : 'Use sua conta para continuar criando suas páginas.';
    $('#access-name-label').hidden = !setupRequired;
    $('#access-confirm-label').hidden = !setupRequired;
    accessForm.elements.name.required = setupRequired;
    accessForm.elements.confirmation.required = setupRequired;
    accessForm.elements.password.minLength = setupRequired ? 12 : 1;
    accessForm.elements.password.autocomplete = setupRequired ? 'new-password' : 'current-password';
    $('#access-submit').textContent = setupRequired ? 'Criar conta e começar ↗' : 'Entrar no Studio ↗';
    $('#access-footnote').textContent = setupRequired
      ? 'Escolha uma senha com pelo menos 12 caracteres.'
      : 'Seu acesso é pessoal. Mantenha sua senha em segurança.';
  }
  function hideAccess() {
    gate.hidden = true;
    document.body.classList.remove('access-locked');
    accessForm.reset();
    $('#access-error').textContent = '';
  }
  async function updateSession() {
    session = await api('/session');
    if (session.authenticated) {
      hideAccess();
      const userLabel = document.querySelector('#owner-name');
      if (userLabel) userLabel.textContent = session.owner?.name || 'Minha conta';
      await onAuthenticated(session);
    } else showAccess(Boolean(session.setupRequired));
    return session;
  }
  async function busy(form, errorNode, fn) {
    const buttons = [...form.querySelectorAll('button:not([type=button])')];
    form.inert = true;
    buttons.forEach((button) => (button.disabled = true));
    errorNode.textContent = '';
    try {
      await fn();
    } catch (error) {
      errorNode.textContent = error.message;
    } finally {
      form.inert = false;
      buttons.forEach((button) => (button.disabled = false));
    }
  }
  accessForm.onsubmit = async (event) => {
    event.preventDefault();
    await busy(accessForm, $('#access-error'), async () => {
      const values = Object.fromEntries(new FormData(accessForm));
      const setup = gate.dataset.setup === 'true';
      if (setup) validatePasswordConfirmation(values.password, values.confirmation);
      await api(setup ? '/setup' : '/login', 'POST', {
        email: values.email.trim(),
        password: values.password,
        ...(setup ? { name: values.name.trim() } : {}),
      });
      await updateSession();
    });
  };
  function selectTab(tab) {
    host.querySelectorAll('[data-owner-tab]').forEach((button) => {
      const selected = button.dataset.ownerTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      $('#panel-' + button.dataset.ownerTab).hidden = !selected;
    });
  }
  host.querySelectorAll('[data-owner-tab]').forEach((button) => {
    button.onclick = () => selectTab(button.dataset.ownerTab);
    button.onkeydown = (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const tab = button.dataset.ownerTab === 'account' ? 'vercel' : 'account';
        selectTab(tab);
        $('#tab-' + tab).focus();
      }
    };
  });
  async function refreshSettings() {
    const settings = await api('/settings');
    const vercel = settings.vercel || {};
    const configured = Boolean(vercel.tokenConfigured || vercel.connected);
    const form = $('#vercel-form');
    form.elements.token.value = '';
    form.elements.token.placeholder = configured
      ? 'Token salvo — preencha apenas para substituir'
      : 'Cole seu token de acesso';
    form.elements.teamId.value = vercel.teamId || '';
    $('#owner-vercel-status').textContent = configured
      ? '● Credencial salva. Use “Testar conexão” para conferir o acesso.'
      : '○ Nenhuma conta conectada ainda.';
    $('#vercel-test').disabled = !configured;
    $('#vercel-disconnect').disabled = !configured;
    await onSettingsChanged(settings);
  }
  async function openSettings(tab = 'account') {
    try {
      session = await api('/session');
      if (!session.authenticated) return showAccess(session.setupRequired);
      const form = $('#account-form');
      form.reset();
      form.elements.name.value = session.owner?.name || '';
      form.elements.email.value = session.owner?.email || '';
      $('#account-error').textContent = '';
      $('#vercel-error').textContent = '';
      selectTab(tab);
      if (!dialog.open) dialog.showModal();
      await refreshSettings();
    } catch (error) {
      toast(error.message);
    }
  }
  $('#owner-close').onclick = () => dialog.close();
  $('#account-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await busy(form, $('#account-error'), async () => {
      const values = Object.fromEntries(new FormData(form));
      if (values.newPassword || values.confirmation)
        validatePasswordConfirmation(values.newPassword, values.confirmation);
      const payload = { name: values.name.trim(), email: values.email.trim(), currentPassword: values.currentPassword };
      if (values.newPassword) payload.newPassword = values.newPassword;
      await api('/account', 'PUT', payload);
      form.elements.currentPassword.value = '';
      form.elements.newPassword.value = '';
      form.elements.confirmation.value = '';
      session = await api('/session');
      if (!session.authenticated) {
        showAccess(false);
        toast('Conta atualizada. Entre novamente com seus novos dados.');
        return;
      }
      const label = document.querySelector('#owner-name');
      if (label) label.textContent = session.owner.name;
      toast('Dados da conta atualizados.');
    });
  };
  $('#vercel-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await busy(form, $('#vercel-error'), async () => {
      await api('/settings/vercel', 'PUT', vercelPayload(Object.fromEntries(new FormData(form))));
      form.elements.token.value = '';
      await refreshSettings();
      toast('Conexão salva. Você já pode testar o acesso.');
    });
  };
  $('#vercel-test').onclick = async () => {
    const button = $('#vercel-test');
    button.disabled = true;
    $('#vercel-error').textContent = '';
    try {
      await api('/settings/vercel/test', 'POST', {});
      $('#owner-vercel-status').textContent = '● Conexão verificada com a Vercel.';
      toast('A Vercel confirmou o acesso.');
    } catch (error) {
      $('#vercel-error').textContent = error.message;
      $('#owner-vercel-status').textContent = 'Não foi possível verificar a conexão.';
    } finally {
      button.disabled = false;
    }
  };
  $('#vercel-disconnect').onclick = async () => {
    if (!confirm('Desconectar a Vercel deste Studio? Suas páginas publicadas continuarão no ar.')) return;
    try {
      await api('/settings/vercel', 'PUT', { disconnect: true });
      await refreshSettings();
      toast('Vercel desconectada.');
    } catch (error) {
      $('#vercel-error').textContent = error.message;
    }
  };
  $('#owner-logout').onclick = async () => {
    try {
      await beforeLogout();
      await api('/logout', 'POST', {});
      dialog.close();
      await onLoggedOut();
      session = null;
      showAccess(false);
    } catch (error) {
      $('#account-error').textContent = error.message;
    }
  };
  return { initialize: updateSession, openSettings, sessionExpired: () => showAccess(false) };
}
