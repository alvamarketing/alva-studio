const TYPES = {
  short_text: { label: 'Texto curto', icon: 'text_fields', title: 'Digite sua pergunta' },
  long_text: { label: 'Texto longo', icon: 'notes', title: 'Conte um pouco mais' },
  email: { label: 'E-mail', icon: 'alternate_email', title: 'Qual é o seu melhor e-mail?' },
  phone: { label: 'Telefone', icon: 'phone', title: 'Qual é o seu WhatsApp?' },
  single_choice: { label: 'Escolha única', icon: 'radio_button_checked', title: 'Escolha uma opção' },
  multiple_choice: { label: 'Múltipla escolha', icon: 'checklist', title: 'Escolha uma ou mais opções' },
  image_choice: { label: 'Escolha visual', icon: 'gallery_thumbnail', title: 'Escolha uma opção' },
  date: { label: 'Data', icon: 'calendar_month', title: 'Escolha uma data' },
  number: { label: 'Número', icon: 'numbers', title: 'Informe um número' },
  scale: { label: 'Escala', icon: 'star', title: 'Como você avalia?' },
  address: { label: 'Endereço', icon: 'location_on', title: 'Qual é o endereço?' },
  file: { label: 'Arquivo', icon: 'cloud_upload', title: 'Envie um arquivo' },
  image: { label: 'Imagem', icon: 'image', title: 'Veja esta imagem' },
  video: { label: 'Vídeo', icon: 'play_circle', title: 'Assista antes de continuar' },
  statement: { label: 'Tela informativa', icon: 'campaign', title: 'Uma informação importante' },
  cta: { label: 'Botão / CTA', icon: 'arrow_forward', title: 'Pronto para o próximo passo?' },
  chart: { label: 'Gráfico', icon: 'analytics', title: 'Veja os resultados' },
  loader: { label: 'Análise animada', icon: 'progress_activity', title: 'Estamos analisando suas respostas' },
  logo: { label: 'Logo', icon: 'branding_watermark', title: 'Sua marca' },
  progress: { label: 'Progresso', icon: 'linear_scale', title: 'Progresso da jornada' },
  countdown: { label: 'Contagem regressiva', icon: 'timer', title: 'Esta condição termina em' },
  timer: { label: 'Cronômetro', icon: 'av_timer', title: 'Tempo desta experiência' },
};
const ICONS = [['person', 'Pessoa'], ['phone', 'Telefone'], ['alternate_email', 'E-mail'], ['mail', 'Mensagem'], ['location_on', 'Local'], ['calendar_month', 'Calendário'], ['star', 'Estrela'], ['checklist', 'Lista'], ['task_alt', 'Confirmação'], ['arrow_forward', 'Seta'], ['send', 'Enviar'], ['analytics', 'Gráfico'], ['monitoring', 'Resultados'], ['play_circle', 'Vídeo'], ['image', 'Imagem'], ['cloud_upload', 'Enviar arquivo'], ['campaign', 'Aviso'], ['text_fields', 'Texto'], ['notes', 'Texto longo'], ['numbers', 'Número'], ['radio_button_checked', 'Escolha'], ['home', 'Início'], ['tune', 'Ajustes']];
const MOTIONS = [['none', 'Sem movimento'], ['fade-up', 'Subir suavemente'], ['slide-left', 'Entrar pela lateral'], ['zoom-in', 'Aproximar'], ['float', 'Flutuar']];
const INFORMATIONAL = new Set(['image', 'video', 'statement', 'cta', 'chart', 'loader', 'logo', 'progress', 'countdown', 'timer']);
const HEADER_TYPES = new Set(['logo', 'progress', 'countdown', 'timer', 'statement', 'image', 'video', 'chart', 'cta', 'loader']);
const displayAnswer = (value) => Array.isArray(value) ? value.join(', ') : value && typeof value === 'object' ? value.name || 'Arquivo' : value;

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export function createStep(type = 'short_text', id = `etapa-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`) {
  const selected = TYPES[type] ? type : 'short_text';
  return {
    id,
    type: selected,
    title: TYPES[selected].title,
    description: '',
    required: !INFORMATIONAL.has(selected),
    placeholder: ['single_choice', 'multiple_choice'].includes(selected) ? '' : 'Digite sua resposta',
    options: ['single_choice', 'multiple_choice'].includes(selected) ? ['Opção 1', 'Opção 2'] : selected === 'image_choice' ? [{ label: 'Opção 1', imageUrl: '', icon: 'person' }, { label: 'Opção 2', imageUrl: '', icon: 'business' }] : [],
    icon: TYPES[selected].icon,
    motion: 'fade-up',
    mediaUrl: '',
    altText: selected === 'logo' ? 'Logo' : '',
    width: selected === 'logo' ? 120 : 0,
    showValue: false,
    targetAt: '',
    completionLabel: selected === 'countdown' ? 'Tempo encerrado' : '',
    durationSeconds: selected === 'timer' ? 60 : 0,
    timerDirection: 'down',
    autoStart: selected === 'timer',
    buttonLabel: selected === 'cta' ? 'Continuar' : '',
    buttonUrl: '',
    range: { min: 1, max: 10 },
    chart: { type: 'bar', labels: ['Visitas', 'Contatos', 'Vendas'], values: [72, 48, 86] },
  };
}

