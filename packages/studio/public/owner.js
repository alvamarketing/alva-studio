import { confirmarAcao } from './confirm-dialog.js';
export function validatePasswordConfirmation(password, confirmation) {
  if (password !== confirmation) throw new Error('As senhas não conferem. Digite novamente.');
}
export function vercelPayload({ token, teamId }) {
  const payload = { teamId: String(teamId || '').trim() };
  if (String(token || '').trim()) payload.token = String(token).trim();
  return payload;
}
export function settingsAccess({ canManageIntegration = false, requestedTab = 'account' } = {}) {
  const integration = Boolean(canManageIntegration);
  const tab = ['company', 'team', 'billing'].includes(requestedTab) ? requestedTab : 'account';
  return { integration, tab };
}

export function selectSettingsTab({ container, tabList = container, requestedTab = 'account', canManageIntegration = false } = {}) {
  const tab = settingsAccess({ canManageIntegration, requestedTab }).tab;
  tabList.querySelectorAll('[data-settings-sidebar-tab]').forEach((button) => {
    const selected = button.dataset.settingsSidebarTab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    const panel = container.querySelector('#panel-' + button.dataset.settingsSidebarTab);
    if (panel) panel.hidden = !selected;
  });
  return tab;
}

export function createSettingsLoader({ api, canManageIntegration = () => true } = {}) {
  if (typeof api !== 'function') throw new Error('A API de configurações é obrigatória.');
  return async () => canManageIntegration() ? api('/settings') : null;
}
export function createSettingsOpenGuard() {
  let current = 0;
  return { begin: () => ++current, cancel: () => ++current, isCurrent: (request) => request === current };
}

