// Campos próprios do editor: imagem (endereço ou anexo do computador) e cor.
import { useRef, useState } from 'react';
import { AutoField, FieldLabel } from '@puckeditor/core';
import { ICONE_DO_CAMPO } from './icones.jsx';

const estiloDoCampo = { width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 14, padding: '8px 10px', border: '1px solid #E7ECF3', borderRadius: 8 };
const estiloDoBotao = { font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 12px', border: '1px solid #E7ECF3', borderRadius: 8, background: '#ffffff', cursor: 'pointer' };

export function campoDeImagem(rotulo, enviarImagem) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => <CampoDeImagem rotulo={rotulo} valor={value} aoMudar={onChange} somenteLeitura={readOnly} enviarImagem={enviarImagem} />,
  };
}

function CampoDeImagem({ rotulo, valor, aoMudar, somenteLeitura, enviarImagem }) {
  const arquivo = useRef(null);
  const [estado, setEstado] = useState('');
  const escolher = async (evento) => {
    const escolhido = evento.target.files?.[0];
    evento.target.value = '';
    if (!escolhido) return;
    setEstado('Enviando…');
    try {
      aoMudar(await enviarImagem(escolhido));
      setEstado('');
    } catch (erro) {
      setEstado(erro.message);
    }
  };
  return (
    <FieldLabel label={rotulo} icon={ICONE_DO_CAMPO.imagem} readOnly={somenteLeitura}>
      <div style={{ display: 'grid', gap: 8 }}>
        {valor ? <img src={valor} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 8, background: '#F7F9FC' }} /> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={estiloDoBotao} disabled={somenteLeitura || estado === 'Enviando…'} onClick={() => arquivo.current?.click()}>Anexar do computador</button>
          {valor ? <button type="button" style={estiloDoBotao} disabled={somenteLeitura} onClick={() => aoMudar('')}>Remover</button> : null}
        </div>
        <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={escolher} />
        <input type="text" style={estiloDoCampo} placeholder="ou cole o endereço (https://…)" value={valor ?? ''} disabled={somenteLeitura} onChange={(evento) => aoMudar(evento.target.value)} />
        {estado ? <small role="status" style={{ color: estado === 'Enviando…' ? '#667085' : '#b42318' }}>{estado}</small> : null}
      </div>
    </FieldLabel>
  );
}

export function campoDeCor(rotulo) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => (
      <FieldLabel label={rotulo} icon={ICONE_DO_CAMPO.cor} readOnly={readOnly}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="color" aria-label={rotulo} value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#ffffff'} disabled={readOnly} onChange={(evento) => onChange(evento.target.value)} style={{ width: 44, height: 36, padding: 0, border: '1px solid #E7ECF3', borderRadius: 8, background: '#ffffff' }} />
          <span style={{ fontSize: 13, color: '#667085', minWidth: 64 }}>{value || 'sem cor'}</span>
          {value ? <button type="button" style={estiloDoBotao} disabled={readOnly} onClick={() => onChange('')}>Sem cor</button> : null}
        </div>
      </FieldLabel>
    ),
  };
}

// O estilo que o servidor escreve no atributo, como objeto para o React.
export function estiloParaReact(estilo) {
  return Object.fromEntries(String(estilo ?? '').split(';').filter(Boolean).map((declaracao) => {
    const [propriedade, ...resto] = declaracao.split(':');
    return [propriedade.trim().replace(/-([a-z])/g, (_, letra) => letra.toUpperCase()), resto.join(':').trim()];
  }));
}

// As colunas escolhidas por desenho: cada botão mostra a proporção, em vez de pedir número.
const PROPORCOES = [
  { valor: '1/2+1/2', rotulo: 'Duas iguais', partes: [1, 1] },
  { valor: '1/3+2/3', rotulo: 'Estreita e larga', partes: [1, 2] },
  { valor: '2/3+1/3', rotulo: 'Larga e estreita', partes: [2, 1] },
  { valor: '1/3x3', rotulo: 'Três iguais', partes: [1, 1, 1] },
];
export function campoDeProporcao(rotulo) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => (
      <FieldLabel label={rotulo} icon={ICONE_DO_CAMPO.estrutura} readOnly={readOnly}>
        <div role="radiogroup" aria-label={rotulo} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {PROPORCOES.map((opcao) => {
            const escolhida = (value || '1/2+1/2') === opcao.valor;
            return (
              <button key={opcao.valor} type="button" role="radio" aria-checked={escolhida} aria-label={opcao.rotulo} title={opcao.rotulo} disabled={readOnly}
                onClick={() => onChange(opcao.valor)}
                style={{ ...estiloDoBotao, display: 'grid', gap: 6, padding: 8, borderColor: escolhida ? '#286EEA' : '#E7ECF3', background: escolhida ? '#EAF2FF' : '#ffffff' }}>
                <span style={{ display: 'flex', gap: 4, height: 18 }}>
                  {opcao.partes.map((parte, indice) => <span key={indice} style={{ flex: parte, borderRadius: 4, background: escolhida ? '#286EEA' : '#CDD6E3' }} />)}
                </span>
                <span style={{ fontSize: 12 }}>{opcao.rotulo}</span>
              </button>
            );
          })}
        </div>
      </FieldLabel>
    ),
  };
}