export function createScreen(preset = 'blank', id = `tela-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`) {
  const presets = {
    capture: [
      { ...createStep('statement'), title: 'Vamos conhecer você?', description: 'Leva menos de um minuto.', icon: 'waving_hand' },
      { ...createStep('short_text'), title: 'Seu nome', placeholder: 'Como podemos chamar você?' },
      { ...createStep('phone'), title: 'WhatsApp', placeholder: 'DDD + número' },
      { ...createStep('image_choice'), title: 'Como prefere conversar?', options: [{ label: 'WhatsApp', imageUrl: '', icon: 'chat' }, { label: 'Ligação', imageUrl: '', icon: 'call' }] },
    ],
    question: [{ ...createStep('single_choice'), title: 'Qual opção combina mais com você?', options: ['Opção 1', 'Opção 2', 'Opção 3'] }],
    content: [{ ...createStep('statement'), title: 'Conte uma história que conduza a decisão.', description: 'Combine textos, imagens, vídeos e gráficos nesta mesma tela.' }, { ...createStep('image'), title: 'Imagem de apoio' }],
    results: [{ ...createStep('statement'), title: 'Veja o que encontramos', description: 'Apresente o diagnóstico de forma visual.' }, createStep('chart')],
    processing: [{ ...createStep('loader'), title: 'Estamos analisando suas respostas', description: 'Cruzando informações para preparar seu resultado.' }],
    offer: [{ ...createStep('statement'), title: 'Seu próximo passo começa aqui', description: 'Apresente a oferta com clareza.' }, { ...createStep('cta'), title: 'Pronto para avançar?', buttonLabel: 'Quero continuar' }],
    blank: [createStep('statement')],
  };
  return { id, title: ({ capture: 'Boas-vindas', question: 'Pergunta', content: 'Conteúdo', results: 'Resultados', processing: 'Análise', offer: 'Oferta' })[preset] || 'Nova tela', motion: preset === 'processing' ? 'zoom-in' : 'fade-up', autoAdvance: preset === 'question', timer: preset === 'processing' ? 4 : 0, elements: structuredClone(presets[preset] || presets.blank) };
}

function ensureScreens(steps) {
  return steps.map((step, index) => Array.isArray(step.elements) ? step : { id: `tela-${step.id}`, title: `Tela ${index + 1}`, motion: step.motion || 'fade-up', autoAdvance: step.type === 'single_choice', timer: 0, elements: [{ ...step }] });
}

