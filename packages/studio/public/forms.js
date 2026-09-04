const TYPES = {
  short_text: { label: 'Texto curto', icon: 'text_fields', title: 'Digite sua pergunta' },
  long_text: { label: 'Texto longo', icon: 'notes', title: 'Conte um pouco mais' },
  email: { label: 'E-mail', icon: 'alternate_email', title: 'Qual é o seu melhor e-mail?' },
  phone: { label: 'Telefone', icon: 'phone', title: 'Qual é o seu WhatsApp?' },
  single_choice: { label: 'Escolha única', icon: 'radio_button_checked', title: 'Escolha uma opção' },
  multiple_choice: { label: 'Múltipla escolha', icon: 'checklist', title: 'Escolha uma ou mais opções' },
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
};
const ICONS = [['person', 'Pessoa'], ['phone', 'Telefone'], ['alternate_email', 'E-mail'], ['mail', 'Mensagem'], ['location_on', 'Local'], ['calendar_month', 'Calendário'], ['star', 'Estrela'], ['checklist', 'Lista'], ['task_alt', 'Confirmação'], ['arrow_forward', 'Seta'], ['send', 'Enviar'], ['analytics', 'Gráfico'], ['monitoring', 'Resultados'], ['play_circle', 'Vídeo'], ['image', 'Imagem'], ['cloud_upload', 'Enviar arquivo'], ['campaign', 'Aviso'], ['text_fields', 'Texto'], ['notes', 'Texto longo'], ['numbers', 'Número'], ['radio_button_checked', 'Escolha'], ['home', 'Início'], ['tune', 'Ajustes']];
const MOTIONS = [['none', 'Sem movimento'], ['fade-up', 'Subir suavemente'], ['slide-left', 'Entrar pela lateral'], ['zoom-in', 'Aproximar'], ['float', 'Flutuar']];
const INFORMATIONAL = new Set(['image', 'video', 'statement', 'cta', 'chart']);
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
    options: ['single_choice', 'multiple_choice'].includes(selected) ? ['Opção 1', 'Opção 2'] : [],
    icon: TYPES[selected].icon,
    motion: 'fade-up',
    mediaUrl: '',
    buttonLabel: selected === 'cta' ? 'Continuar' : '',
    buttonUrl: '',
    range: { min: 1, max: 10 },
    chart: { type: 'bar', labels: ['Visitas', 'Contatos', 'Vendas'], values: [72, 48, 86] },
  };
}

function optionsEditor(step) {
  if (['single_choice', 'multiple_choice'].includes(step.type)) return `<label>Opções<textarea data-field="options" rows="6">${escape((step.options || []).join('\n'))}</textarea><small>Uma opção por linha.</small></label>`;
  if (['image', 'video'].includes(step.type)) return `<label>Endereço da ${step.type === 'image' ? 'imagem' : 'vídeo'}<input data-field="mediaUrl" type="url" placeholder="https://..." value="${escape(step.mediaUrl)}"></label>`;
  if (step.type === 'scale') return `<div class="dynamic-inline"><label>Começa em<input data-range="min" type="number" min="0" max="99" value="${step.range?.min ?? 1}"></label><label>Termina em<input data-range="max" type="number" min="1" max="100" value="${step.range?.max ?? 10}"></label></div>`;
  if (step.type === 'cta') return `<label>Texto do botão<input data-field="buttonLabel" maxlength="80" value="${escape(step.buttonLabel)}"></label><label>Endereço do botão<input data-field="buttonUrl" type="url" placeholder="https://..." value="${escape(step.buttonUrl)}"></label>`;
  if (step.type === 'chart') return `<label>Formato<select data-chart="type"><option value="bar"${step.chart?.type === 'bar' ? ' selected' : ''}>Barras</option><option value="donut"${step.chart?.type === 'donut' ? ' selected' : ''}>Circular</option></select></label><label>Dados do gráfico<textarea data-chart="data" rows="6">${escape((step.chart?.labels || []).map((label, index) => `${label}: ${step.chart.values[index]}`).join('\n'))}</textarea><small>Uma linha por item. Ex.: Visitas: 72</small></label>`;
  if (INFORMATIONAL.has(step.type)) return '';
  return `<label>Exemplo dentro do campo<input data-field="placeholder" maxlength="160" value="${escape(step.placeholder)}"></label>`;
}