// Um grupo de campos que abre e fecha: o ajuste fino fica recolhido até a pessoa pedir
// (revelação progressiva, regra 12 de docs/specs/2026-09-27-ux-do-editor.md).
export function campoRecolhido(rotulo, subcampos, Icone) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => (
      <details className="alva-recolhido">
        <summary>{Icone ? <Icone size={16} aria-hidden="true" /> : null}{rotulo}</summary>
        <div style={{ display: 'grid', gap: 12, paddingTop: 12 }}>
          {Object.entries(subcampos).map(([nome, campo]) => (
            <AutoField key={nome} field={campo} readOnly={readOnly} value={value?.[nome]} onChange={(novo) => onChange({ ...(value ?? {}), [nome]: novo })} />
          ))}
        </div>
      </details>
    ),
  };
}

// Os ícones mais usados em landing, da mesma fonte (Material Symbols) que a página
// publicada carrega. A busca filtra pelo nome em inglês e pela palavra em português.
const ICONES = [
  ['star', 'estrela'], ['favorite', 'coração'], ['bolt', 'raio'], ['check_circle', 'confirmado'], ['verified', 'verificado'],
  ['schedule', 'relógio'], ['calendar_month', 'calendário'], ['event', 'evento'], ['location_on', 'local'], ['call', 'telefone'],
  ['mail', 'e-mail'], ['chat', 'conversa'], ['forum', 'fórum'], ['support_agent', 'atendimento'], ['person', 'pessoa'],
  ['groups', 'equipe'], ['handshake', 'parceria'], ['thumb_up', 'curtir'], ['sentiment_satisfied', 'satisfeito'], ['emoji_events', 'troféu'],
  ['workspace_premium', 'prêmio'], ['rocket_launch', 'foguete'], ['trending_up', 'crescimento'], ['insights', 'análise'], ['bar_chart', 'gráfico'],
  ['payments', 'pagamento'], ['savings', 'economia'], ['shopping_cart', 'carrinho'], ['sell', 'preço'], ['local_offer', 'oferta'],
  ['lock', 'cadeado'], ['shield', 'proteção'], ['security', 'segurança'], ['bolt', 'rápido'], ['speed', 'velocidade'],
  ['lightbulb', 'ideia'], ['school', 'curso'], ['menu_book', 'livro'], ['play_circle', 'vídeo'], ['headphones', 'áudio'],
  ['public', 'mundo'], ['home', 'casa'], ['apartment', 'prédio'], ['store', 'loja'], ['restaurant', 'restaurante'],
  ['fitness_center', 'academia'], ['spa', 'bem-estar'], ['medical_services', 'saúde'], ['pets', 'pet'], ['directions_car', 'carro'],
  ['build', 'ferramenta'], ['settings', 'configuração'], ['design_services', 'design'], ['code', 'código'], ['cloud', 'nuvem'],
  ['format_quote', 'citação'], ['edit_note', 'anotação'], ['task_alt', 'tarefa'], ['arrow_forward', 'seta'], ['whatsapp', 'whatsapp'],
].filter(([nome], indice, lista) => lista.findIndex(([outro]) => outro === nome) === indice);

export function campoDeIcone(rotulo) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => <SeletorDeIcone rotulo={rotulo} valor={value} aoMudar={onChange} somenteLeitura={readOnly} />,
  };
}

function SeletorDeIcone({ rotulo, valor, aoMudar, somenteLeitura }) {
  const [busca, setBusca] = useState('');
  const termo = busca.trim().toLowerCase();
  const visiveis = ICONES.filter(([nome, palavra]) => !termo || nome.includes(termo) || palavra.includes(termo));
  return (
    <FieldLabel label={rotulo} readOnly={somenteLeitura}>
      <div style={{ display: 'grid', gap: 8 }}>
        <input type="search" style={estiloDoCampo} placeholder="Buscar ícone (ex.: coração, prêmio)" value={busca} onChange={(evento) => setBusca(evento.target.value)} />
        <div role="radiogroup" aria-label={rotulo} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {visiveis.map(([nome, palavra]) => (
            <button key={nome} type="button" role="radio" aria-checked={valor === nome} aria-label={palavra} title={palavra} disabled={somenteLeitura} onClick={() => aoMudar(nome)}
              style={{ ...estiloDoBotao, padding: 6, minWidth: 0, display: 'grid', placeItems: 'center', borderColor: valor === nome ? '#286EEA' : '#E7ECF3', background: valor === nome ? '#EAF2FF' : '#ffffff' }}>
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>{nome}</span>
            </button>
          ))}
          {!visiveis.length ? <small style={{ gridColumn: '1 / -1', color: '#667085' }}>Nenhum ícone com esse nome. Digite o nome abaixo.</small> : null}
        </div>
        <input type="text" style={estiloDoCampo} placeholder="ou o nome exato no Material Symbols" value={valor ?? ''} disabled={somenteLeitura} onChange={(evento) => aoMudar(evento.target.value.trim())} />
      </div>
    </FieldLabel>
  );
}