function optionsEditor(step) {
  if (step.type === 'logo') return `<label>Endereço da imagem<input data-field="mediaUrl" type="url" placeholder="https://..." value="${escape(step.mediaUrl)}"></label><label>Descrição da logo<input data-field="altText" maxlength="160" value="${escape(step.altText)}"></label><label>Largura da logo (px)<input data-field-number="width" type="number" min="24" max="600" value="${step.width || 120}"></label>`;
  if (step.type === 'progress') return `<label class="dynamic-check"><input data-field="showValue" type="checkbox"${step.showValue ? ' checked' : ''}> Mostrar porcentagem</label>`;
  if (step.type === 'countdown') return `<label>Data e hora final<input data-field="targetAt" type="datetime-local" value="${escape(step.targetAt ? step.targetAt.slice(0, 16) : '')}"></label><label>Mensagem quando terminar<input data-field="completionLabel" maxlength="120" value="${escape(step.completionLabel)}"></label>`;
  if (step.type === 'timer') return `<label>Duração em segundos<input data-field-number="durationSeconds" type="number" min="1" max="86400" value="${step.durationSeconds || 60}"></label><label>Direção<select data-field="timerDirection"><option value="down"${step.timerDirection !== 'up' ? ' selected' : ''}>Contagem regressiva</option><option value="up"${step.timerDirection === 'up' ? ' selected' : ''}>Cronômetro crescente</option></select></label><label class="dynamic-check"><input data-field="autoStart" type="checkbox"${step.autoStart ? ' checked' : ''}> Iniciar automaticamente</label>`;
  if (['single_choice', 'multiple_choice'].includes(step.type)) return `<label>Opções<textarea data-field="options" rows="6">${escape((step.options || []).join('\n'))}</textarea><small>Uma opção por linha.</small></label>`;
  if (step.type === 'image_choice') return `<label>Opções visuais<textarea data-field="visualOptions" rows="6">${escape((step.options || []).map((option) => `${option.label}|${option.imageUrl || ''}|${option.icon || ''}`).join('\n'))}</textarea><small>Uma por linha: Nome | URL da imagem | ícone Google.</small></label>`;
  if (['image', 'video'].includes(step.type)) return `<label>Endereço da ${step.type === 'image' ? 'imagem' : 'vídeo'}<input data-field="mediaUrl" type="url" placeholder="https://..." value="${escape(step.mediaUrl)}"></label>`;
  if (step.type === 'scale') return `<div class="dynamic-inline"><label>Começa em<input data-range="min" type="number" min="0" max="99" value="${step.range?.min ?? 1}"></label><label>Termina em<input data-range="max" type="number" min="1" max="100" value="${step.range?.max ?? 10}"></label></div>`;
  if (step.type === 'cta') return `<label>Texto do botão<input data-field="buttonLabel" maxlength="80" value="${escape(step.buttonLabel)}"></label><label>Endereço do botão<input data-field="buttonUrl" type="url" placeholder="https://..." value="${escape(step.buttonUrl)}"></label>`;
  if (step.type === 'chart') return `<label>Formato<select data-chart="type"><option value="bar"${step.chart?.type === 'bar' ? ' selected' : ''}>Barras</option><option value="donut"${step.chart?.type === 'donut' ? ' selected' : ''}>Circular</option></select></label><label>Dados do gráfico<textarea data-chart="data" rows="6">${escape((step.chart?.labels || []).map((label, index) => `${label}: ${step.chart.values[index]}`).join('\n'))}</textarea><small>Uma linha por item. Ex.: Visitas: 72</small></label>`;
  if (INFORMATIONAL.has(step.type)) return '';
  return `<label>Exemplo dentro do campo<input data-field="placeholder" maxlength="160" value="${escape(step.placeholder)}"></label>`;
}

function previewAnswer(step) {
  if (step.type === 'logo') return step.mediaUrl ? `<img class="dynamic-preview-logo" src="${escape(step.mediaUrl)}" alt="${escape(step.altText || 'Logo')}" style="width:${step.width || 120}px">` : `<div class="dynamic-preview-logo-placeholder"><span class="material-symbols-outlined">branding_watermark</span> Sua logo</div>`;
  if (step.type === 'progress') return `<div class="dynamic-preview-inline-progress"><span style="width:42%"></span></div>${step.showValue ? '<small class="dynamic-preview-percent">42%</small>' : ''}`;
  if (step.type === 'countdown') return `<div class="dynamic-preview-clock"><strong>03</strong><span>:</span><strong>18</strong><span>:</span><strong>42</strong></div>`;
  if (step.type === 'timer') return `<div class="dynamic-preview-clock"><strong>00</strong><span>:</span><strong>${String(Math.min(59, step.durationSeconds || 60)).padStart(2, '0')}</strong></div>`;
  if (['single_choice', 'multiple_choice'].includes(step.type)) return `<div class="dynamic-preview-choices">${step.options.map((option, index) => `<div><span>${index + 1}</span>${escape(option)}</div>`).join('')}</div>`;
  if (step.type === 'image') return step.mediaUrl ? `<img class="dynamic-preview-media" src="${escape(step.mediaUrl)}" alt="">` : `<div class="dynamic-preview-media dynamic-video-placeholder"><span class="material-symbols-outlined">image</span>Adicione a imagem</div>`;
  if (step.type === 'video') return `<div class="dynamic-preview-media dynamic-video-placeholder"><span class="material-symbols-outlined">play_circle</span>Prévia do vídeo</div>`;
  if (step.type === 'scale') return `<div class="dynamic-preview-scale"><span>${step.range.min}</span><input type="range" min="${step.range.min}" max="${step.range.max}" value="${step.range.min}"><span>${step.range.max}</span></div>`;
  if (step.type === 'chart') return `<div class="dynamic-mini-chart ${step.chart.type}">${step.chart.values.map((value, index) => `<div style="--value:${value}%"><i></i><small>${escape(step.chart.labels[index])}</small></div>`).join('')}</div>`;
  if (step.type === 'cta') return `<div class="dynamic-preview-cta">${escape(step.buttonLabel)}</div>`;
  if (step.type === 'statement') return '<div class="dynamic-preview-statement">Continue quando estiver pronto.</div>';
  if (step.type === 'loader') return '<div class="dynamic-preview-loader"><span></span><strong>Processando…</strong></div>';
  if (step.type === 'image_choice') return `<div class="dynamic-preview-visual-choices">${step.options.map((option) => `<div>${option.imageUrl ? `<img src="${escape(option.imageUrl)}" alt="">` : `<span class="material-symbols-outlined">${escape(option.icon || 'image')}</span>`}<strong>${escape(option.label)}</strong></div>`).join('')}</div>`;
  return `<div class="dynamic-preview-input">${escape(step.placeholder || (step.type === 'file' ? 'Escolher arquivo' : 'Digite sua resposta'))}</div>`;
}