export function createOwnerUI({ api, onAuthenticated, onLoggedOut, onSettingsChanged, onCompanySettings = () => {}, beforeLogout, onSettingsClosed = () => {}, settingsMount, toast, canManageIntegration = () => true }) {
  let session = null;
  const settingsGuard = createSettingsOpenGuard();
  const host = document.createElement('div');
  host.id = 'owner-root';
  host.innerHTML = `
    <section class="access-gate" id="access-gate" aria-label="Acesso ao Alva Studio" hidden>
      <div class="access-story"><a class="brand" href="/" aria-label="Alva Studio"><svg class="brand-symbol" aria-hidden="true" viewBox="0 0 720.5 1000"><use href="#alva-symbol"></use></svg><strong>ALVA</strong><span>Studio</span></a><div><span class="eyebrow">SEU ESPAÇO DE CRIAÇÃO</span><h1>Suas ideias.<br>Sua próxima<br><em>campanha.</em></h1><p>Crie páginas com a sua cara.<br>Do primeiro bloco à publicação.</p></div><small>ALVA MARKETING / STUDIO</small></div>
      <div class="access-panel"><form id="access-form"><span class="eyebrow" id="access-eyebrow">BEM-VINDO DE VOLTA</span><h2 id="access-title">Entre no seu Studio.</h2><p id="access-description">Use a conta que você criou para acessar suas páginas.</p><label id="access-name-label" hidden>Seu nome<input name="name" autocomplete="name" maxlength="100"></label><label>E-mail<input name="email" type="email" autocomplete="username" required maxlength="254" placeholder="voce@empresa.com.br"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><label id="access-confirm-label" hidden>Confirme a senha<input name="confirmation" type="password" autocomplete="new-password" maxlength="256"></label><p class="form-error" id="access-error" role="alert"></p><button class="primary" id="access-submit">Entrar</button><p class="access-footnote" id="access-footnote">Suas páginas ficam disponíveis após entrar.</p></form></div>
    </section>
    <dialog id="owner-dialog" class="owner-dialog"><header class="owner-header"><div><span class="eyebrow">CONFIGURAÇÕES</span><h2>Empresa e equipe<span class="accent">.</span></h2><p class="owner-context"><span aria-hidden="true">✓</span> Conta <strong id="owner-company-name">Alva Marketing</strong></p></div><div class="owner-header-actions"><button type="button" class="primary" id="owner-save">Salvar alterações</button></div></header>
    <section id="panel-account" role="tabpanel"><form id="account-form"><p class="owner-description">Estes são os dados de acesso do dono do aplicativo.</p><div class="owner-two-col"><label>Seu nome<input name="name" required maxlength="100" autocomplete="name"></label><label>E-mail de acesso<input name="email" type="email" required maxlength="254" autocomplete="username"></label></div><label>Senha atual<input name="currentPassword" type="password" required autocomplete="current-password" placeholder="Confirme para salvar alterações" maxlength="256"></label><details class="owner-password"><summary>Trocar minha senha</summary><div class="owner-two-col"><label>Nova senha<input name="newPassword" type="password" minlength="12" maxlength="256" autocomplete="new-password" placeholder="Pelo menos 12 caracteres"></label><label>Confirme a nova senha<input name="confirmation" type="password" maxlength="256" autocomplete="new-password"></label></div></details><p class="form-error" id="account-error" role="alert"></p><div class="owner-form-actions"><button class="primary">Salvar minha conta</button></div></form><section class="owner-publication" aria-labelledby="account-publication-title"><div><strong id="account-publication-title">Publicação</strong><p>Conecte a Vercel para publicar páginas e configurar domínios por projeto.</p></div><button type="button" id="account-publication" aria-controls="account-publication-settings" aria-expanded="false">Configurar publicação</button></section><section id="account-publication-settings" class="owner-publication-settings" aria-labelledby="account-publication-settings-title" hidden><div class="vercel-intro"><div class="vercel-symbol" aria-hidden="true">▲</div><div><h3 id="account-publication-settings-title" tabindex="-1">Conecte sua conta Vercel</h3><p>Configure uma vez. Publique cada página em seu próprio projeto e domínio.</p></div></div><p class="connection" id="owner-vercel-status" role="status">Carregando conexão…</p><form id="vercel-form"><label>Token de acesso da Vercel<input name="token" type="password" autocomplete="off" placeholder="Cole seu token de acesso" maxlength="1024"></label><p class="help">O token fica protegido no servidor e não aparece nas páginas. <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">Criar um token na Vercel ↗</a></p><label>Identificador da equipe <span class="optional">(opcional)</span><input name="teamId" placeholder="team_…" autocomplete="off" maxlength="120"></label><p class="help">Preencha se você publica por uma equipe. Para uma conta pessoal, deixe em branco.</p><p class="form-error" id="vercel-error" role="alert"></p><div class="owner-form-actions"><button type="button" id="vercel-test">Testar conexão salva</button><button class="primary">Salvar conexão</button></div></form><div class="owner-session"><p>O domínio e o destino do formulário são configurados dentro de cada página.</p><button type="button" id="vercel-disconnect">Desconectar</button></div></section><div class="owner-session"><div><strong>Sessão de acesso</strong><p>Encerre o acesso neste navegador quando terminar.</p></div><button type="button" id="owner-logout">Sair da conta</button></div></section></dialog>`;
  document.body.append(host);
  const dialogNode = host.querySelector('#owner-dialog');
  const settingsContainer = settingsMount || host;
  if (dialogNode?.tagName === 'DIALOG') {
    const section = document.createElement('section');
    for (const attribute of dialogNode.attributes) section.setAttribute(attribute.name, attribute.value);
    section.innerHTML = dialogNode.innerHTML;
    section.hidden = true;
    section.setAttribute('aria-labelledby', 'owner-settings-title');
    section.querySelector('.owner-header h2')?.setAttribute('id', 'owner-settings-title');
    Object.defineProperty(section, 'open', { get: () => !section.hidden });
    section.showModal = () => { section.hidden = false; };
    section.close = () => { section.hidden = true; };
    if (settingsMount) {
      settingsMount.append(section);
      dialogNode.remove();
    } else dialogNode.replaceWith(section);
  }
  const $ = (selector) => settingsContainer.querySelector(selector) || host.querySelector(selector);
  const ownerHeader = $('#owner-dialog .owner-header');
  const existingSettingsHeader = settingsMount?.querySelector('.dashboard-header');
  if (ownerHeader && existingSettingsHeader) {
    existingSettingsHeader.replaceWith(ownerHeader);
    settingsMount.setAttribute('aria-labelledby', 'owner-settings-title');
  }
  const companyPanel = document.createElement('section');
  companyPanel.id = 'panel-company';
  companyPanel.setAttribute('role', 'tabpanel');
  companyPanel.setAttribute('aria-labelledby', 'tab-company');
  companyPanel.hidden = true;
  companyPanel.innerHTML = '<section class="company-details" aria-labelledby="company-details-title"><div class="surface-head"><h2 id="company-details-title">Dados da empresa</h2></div><label>Nome da empresa<input id="company-details-name" readonly value="Carregando empresa…"></label><label>Domínio padrão<input id="company-details-domain" readonly placeholder="Não informado no cadastro da empresa"></label><label>Fuso deste navegador<input id="company-details-timezone" readonly placeholder="Não disponível neste navegador"></label><p>Contexto local deste dispositivo; não é uma preferência salva da empresa.</p></section><div class="settings-company-summary"><strong>EMPRESA</strong><span id="settings-company-name">Carregando empresa…</span><small id="settings-company-role"></small></div><p id="settings-company-status" class="dashboard-status" role="status" aria-live="polite"></p><div id="settings-company-content" class="company-overview"></div>';
  const teamPanel = document.createElement('section');
  teamPanel.id = 'panel-team';
  teamPanel.setAttribute('role', 'tabpanel');
  teamPanel.setAttribute('aria-labelledby', 'tab-team');
  teamPanel.hidden = true;
  const billingPanel = document.createElement('section');
  billingPanel.id = 'panel-billing';
  billingPanel.setAttribute('role', 'tabpanel');
  billingPanel.setAttribute('aria-labelledby', 'tab-billing');
  billingPanel.hidden = true;
  $('#owner-dialog')?.append(companyPanel, teamPanel, billingPanel);
  const placeCompanyContent = (section = 'company') => {
    const content = $('#settings-company-content');
    if (!content) return;
    const destination = section === 'team' ? teamPanel : section === 'billing' ? billingPanel : companyPanel;
    if (content.parentElement !== destination) destination.append(content);
  };
  const companyName = $('#owner-company-name');
  const companyDetailsName = $('#company-details-name');
  const companyDetailsDomain = $('#company-details-domain');
  const companyDetailsTimezone = $('#company-details-timezone');
  const companySummaryName = $('#settings-company-name');
  const sidebarInitials = (name = '') => String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'AM';
  const syncCompanyDetails = () => {
    const name = companySummaryName?.textContent?.trim() || 'Empresa atual';
    if (companyName) companyName.textContent = name;
    if (companyDetailsName) companyDetailsName.value = name;
    if (companyDetailsDomain) {
      companyDetailsDomain.value = '';
    }
    if (companyDetailsTimezone) {
      companyDetailsTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    }
    const sidebarName = settingsSidebar?.querySelector('[data-settings-company-name]');
    const sidebarAvatar = settingsSidebar?.querySelector('[data-settings-company-avatar]');
    if (sidebarName) sidebarName.textContent = name;
    if (sidebarAvatar) sidebarAvatar.textContent = sidebarInitials(name);
  };
  if (companyName && companySummaryName && typeof MutationObserver !== 'undefined') {
    new MutationObserver(syncCompanyDetails).observe(companySummaryName, { childList: true, characterData: true, subtree: true });
  }
  const syncTeamInvitationState = () => {
    const team = $('#settings-company-content')?.querySelector('.company-overview-section:has(.member-list)');
    if (!team || team.querySelector('.member-invite-note')) return;
    const note = document.createElement('p');
    note.className = 'member-invite-note';
    note.textContent = 'Convites estarão disponíveis quando a gestão de equipe for configurada neste Studio.';
    team.querySelector('h2')?.after(note);
  };
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(syncTeamInvitationState).observe($('#settings-company-content'), { childList: true, subtree: true });
  }
  const gate = $('#access-gate');
  const accessForm = $('#access-form');
  const dialog = $('#owner-dialog');
  const sidebar = document.querySelector('#studio-sidebar');
  let sidebarNodes = null;
  let settingsSidebar = null;
  const settingsSidebarTabs = () => [...document.querySelectorAll('.settings-tabs [data-settings-sidebar-tab]')];
  function updateSettingsSidebar(tab) {
    for (const button of settingsSidebarTabs()) {
      const selected = button.dataset.settingsSidebarTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    syncCompanyDetails();
  }
  function restoreSettingsShell() {
    if (!sidebar || !sidebarNodes) return;
    sidebar.replaceChildren(...sidebarNodes);
    sidebarNodes = null;
    settingsSidebar = null;
    sidebar.classList.remove('settings-shell');
    sidebar.removeAttribute('aria-label');
  }
  function activateSettingsShell(tab = 'company') {
    if (!sidebar || !settingsMount) return;
    if (!sidebarNodes) {
      sidebarNodes = [...sidebar.childNodes];
      sidebar.replaceChildren();
      sidebar.classList.add('settings-shell');
      sidebar.setAttribute('aria-label', 'Configurações');
      const brand = document.createElement('div');
      brand.className = 'brand settings-sidebar-brand';
      brand.innerHTML = '<svg class="brand-symbol" aria-hidden="true" viewBox="0 0 720.5 1000"><use href="#alva-symbol"></use></svg><strong>ALVA</strong><span>Studio</span>';
      const account = document.createElement('button');
      account.type = 'button';
      account.className = 'settings-account-switcher';
      account.setAttribute('aria-label', 'Conta atual');
      account.onclick = () => selectTab('company');
      account.innerHTML = '<span class="settings-account-avatar" aria-hidden="true" data-settings-company-avatar>AM</span><span><strong data-settings-company-name>Alva Marketing</strong><small>Conta</small></span>';
      const label = document.createElement('div');
      label.className = 'workspace-label';
      label.textContent = 'CONFIGURAÇÕES';
      const nav = document.createElement('div');
      nav.className = 'settings-tabs';
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-label', 'Áreas de configurações');
      nav.setAttribute('aria-orientation', 'horizontal');
      const items = [
        ['account', 'Preferências', 'tune'],
        ['company', 'Empresa', 'corporate_fare'],
        ['team', 'Equipe e acessos', 'group'],
        ['billing', 'Plano e cobrança', 'credit_card'],
      ];
      for (const [key, text, icon] of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-tab';
        button.setAttribute('role', 'tab');
        button.id = 'settings-sidebar-tab-' + key;
        button.setAttribute('aria-controls', 'panel-' + key);
        button.dataset.settingsSidebarTab = key;
        button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">' + icon + '</span><span>' + text + '</span>';
        button.onclick = () => selectTab(key);
        button.onkeydown = (event) => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const tabs = settingsSidebarTabs();
          const index = tabs.indexOf(button);
          const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
          const next = tabs[targetIndex];
          if (next) { selectTab(next.dataset.settingsSidebarTab); next.focus(); }
        };
        nav.append(button);
        $('#panel-' + key)?.setAttribute('aria-labelledby', button.id);
      }
      const footer = document.createElement('div');
      footer.className = 'sidebar-footer settings-sidebar-footer';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'sidebar-toggle settings-sidebar-back';
      back.setAttribute('aria-label', 'Voltar ao Studio');
      back.title = 'Voltar ao Studio';
      back.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">home</span>';
      back.onclick = () => closeSettings();
      footer.append(back);
      sidebar.append(brand, account, label, footer);
      const cabecalho = settingsMount.querySelector('.owner-header');
      if (cabecalho) cabecalho.after(nav);
      else settingsMount.prepend(nav);
      settingsSidebar = sidebar;
    }
    updateSettingsSidebar(tab);
  }
  const loadSettings = createSettingsLoader({ api, canManageIntegration });
  function showAccess(setupRequired = false) {
    restoreSettingsShell();
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
  function selectTab(requestedTab) {
    const publicationVisible = requestedTab === 'vercel' && canManageIntegration();
    const faixaDeAbas = settingsContainer.querySelector?.('.settings-tabs') || document.querySelector('.settings-tabs') || settingsContainer;
    const tab = selectSettingsTab({ container: settingsContainer, tabList: faixaDeAbas, requestedTab, canManageIntegration: canManageIntegration() });
    updateSettingsSidebar(tab);
    const publicationSettings = $('#account-publication-settings');
    if (publicationSettings) publicationSettings.hidden = !publicationVisible;
    $('#account-publication')?.setAttribute('aria-expanded', String(publicationVisible));
    if (['company', 'team', 'billing'].includes(tab)) {
      placeCompanyContent(tab);
      syncCompanyDetails();
      onCompanySettings();
    }
    const saveButton = $('#owner-save');
    if (saveButton) saveButton.hidden = tab !== 'account';
  }
  function applyIntegrationAccess(requestedTab) {
    const access = settingsAccess({ canManageIntegration: canManageIntegration(), requestedTab });
    const publication = $('#account-publication');
    if (publication) publication.hidden = !access.integration;
    if (!access.integration) $('#account-publication-settings').hidden = true;
    return { ...access, publication: access.integration && requestedTab === 'vercel' };
  }
  async function refreshSettings() {
    const settings = await loadSettings();
    if (!settings) return null;
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
  async function openSettings(tab = 'company') {
    const request = settingsGuard.begin();
    try {
      session = await api('/session');
      if (!settingsGuard.isCurrent(request)) return;
      if (!session.authenticated) return showAccess(session.setupRequired);
      const form = $('#account-form');
      form.reset();
      form.elements.name.value = session.owner?.name || '';
      form.elements.email.value = session.owner?.email || '';
      $('#account-error').textContent = '';
      $('#vercel-error').textContent = '';
      const requestedTab = tab === 'account' ? 'company' : tab;
      const access = applyIntegrationAccess(requestedTab);
      activateSettingsShell(access.tab);
      selectTab(access.publication ? 'vercel' : access.tab);
      if (!settingsGuard.isCurrent(request)) return;
      if (!dialog.open) dialog.showModal();
      (settingsSidebarTabs().find((button) => button.dataset.settingsSidebarTab === access.tab) || dialog.querySelector('h2'))?.focus();
      if (access.integration) {
        await refreshSettings();
        if (!settingsGuard.isCurrent(request)) return;
      }
    } catch (error) {
      toast(error.message);
    }
  }
  function closeSettings({ notify = true } = {}) {
    settingsGuard.cancel();
    dialog.close();
    restoreSettingsShell();
    if (notify) onSettingsClosed();
  }
  $('#owner-save').onclick = () => {
    const selected = settingsSidebar?.querySelector('[data-settings-sidebar-tab][aria-selected="true"]')?.dataset.settingsSidebarTab;
    if (selected !== 'account') return;
    if (!$('#account-publication-settings').hidden) $('#vercel-form').requestSubmit();
    else $('#account-form').requestSubmit();
  };
  $('#account-publication').onclick = () => {
    selectTab('vercel');
    $('#account-publication-settings-title')?.focus();
  };
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
      if (!canManageIntegration()) return;
      await api('/settings/vercel', 'PUT', vercelPayload(Object.fromEntries(new FormData(form))));
      form.elements.token.value = '';
      await refreshSettings();
      toast('Conexão salva. Você já pode testar o acesso.');
    });
  };
  $('#vercel-test').onclick = async () => {
    if (!canManageIntegration()) return;
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
    if (!canManageIntegration()) return;
    if (!(await confirmarAcao({ titulo: 'Desconectar a Vercel?', descricao: 'As páginas já publicadas continuam no ar; novas publicações ficam indisponíveis até reconectar.', confirmar: 'Desconectar', perigo: true }))) return;
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
  return { initialize: updateSession, openSettings, closeSettings, sessionExpired: () => showAccess(false) };
}
