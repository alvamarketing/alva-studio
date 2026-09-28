// Gera public/icones.js: os ícones da interface do Studio, todos do Lucide (decisão do dono
// em 28/09/2026 — o menu misturava SVG à mão, Material Symbols e Lucide). A interface é
// JavaScript puro, então o SVG de cada ícone vai pronto no módulo, sem biblioteca no
// navegador. Rodar de novo quando entrar ícone novo: `npm run build:icones`.
import { writeFile } from 'node:fs/promises';
import * as lucide from 'lucide';

// Nome usado no markup (o nome antigo do Material Symbols, para o markup não mudar) → Lucide.
const MAPA = {
  dashboard: 'LayoutDashboard', grid_view: 'LayoutGrid', paginas: 'PanelsTopLeft', quizzes: 'ListChecks', account_tree: 'Workflow',
  play_circle: 'CirclePlay', monitoring: 'ChartLine', conversion_path: 'Route', cloud_upload: 'CloudUpload', smart_toy: 'Bot',
  home: 'House', menu: 'Menu', left_panel_close: 'PanelLeftClose', left_panel_open: 'PanelLeftOpen', computer: 'Monitor', settings: 'Settings',
  folder_special: 'FolderOpen', add: 'Plus', history: 'History', web: 'AppWindow', dynamic_form: 'ListChecks', check_circle: 'CircleCheck',
  key: 'Key', arrow_forward: 'ArrowRight', edit: 'Pencil', content_copy: 'Copy', delete: 'Trash2', tune: 'SlidersHorizontal',
  person: 'User', link: 'Link', movie: 'Clapperboard', arrow_back: 'ArrowLeft',
  corporate_fare: 'Building2', group: 'Users', credit_card: 'CreditCard', cloud: 'Cloud', language: 'Globe', light_mode: 'Sun', dark_mode: 'Moon', search: 'Search', inbox: 'Inbox',
};

const atributos = (obj) => Object.entries(obj).map(([k, v]) => `${k}="${v}"`).join(' ');
const svg = (no) => `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${no.map(([tag, attrs]) => `<${tag} ${atributos(attrs)}/>`).join('')}</svg>`;

const icones = {};
for (const [nome, lucideNome] of Object.entries(MAPA)) {
  if (!lucide[lucideNome]) throw new Error(`Ícone do Lucide inexistente: ${lucideNome}`);
  icones[nome] = svg(lucide[lucideNome]);
}

const fonte = `// Gerado por scripts/gerar-icones.mjs a partir do pacote lucide. Não editar à mão.
//
// Os ícones da interface do Studio são do Lucide. O markup continua escrevendo o nome do
// ícone dentro de um elemento .material-symbols-outlined (é assim que o HTML e o JS já os
// criam); pintarIcones troca esse texto pelo SVG do Lucide — inclusive nos elementos que
// o JS cria depois, pelo observador. O que não está no mapa (ícone de página publicada,
// como o bloco Ícone da landing) fica com a fonte Material Symbols.
export const ICONES = Object.freeze(${JSON.stringify(icones, null, 1)});

export function pintarIcone(elemento) {
  if (!elemento || elemento.dataset.icone) return;
  const nome = elemento.textContent.trim();
  const svg = ICONES[nome];
  if (!svg) return;
  elemento.dataset.icone = nome;
  elemento.innerHTML = svg;
}

export function pintarIcones(raiz = document) {
  if (raiz.matches?.('.material-symbols-outlined')) pintarIcone(raiz);
  raiz.querySelectorAll?.('.material-symbols-outlined').forEach(pintarIcone);
}

// O JS do painel cria ícones o tempo todo (cartões, abas, listas): o observador os pinta ao
// entrar na página e quando o texto de um ícone muda.
export function observarIcones(raiz = document.body) {
  pintarIcones(raiz);
  const observador = new MutationObserver((mudancas) => {
    for (const mudanca of mudancas) {
      if (mudanca.type === 'characterData') {
        const alvo = mudanca.target.parentElement;
        if (alvo?.matches('.material-symbols-outlined')) { delete alvo.dataset.icone; pintarIcone(alvo); }
      }
      for (const no of mudanca.addedNodes) if (no.nodeType === 1) pintarIcones(no);
      if (mudanca.type === 'childList' && mudanca.target.matches?.('.material-symbols-outlined') && !mudanca.target.querySelector('svg')) {
        delete mudanca.target.dataset.icone; pintarIcone(mudanca.target);
      }
    }
  });
  observador.observe(raiz, { childList: true, subtree: true, characterData: true });
  return observador;
}
`;
await writeFile(new URL('../public/icones.js', import.meta.url), fonte);
console.log(`public/icones.js: ${Object.keys(icones).length} ícones`);