function previewHeaderElement(element, index, selected) {
  let content;
  if (element.type === 'logo') content = element.mediaUrl
    ? `<img src="${escape(element.mediaUrl)}" alt="${escape(element.altText || 'Logo')}" style="width:${element.width || 120}px">`
    : '<span class="dynamic-preview-brand"><i class="material-symbols-outlined">gesture</i><strong>SUA MARCA</strong></span>';
  else if (element.type === 'progress') content = `<span class="dynamic-preview-progress"><i style="width:42%"></i></span>${element.showValue ? '<small>42%</small>' : ''}`;
  else if (['countdown', 'timer'].includes(element.type)) content = `<span class="dynamic-fixed-clock"><i class="material-symbols-outlined">timer</i>${element.type === 'countdown' ? '03:18:42' : '00:60'}</span>`;
  else content = `<span class="dynamic-header-summary"><i class="material-symbols-outlined">${escape(element.icon || TYPES[element.type]?.icon || 'widgets')}</i>${escape(element.title)}</span>`;
  return `<button type="button" data-preview-header="${index}" aria-current="${index === selected}" title="Editar ${escape(TYPES[element.type]?.label || 'elemento')}">${content}</button>`;
}

export function moveStep(steps, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= steps.length) return [...steps];
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function parseOptions(value) {
  return [...new Set(String(value).split('\n').map((item) => item.trim()).filter(Boolean))];
}