function previewAnswer(step) {
  if (['single_choice', 'multiple_choice'].includes(step.type)) return `<div class="dynamic-preview-choices">${step.options.map((option, index) => `<div><span>${index + 1}</span>${escape(option)}</div>`).join('')}</div>`;
  if (step.type === 'image') return step.mediaUrl ? `<img class="dynamic-preview-media" src="${escape(step.mediaUrl)}" alt="">` : `<div class="dynamic-preview-media dynamic-video-placeholder"><span class="material-symbols-outlined">image</span>Adicione a imagem</div>`;
  if (step.type === 'video') return `<div class="dynamic-preview-media dynamic-video-placeholder"><span class="material-symbols-outlined">play_circle</span>Prévia do vídeo</div>`;
  if (step.type === 'scale') return `<div class="dynamic-preview-scale"><span>${step.range.min}</span><input type="range" min="${step.range.min}" max="${step.range.max}" value="${step.range.min}"><span>${step.range.max}</span></div>`;
  if (step.type === 'chart') return `<div class="dynamic-mini-chart ${step.chart.type}">${step.chart.values.map((value, index) => `<div style="--value:${value}%"><i></i><small>${escape(step.chart.labels[index])}</small></div>`).join('')}</div>`;
  if (step.type === 'cta') return `<div class="dynamic-preview-cta">${escape(step.buttonLabel)}</div>`;
  if (step.type === 'statement') return '<div class="dynamic-preview-statement">Continue quando estiver pronto.</div>';
  return `<div class="dynamic-preview-input">${escape(step.placeholder || (step.type === 'file' ? 'Escolher arquivo' : 'Digite sua resposta'))}</div>`;
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

export function createFormsUI({ api, toast }) {
  const $ = (selector) => document.querySelector(selector);
  let forms = [];
  let current = null;
  let selected = 0;
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
      list.innerHTML = `<div class="empty"><div class="empty-icon">↝</div><h2>${forms.length ? 'Nenhum formulário encontrado.' : 'Sua próxima conversa começa aqui.'}</h2><p>${forms.length ? 'Tente buscar por outro nome.' : 'Crie uma sequência simples de perguntas e compartilhe o link.'}</p></div>`;
      return;
    }
    for (const form of filtered) {
      const card = document.createElement('article');
      card.className = 'page-card form-card';
      card.innerHTML = `<div class="form-card-cover"><span>${form.stepCount}</span><strong>${form.stepCount === 1 ? 'etapa' : 'etapas'}</strong><small>${form.submissionCount} ${form.submissionCount === 1 ? 'resposta' : 'respostas'}</small></div><div class="card-content"><div class="card-top"><h3>${escape(form.name)}</h3><span class="badge">ATIVO</span></div><p>/f/${escape(form.slug)}</p><div class="card-actions"><button class="edit">Editar formulário ↗</button><button class="duplicate" title="Duplicar formulário">Duplicar</button><button class="delete" title="Excluir formulário">Excluir</button></div></div>`;
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
    selected = 0;
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
    const step = current.steps[selected];
    $('#dynamic-editor').innerHTML = `
      <aside class="dynamic-steps-panel">
        <div class="dynamic-panel-title"><span>JORNADA</span><h2>Etapas</h2><p>Uma pergunta por vez.</p></div>
        <div class="dynamic-step-list">${current.steps
          .map(
            (item, index) =>
              `<button class="dynamic-step-button" data-index="${index}" aria-current="${index === selected}"><span>${index + 1}</span><span><strong>${escape(item.title)}</strong><small>${TYPES[item.type]?.label || 'Texto curto'}</small></span></button>`,
          )
          .join('')}</div>
        <div class="dynamic-add"><span>Adicionar etapa</span>${Object.entries(TYPES)
          .map(([type, meta]) => `<button data-add-type="${type}" title="Adicionar ${meta.label}"><b class="material-symbols-outlined">${meta.icon}</b>${meta.label}</button>`)
          .join('')}</div>
      </aside>
      <div class="dynamic-preview-panel"><div class="dynamic-preview-toolbar"><span>PRÉVIA</span><strong>${selected + 1} / ${current.steps.length}</strong></div><div id="dynamic-preview"></div></div>
      <aside class="dynamic-properties-panel">
        <div class="dynamic-panel-title"><span>EDITAR ETAPA ${selected + 1}</span><h2>${TYPES[step.type].label}</h2></div>
        <div class="dynamic-step-actions"><button data-move="-1" aria-label="Mover etapa acima" title="Mover acima">↑</button><button data-move="1" aria-label="Mover etapa abaixo" title="Mover abaixo">↓</button><button data-duplicate aria-label="Duplicar etapa" title="Duplicar">▣</button><button data-delete aria-label="Excluir etapa" title="Excluir">♲</button></div>
        <label>Tipo de resposta<select data-field="type">${Object.entries(TYPES)
          .map(([type, meta]) => `<option value="${type}"${step.type === type ? ' selected' : ''}>${meta.label}</option>`)
          .join('')}</select></label>
        <label>Pergunta<input data-field="title" maxlength="180" value="${escape(step.title)}"></label>
        <label>Texto de apoio<textarea data-field="description" maxlength="500" placeholder="Opcional">${escape(step.description)}</textarea></label>
        ${optionsEditor(step)}
        ${INFORMATIONAL.has(step.type) ? '' : `<label class="dynamic-check"><input data-field="required" type="checkbox"${step.required ? ' checked' : ''}> Resposta obrigatória</label>`}
        <div class="dynamic-customize"><h3>Ícone e movimento</h3><label>Ícone<select data-field="icon">${ICONS.map(([name, label]) => `<option value="${name}"${(step.icon || TYPES[step.type].icon) === name ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Entrada da etapa<select data-field="motion">${MOTIONS.map(([value, label]) => `<option value="${value}"${(step.motion || 'fade-up') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div>
        <details class="dynamic-finish-settings"><summary>Finalização e integração</summary><label>Título final<input data-setting="title" maxlength="120" value="${escape(current.completion.title)}"></label><label>Mensagem final<textarea data-setting="message" maxlength="500">${escape(current.completion.message)}</textarea></label><label>Webhook HTTPS<input data-setting="webhook" type="url" placeholder="https://..." value="${escape(current.webhook)}"></label></details>
      </aside>`;
    bindEditor();
    renderPreview();
  }

  function renderPreview() {
    const step = current.steps[selected];
    const answer = previewAnswer(step);
    $('#dynamic-preview').innerHTML = `<div class="dynamic-preview-card" data-motion="${escape(step.motion || 'fade-up')}"><div class="dynamic-preview-progress"><span style="width:${((selected + 1) / current.steps.length) * 100}%"></span></div><span class="dynamic-preview-icon material-symbols-outlined">${escape(step.icon || TYPES[step.type].icon)}</span><p>ETAPA ${selected + 1} DE ${current.steps.length}</p><h1>${escape(step.title)}</h1>${step.description ? `<div class="dynamic-preview-description">${escape(step.description)}</div>` : ''}${answer}<button>${selected === current.steps.length - 1 ? 'Enviar respostas' : 'Continuar'} →</button></div>`;
  }

  function bindEditor() {
    document.querySelectorAll('.dynamic-step-button').forEach((button) => {
      button.onclick = () => {
        selected = Number(button.dataset.index);
        renderEditor();
      };
    });
    document.querySelectorAll('[data-add-type]').forEach((button) => {
      button.onclick = () => {
        current.steps.push(createStep(button.dataset.addType));
        selected = current.steps.length - 1;
        markDirty();
        renderEditor();
      };
    });
    document.querySelectorAll('[data-move]').forEach((button) => {
      button.onclick = () => {
        const direction = Number(button.dataset.move);
        const target = selected + direction;
        if (target < 0 || target >= current.steps.length) return;
        current.steps = moveStep(current.steps, selected, direction);
        selected = target;
        markDirty();
        renderEditor();
      };
    });
    $('[data-duplicate]').onclick = () => {
      const copy = structuredClone(current.steps[selected]);
      copy.id = `etapa-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
      current.steps.splice(selected + 1, 0, copy);
      selected++;
      markDirty();
      renderEditor();
    };
    $('[data-delete]').onclick = () => {
      if (current.steps.length === 1) return toast('O formulário precisa ter pelo menos uma etapa.');
      current.steps.splice(selected, 1);
      selected = Math.min(selected, current.steps.length - 1);
      markDirty();
      renderEditor();
    };
    document.querySelectorAll('[data-field]').forEach((input) => {
      input.oninput = () => {
        const key = input.dataset.field;
        if (key === 'required') current.steps[selected].required = input.checked;
        else if (key === 'options') current.steps[selected].options = parseOptions(input.value);
        else current.steps[selected][key] = input.value;
        markDirty();
        renderPreview();
      };
      if (input.dataset.field === 'type') {
        input.onchange = () => {
          const replacement = createStep(input.value, current.steps[selected].id);
          replacement.title = current.steps[selected].title;
          replacement.description = current.steps[selected].description;
          current.steps[selected] = replacement;
          markDirty();
          renderEditor();
        };
      }
    });
    document.querySelectorAll('[data-range]').forEach((input) => {
      input.oninput = () => { current.steps[selected].range[input.dataset.range] = Number(input.value); markDirty(); renderPreview(); };
    });
    document.querySelectorAll('[data-chart]').forEach((input) => {
      input.oninput = () => {
        if (input.dataset.chart === 'type') current.steps[selected].chart.type = input.value;
        else {
          const rows = input.value.split('\n').map((row) => row.match(/^\s*(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*$/)).filter(Boolean);
          current.steps[selected].chart.labels = rows.map((row) => row[1].trim()).slice(0, 8);
          current.steps[selected].chart.values = rows.map((row) => Math.min(100, Number(row[2]))).slice(0, 8);
        }
        markDirty(); renderPreview();
      };
    });
    document.querySelectorAll('[data-setting]').forEach((input) => {
      input.oninput = () => {
        const key = input.dataset.setting;
        if (key === 'webhook') current.webhook = input.value;
        else current.completion[key] = input.value;
        markDirty();
      };
    });
  }

  async function showResponses() {
    await save();
    const rows = await api(`/forms/${current.id}/submissions`);
    const content = $('#form-responses-content');
    if (!rows.length) content.innerHTML = '<div class="responses-empty"><h3>Nenhuma resposta ainda.</h3><p>Abra o link público e envie um teste para conferir o fluxo.</p></div>';
    else {
      content.innerHTML = `<div class="responses-table-wrap"><table><thead><tr><th>Recebida em</th>${current.steps.map((step) => `<th>${escape(step.title)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((row) => `<tr><td>${new Date(row.submittedAt).toLocaleString('pt-BR')}</td>${current.steps.map((step) => `<td>${escape(displayAnswer(row.answers[step.id]))}</td>`).join('')}</tr>`)
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
    await save();
    current = null;
    $('#form-editing').hidden = true;
    $('#dashboard').hidden = false;
    await showForms();
  });
  $('#form-public-link').onclick = () => {
    const opened = window.open('about:blank', '_blank');
    if (opened) opened.opener = null;
    run(async () => {
      await save();
      if (opened) opened.location.href = '/f/' + current.slug;
      else toast('Permita a abertura de uma nova aba para visualizar o formulário.');
    });
  };
  $('#form-responses').onclick = () => run(showResponses);

  return {
    showPages,
    showForms,
    loadList,
    reset() {
      forms = [];
      current = null;
      dirty = false;
      $('#form-list').replaceChildren();
      $('#form-editing').hidden = true;
    },
  };
}