export function createFormsUI({ api, toast, onReturnToProject = async () => {} }) {
  const $ = (selector) => document.querySelector(selector);
  let forms = [];
  let current = null;
  let selected = 0;
  let selectedElement = 0;
  let editingHeader = false;
  let dirty = false;

  const setActiveNav = (name) => {
    $('#nav-pages').classList.toggle('nav-active', name === 'pages');
    $('#nav-forms').classList.toggle('nav-active', name === 'forms');
    $('#pages-view').hidden = name !== 'pages';
    $('#forms-view').hidden = name !== 'forms';
  };

  const showPages = () => {
    setActiveNav('pages');
  };

  const showForms = async () => {
    setActiveNav('forms');
    await loadList();
  };

  async function loadList() {
    forms = await api('/forms');
    renderList();
  }

  function renderList() {
    const query = $('#form-search').value.trim().toLocaleLowerCase('pt-BR');
    const filtered = forms.filter((form) => form.name.toLocaleLowerCase('pt-BR').includes(query));
    $('#form-count').textContent = `${forms.length} ${forms.length === 1 ? 'formulário' : 'formulários'}`;
    const list = $('#form-list');
    list.replaceChildren();
    if (!filtered.length) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">↝</div><h2>${forms.length ? 'Nenhum formulário encontrado.' : 'Sua próxima conversa começa aqui.'}</h2><p>${forms.length ? 'Tente buscar por outro nome.' : 'Combine conteúdo, interação e captura em microlanding pages.'}</p></div>`;
      return;
    }
    for (const form of filtered) {
      const card = document.createElement('article');
      card.className = 'page-card form-card';
      card.innerHTML = `<div class="form-card-cover"><span>${form.stepCount}</span><strong>${form.stepCount === 1 ? 'etapa' : 'etapas'}</strong><small>${form.submissionCount} ${form.submissionCount === 1 ? 'resposta' : 'respostas'}</small></div><div class="card-content"><div class="card-top"><h3>${escape(form.name)}</h3><span class="badge">ATIVO</span></div><p>${escape(form.publicPath || 'Ainda não publicado')}</p><div class="card-actions"><button class="edit">Editar formulário ↗</button><button class="duplicate" title="Duplicar formulário">Duplicar</button><button class="delete" title="Excluir formulário">Excluir</button></div></div>`;
      card.querySelector('.edit').onclick = () => run(() => open(form.id));
      card.querySelector('.duplicate').onclick = () =>
        run(async () => {
          await api(`/forms/${form.id}/duplicate`, 'POST', {});
          await loadList();
          toast('Cópia do formulário criada.');
        });
      card.querySelector('.delete').onclick = () =>
        run(async () => {
          if (!confirm(`Excluir “${form.name}” e todas as respostas recebidas?`)) return;
          await api(`/forms/${form.id}`, 'DELETE', {});
          await loadList();
        });
      list.append(card);
    }
  }

  async function run(task) {
    try {
      await task();
    } catch (error) {
      toast(error.message);
    }
  }

  async function open(id) {
    current = await api('/forms/' + id);
    current.steps = ensureScreens(current.steps);
    selected = 0;
    selectedElement = 0;
    editingHeader = false;
    dirty = false;
    $('#dashboard').hidden = true;
    $('#form-editing').hidden = false;
    $('#dynamic-form-name').value = current.name;
    $('#form-save-state').textContent = 'Salvo neste computador';
    renderEditor();
  }

  function markDirty() {
    dirty = true;
    $('#form-save-state').textContent = 'Alterações por salvar';
  }

  async function save() {
    if (!current || !dirty) return current;
    $('#form-save-state').textContent = 'Salvando…';
    current = await api('/forms/' + current.id, 'PUT', {
      revision: current.revision,
      name: current.name,
      headerElements: current.headerElements,
      steps: current.steps,
      completion: current.completion,
      webhook: current.webhook,
    });
    dirty = false;
    $('#form-save-state').textContent = 'Salvo neste computador';
    return current;
  }

  function renderEditor() {
    selected = Math.max(0, Math.min(selected, current.steps.length - 1));
    const screen = current.steps[selected];
    current.headerElements ||= [createStep('logo', 'logo'), createStep('progress', 'progresso')];
    const activeElements = editingHeader ? current.headerElements : screen.elements;
    selectedElement = Math.max(0, Math.min(selectedElement, activeElements.length - 1));
    const element = activeElements[selectedElement];
    const presets = [['capture','Boas-vindas e captura','person_add'],['question','Pergunta com escolhas','quiz'],['content','Conteúdo e mídia','article'],['processing','Análise animada','progress_activity'],['results','Resultado visual','monitoring'],['offer','Oferta e ação','sell']];
    $('#dynamic-editor').innerHTML = `
      <aside class="dynamic-steps-panel">
        <div class="dynamic-panel-title"><span>CONSTRUA A EXPERIÊNCIA</span><h2>Estrutura</h2><p>O topo acompanha a pessoa. As telas mudam durante a conversa.</p></div>
        <button type="button" class="dynamic-fixed-top" aria-label="Editar topo fixo" aria-current="${editingHeader}">
          <span class="material-symbols-outlined">keep</span>
          <div><strong>Topo fixo</strong><small>${current.headerElements.length} ${current.headerElements.length === 1 ? 'elemento' : 'elementos'} em todas as telas</small></div>
          <span class="dynamic-fixed-badge">FIXO</span>
        </button>
        <div class="dynamic-list-heading"><div><span>MICROLANDING PAGES</span><strong>Telas da jornada</strong></div><small>${current.steps.length}</small></div>
        <div class="dynamic-step-list">${current.steps.map((item, index) => `<button class="dynamic-step-button" data-index="${index}" aria-current="${index === selected}"><span>${index + 1}</span><span><strong>${escape(item.title)}</strong><small>${item.elements.length} ${item.elements.length === 1 ? 'elemento' : 'elementos'}</small></span></button>`).join('')}</div>
        <details class="dynamic-screen-catalog"><summary><span class="material-symbols-outlined">add</span> Nova tela</summary><div class="dynamic-add"><span>Comece com uma composição pronta</span>${presets.map(([preset,label,icon]) => `<button data-add-screen="${preset}"><b class="material-symbols-outlined">${icon}</b>${label}</button>`).join('')}</div></details>
      </aside>
      <div class="dynamic-preview-panel"><div class="dynamic-preview-toolbar"><span>PRÉVIA DA EXPERIÊNCIA</span><strong>Tela ${selected + 1} de ${current.steps.length}</strong></div><div id="dynamic-preview"></div></div>
      <aside class="dynamic-properties-panel">
        <div class="dynamic-panel-title"><span>${editingHeader ? 'APARECE EM TODAS AS TELAS' : `EDITANDO A TELA ${selected + 1}`}</span><h2>${editingHeader ? 'Topo fixo' : escape(screen.title)}</h2><p>Clique em um bloco da prévia ou da lista para editar.</p></div>
        ${editingHeader ? '' : `<details class="dynamic-settings-group"><summary><span><b class="material-symbols-outlined">tune</b>Configurações da tela</span><b class="material-symbols-outlined">expand_more</b></summary><div class="dynamic-settings-content">
          <label>Nome da tela<input data-screen-field="title" maxlength="100" value="${escape(screen.title)}"></label>
          <div class="dynamic-inline"><label>Animação de entrada<select data-screen-field="motion">${MOTIONS.map(([value,label]) => `<option value="${value}"${screen.motion === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Avançar após<input data-screen-field="timer" type="number" min="0" max="15" value="${screen.timer || 0}"><small>0 desativa</small></label></div>
          <label class="dynamic-check"><input data-screen-field="autoAdvance" type="checkbox"${screen.autoAdvance ? ' checked' : ''}> Avançar ao marcar uma escolha</label>
          <div class="dynamic-step-actions"><button data-screen-move="-1" aria-label="Mover tela para cima" title="Mover tela para cima"><span class="material-symbols-outlined">arrow_upward</span></button><button data-screen-move="1" aria-label="Mover tela para baixo" title="Mover tela para baixo"><span class="material-symbols-outlined">arrow_downward</span></button><button data-screen-duplicate aria-label="Duplicar tela" title="Duplicar tela"><span class="material-symbols-outlined">content_copy</span></button><button data-screen-delete aria-label="Excluir tela" title="Excluir tela" class="dynamic-danger"><span class="material-symbols-outlined">delete</span></button></div>
        </div></details>`}
        <div class="dynamic-list-heading dynamic-elements-heading"><div><span>${editingHeader ? 'CONTEÚDO FIXO' : 'CONTEÚDO DESTA TELA'}</span><strong>${activeElements.length} ${activeElements.length === 1 ? 'elemento' : 'elementos'}</strong></div></div>
        <div class="dynamic-elements-list">${activeElements.map((item,index) => `<button data-select-element="${index}" aria-current="${index === selectedElement}"><b class="material-symbols-outlined">${TYPES[item.type]?.icon || 'widgets'}</b><span><strong>${escape(item.title)}</strong><small>${TYPES[item.type]?.label || item.type}</small></span><i class="material-symbols-outlined">drag_indicator</i></button>`).join('')}</div>
        <details class="dynamic-element-catalog"><summary><span class="material-symbols-outlined">add</span> ${editingHeader ? 'Adicionar ao topo' : 'Adicionar conteúdo'}</summary><div class="dynamic-add">${Object.entries(TYPES).filter(([type]) => editingHeader ? HEADER_TYPES.has(type) : !['logo', 'progress'].includes(type)).map(([type, meta]) => `<button data-add-type="${type}"><b class="material-symbols-outlined">${meta.icon}</b>${meta.label}</button>`).join('')}</div></details>
        <div class="dynamic-element-editor">
        <div class="dynamic-panel-title"><span>ELEMENTO ${selectedElement + 1}</span><h2>${TYPES[element.type].label}</h2></div>
        <div class="dynamic-step-actions"><button data-element-move="-1" aria-label="Mover elemento para cima" title="Mover elemento para cima"><span class="material-symbols-outlined">arrow_upward</span></button><button data-element-move="1" aria-label="Mover elemento para baixo" title="Mover elemento para baixo"><span class="material-symbols-outlined">arrow_downward</span></button><button data-element-duplicate aria-label="Duplicar elemento" title="Duplicar elemento"><span class="material-symbols-outlined">content_copy</span></button><button data-element-delete aria-label="Excluir elemento" title="Excluir elemento" class="dynamic-danger"><span class="material-symbols-outlined">delete</span></button></div>
        <label>Tipo<select data-field="type">${Object.entries(TYPES).filter(([type]) => !editingHeader || HEADER_TYPES.has(type)).map(([type, meta]) => `<option value="${type}"${element.type === type ? ' selected' : ''}>${meta.label}</option>`).join('')}</select></label>
        <label>Título ou pergunta<input data-field="title" maxlength="180" value="${escape(element.title)}"></label>
        <label>Texto de apoio<textarea data-field="description" maxlength="1200" placeholder="Opcional">${escape(element.description)}</textarea></label>
        ${optionsEditor(element)}
        ${INFORMATIONAL.has(element.type) ? '' : `<label class="dynamic-check"><input data-field="required" type="checkbox"${element.required ? ' checked' : ''}> Resposta obrigatória</label>`}
        <div class="dynamic-customize"><h3>Ícone</h3><label>Ícone Google<select data-field="icon">${ICONS.map(([name, label]) => `<option value="${name}"${(element.icon || TYPES[element.type].icon) === name ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div>
        <details class="dynamic-finish-settings"><summary>Finalização e integração</summary><label>Título final<input data-setting="title" maxlength="120" value="${escape(current.completion.title)}"></label><label>Mensagem final<textarea data-setting="message" maxlength="500">${escape(current.completion.message)}</textarea></label><label>Webhook HTTPS<input data-setting="webhook" type="url" placeholder="https://..." value="${escape(current.webhook)}"></label></details>
        </div>
      </aside>`;
    bindEditor();
    renderPreview();
  }

  function renderPreview() {
    const screen = current.steps[selected];
    $('#dynamic-preview').innerHTML = `<div class="dynamic-preview-browser"><div class="dynamic-preview-fixed">${current.headerElements.map((element, index) => previewHeaderElement(element, index, editingHeader && index === selectedElement)).join('')}</div><div class="dynamic-preview-stage"><div class="dynamic-preview-card dynamic-composed" data-motion="${escape(screen.motion || 'fade-up')}"><p>${escape(screen.title).toUpperCase()}</p><div class="dynamic-preview-elements">${screen.elements.map((element,index) => `<button type="button" class="dynamic-preview-element" data-preview-element="${index}" aria-current="${!editingHeader && index === selectedElement}"><span class="dynamic-preview-icon material-symbols-outlined">${escape(element.icon || TYPES[element.type].icon)}</span><h1>${escape(element.title)}</h1>${element.description ? `<div class="dynamic-preview-description">${escape(element.description)}</div>` : ''}${previewAnswer(element)}<span class="dynamic-edit-hint"><i class="material-symbols-outlined">edit</i> Editar</span></button>`).join('')}</div><button class="dynamic-preview-next">${selected === current.steps.length - 1 ? 'Enviar respostas' : 'Continuar'} <span class="material-symbols-outlined">arrow_forward</span></button></div></div></div>`;
    document.querySelectorAll('[data-preview-header]').forEach((button) => { button.onclick = () => { editingHeader = true; selectedElement = Number(button.dataset.previewHeader); renderEditor(); }; });
    document.querySelectorAll('[data-preview-element]').forEach((button) => { button.onclick = () => { editingHeader = false; selectedElement = Number(button.dataset.previewElement); renderEditor(); }; });
  }

  function bindEditor() {
    const screen = () => current.steps[selected];
    const elements = () => editingHeader ? current.headerElements : screen().elements;
    const element = () => elements()[selectedElement];
    $('.dynamic-fixed-top').onclick = () => { editingHeader = true; selectedElement = 0; renderEditor(); };
    document.querySelectorAll('.dynamic-step-button').forEach((button) => { button.onclick = () => { editingHeader = false; selected = Number(button.dataset.index); selectedElement = 0; renderEditor(); }; });
    document.querySelectorAll('[data-add-screen]').forEach((button) => { button.onclick = () => { current.steps.push(createScreen(button.dataset.addScreen)); selected = current.steps.length - 1; selectedElement = 0; markDirty(); renderEditor(); }; });
    document.querySelectorAll('[data-add-type]').forEach((button) => { button.onclick = () => { elements().push(createStep(button.dataset.addType)); selectedElement = elements().length - 1; markDirty(); renderEditor(); }; });
    document.querySelectorAll('[data-select-element]').forEach((button) => { button.onclick = () => { selectedElement = Number(button.dataset.selectElement); renderEditor(); }; });
    document.querySelectorAll('[data-screen-move]').forEach((button) => { button.onclick = () => { const direction = Number(button.dataset.screenMove), target = selected + direction; if (target < 0 || target >= current.steps.length) return; current.steps = moveStep(current.steps, selected, direction); selected = target; markDirty(); renderEditor(); }; });
    $('[data-screen-duplicate]').onclick = () => { const copy = structuredClone(screen()); copy.id = `tela-${Date.now()}`; copy.elements.forEach((item,index) => { item.id = `elemento-${Date.now()}-${index}`; }); current.steps.splice(selected + 1, 0, copy); selected++; selectedElement = 0; markDirty(); renderEditor(); };
    $('[data-screen-delete]').onclick = () => { if (current.steps.length === 1) return toast('O formulário precisa ter pelo menos uma tela.'); current.steps.splice(selected, 1); selected = Math.min(selected, current.steps.length - 1); selectedElement = 0; markDirty(); renderEditor(); };
    document.querySelectorAll('[data-element-move]').forEach((button) => { button.onclick = () => { const direction = Number(button.dataset.elementMove), target = selectedElement + direction; if (target < 0 || target >= elements().length) return; const reordered = moveStep(elements(), selectedElement, direction); if (editingHeader) current.headerElements = reordered; else screen().elements = reordered; selectedElement = target; markDirty(); renderEditor(); }; });
    $('[data-element-duplicate]').onclick = () => { const copy = structuredClone(element()); copy.id = `elemento-${Date.now()}`; elements().splice(selectedElement + 1, 0, copy); selectedElement++; markDirty(); renderEditor(); };
    $('[data-element-delete]').onclick = () => { if (elements().length === 1) return toast(editingHeader ? 'Mantenha ao menos um elemento no topo.' : 'A tela precisa ter pelo menos um elemento.'); elements().splice(selectedElement, 1); selectedElement = Math.min(selectedElement, elements().length - 1); markDirty(); renderEditor(); };
    document.querySelectorAll('[data-screen-field]').forEach((input) => { input.oninput = () => { const key = input.dataset.screenField; screen()[key] = key === 'autoAdvance' ? input.checked : key === 'timer' ? Number(input.value) : input.value; markDirty(); if (key === 'title' || key === 'motion') renderPreview(); }; });
    document.querySelectorAll('[data-field]').forEach((input) => {
      input.oninput = () => { const key = input.dataset.field; if (['required', 'showValue', 'autoStart'].includes(key)) element()[key] = input.checked; else if (key === 'options') element().options = parseOptions(input.value); else if (key === 'visualOptions') element().options = input.value.split('\n').map((row) => { const [label,imageUrl,icon] = row.split('|').map((part) => part.trim()); return { label, imageUrl: imageUrl || '', icon: icon || 'image' }; }).filter((option) => option.label); else element()[key] = input.value; markDirty(); renderPreview(); };
      if (input.dataset.field === 'type') input.onchange = () => { const before = element(), replacement = createStep(input.value, before.id); replacement.title = before.title; replacement.description = before.description; elements()[selectedElement] = replacement; markDirty(); renderEditor(); };
    });
    document.querySelectorAll('[data-field-number]').forEach((input) => { input.oninput = () => { element()[input.dataset.fieldNumber] = Number(input.value); markDirty(); renderPreview(); }; });
    document.querySelectorAll('[data-range]').forEach((input) => { input.oninput = () => { element().range[input.dataset.range] = Number(input.value); markDirty(); renderPreview(); }; });
    document.querySelectorAll('[data-chart]').forEach((input) => { input.oninput = () => { if (input.dataset.chart === 'type') element().chart.type = input.value; else { const rows = input.value.split('\n').map((row) => row.match(/^\s*(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*$/)).filter(Boolean); element().chart.labels = rows.map((row) => row[1].trim()).slice(0, 8); element().chart.values = rows.map((row) => Math.min(100, Number(row[2]))).slice(0, 8); } markDirty(); renderPreview(); }; });
    document.querySelectorAll('[data-setting]').forEach((input) => { input.oninput = () => { const key = input.dataset.setting; if (key === 'webhook') current.webhook = input.value; else current.completion[key] = input.value; markDirty(); }; });
  }

  async function showResponses() {
    await save();
    const rows = await api(`/forms/${current.id}/submissions`);
    const content = $('#form-responses-content');
    const fields = current.steps.flatMap((screen) => screen.elements || [screen]).filter((element) => !INFORMATIONAL.has(element.type));
    if (!rows.length) content.innerHTML = '<div class="responses-empty"><h3>Nenhuma resposta ainda.</h3><p>Abra o link público e envie um teste para conferir o fluxo.</p></div>';
    else {
      content.innerHTML = `<div class="responses-table-wrap"><table><thead><tr><th>Recebida em</th>${fields.map((field) => `<th>${escape(field.title)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((row) => `<tr><td>${new Date(row.submittedAt).toLocaleString('pt-BR')}</td>${fields.map((field) => `<td>${escape(displayAnswer(row.answers[field.id]))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
    }
    $('#form-responses-dialog').showModal();
  }

  $('#nav-pages').onclick = showPages;
  $('#nav-forms').onclick = () => run(showForms);
  $('#form-search').oninput = renderList;
  $('#new-form').onclick = () => $('#create-form-dialog').showModal();
  $('#dynamic-create-form').onsubmit = (event) =>
    run(async () => {
      event.preventDefault();
      const created = await api('/forms', 'POST', { name: new FormData(event.target).get('name') });
      event.target.reset();
      $('#create-form-dialog').close();
      await open(created.id);
    });
  $('#dynamic-form-name').oninput = () => {
    current.name = $('#dynamic-form-name').value;
    markDirty();
  };
  $('#form-save').onclick = () => run(async () => {
    await save();
    toast('Formulário salvo.');
  });
  $('#form-back').onclick = () => run(async () => {
    const projectId = current?.projectId;
    await save();
    current = null;
    $('#form-editing').hidden = true;
    $('#dashboard').hidden = false;
    await onReturnToProject(projectId);
    await showForms();
  });
  $('#form-public-link').onclick = () => {
    const opened = window.open('about:blank', '_blank');
    if (opened) opened.opener = null;
    run(async () => {
      await save();
      current = await api('/forms/' + current.id + '/publish', 'POST', { revision: current.revision });
      if (opened) opened.location.href = current.publicPath;
      else toast('Permita a abertura de uma nova aba para visualizar o formulário.');
    });
  };
  $('#form-responses').onclick = () => run(showResponses);

  return {
    showPages,
    showForms,
    loadList,
    async closeEditor() {
      await save();
      current = null;
      dirty = false;
      $('#form-editing').hidden = true;
    },
    reset() {
      forms = [];
      current = null;
      dirty = false;
      $('#form-list').replaceChildren();
      $('#form-editing').hidden = true;
    },
  };
}
