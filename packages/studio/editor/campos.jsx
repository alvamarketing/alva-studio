// Campos próprios do editor: imagem (endereço ou anexo do computador) e cor.
import { useRef, useState, useSyncExternalStore } from 'react';
import { AutoField, FieldLabel, createUsePuck, useGetPuck } from '@puckeditor/core';
import { ICONE_DO_CAMPO } from './icones.jsx';
import { chaveDoEnvio, enviarImagemPara, estadoDoEnvio, limparEnvio, ouvirEnvios } from './envios-de-imagem.js';
import { ancorasDaPagina, quantasVezesAAncoraAparece } from './ancoras.js';
import { enderecoDeRedirecionamento, normalizarAncora } from '../public/page-schema.js';
import { SLOT } from '../public/puck-conversao.js';

const usePuckDoCampo = createUsePuck();

const estiloDoCampo = { width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 14, padding: '8px 10px', border: '1px solid var(--alva-line)', borderRadius: 8 };
const estiloDoBotao = { font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 12px', border: '1px solid var(--alva-line)', borderRadius: 8, background: 'var(--alva-white)', cursor: 'pointer' };

export function campoDeImagem(rotulo, enviarImagem) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ name, value, onChange, readOnly }) => <CampoDeImagem rotulo={rotulo} nome={name} valor={value} aoMudar={onChange} somenteLeitura={readOnly} enviarImagem={enviarImagem} />,
  };
}

// O envio grava no bloco que estava selecionado quando ele começou (envios-de-imagem.js), e
// o estado dele é o mesmo que o canvas mostra no lugar da imagem.
function CampoDeImagem({ rotulo, nome, valor, aoMudar, somenteLeitura, enviarImagem }) {
  const arquivo = useRef(null);
  const getPuck = useGetPuck();
  const dono = usePuckDoCampo((estado) => estado.selectedItem?.props?.id ?? null);
  const envio = useSyncExternalStore(ouvirEnvios, () => estadoDoEnvio(chaveDoEnvio(dono, nome)));
  const estado = envio?.fase === 'enviando' ? 'Enviando…' : envio?.fase === 'erro' ? envio.mensagem : '';
  const escolher = (evento) => {
    const escolhido = evento.target.files?.[0];
    evento.target.value = '';
    if (!escolhido) return;
    enviarImagemPara({ getPuck, id: dono, nome, arquivo: escolhido, enviarImagem, aoMudar });
  };
  return (
    <FieldLabel label={rotulo} icon={ICONE_DO_CAMPO.imagem} readOnly={somenteLeitura}>
      <div style={{ display: 'grid', gap: 8 }}>
        {valor ? <img src={valor} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 8, background: 'var(--alva-cloud)' }} /> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={estiloDoBotao} disabled={somenteLeitura || estado === 'Enviando…'} onClick={() => arquivo.current?.click()}>Anexar do computador</button>
          {valor ? <button type="button" style={estiloDoBotao} disabled={somenteLeitura} onClick={() => { limparEnvio(chaveDoEnvio(dono, nome)); aoMudar(''); }}>Remover</button> : null}
        </div>
        <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={escolher} />
        <input type="text" style={estiloDoCampo} placeholder="ou cole o endereço (https://…)" value={valor ?? ''} disabled={somenteLeitura} onChange={(evento) => { limparEnvio(chaveDoEnvio(dono, nome)); aoMudar(evento.target.value); }} />
        {estado ? <small role="status" style={{ color: estado === 'Enviando…' ? 'var(--alva-muted)' : 'var(--alva-danger)' }}>{estado}</small> : null}
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
          <span style={{ fontSize: 13, color: 'var(--alva-muted)', minWidth: 64 }}>{value || 'sem cor'}</span>
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
                style={{ ...estiloDoBotao, display: 'grid', gap: 6, padding: 8, borderColor: escolhida ? 'var(--alva-blue)' : 'var(--alva-line)', background: escolhida ? 'var(--alva-highlight)' : 'var(--alva-white)' }}>
                <span style={{ display: 'flex', gap: 4, height: 18 }}>
                  {opcao.partes.map((parte, indice) => <span key={indice} style={{ flex: parte, borderRadius: 4, background: escolhida ? 'var(--alva-blue)' : 'var(--alva-soft)' }} />)}
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
            <FieldLabel key={nome} label={campo.label} icon={campo.labelIcon} el="div" readOnly={readOnly}>
              <AutoField field={campo} readOnly={readOnly} value={value?.[nome]} onChange={(novo) => onChange({ ...(value ?? {}), [nome]: novo })} />
            </FieldLabel>
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
              style={{ ...estiloDoBotao, padding: 6, minWidth: 0, display: 'grid', placeItems: 'center', borderColor: valor === nome ? 'var(--alva-blue)' : 'var(--alva-line)', background: valor === nome ? 'var(--alva-highlight)' : 'var(--alva-white)' }}>
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>{nome}</span>
            </button>
          ))}
          {!visiveis.length ? <small style={{ gridColumn: '1 / -1', color: 'var(--alva-muted)' }}>Nenhum ícone com esse nome. Digite o nome abaixo.</small> : null}
        </div>
        <input type="text" style={estiloDoCampo} placeholder="ou o nome exato no Material Symbols" value={valor ?? ''} disabled={somenteLeitura} onChange={(evento) => aoMudar(evento.target.value.trim())} />
      </div>
    </FieldLabel>
  );
}

// A âncora da seção: o nome que o botão usa em "#nome". Normaliza enquanto a pessoa digita
// (o hífen do fim espera a próxima palavra) e avisa quando outra seção já usa o mesmo nome.
const estiloDaDica = { fontSize: 12, lineHeight: 1.5, color: 'var(--alva-muted)' };
export function campoDeAncora(rotulo) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => <CampoDeAncora rotulo={rotulo} valor={value} aoMudar={onChange} somenteLeitura={readOnly} />,
  };
}
function CampoDeAncora({ rotulo, valor, aoMudar, somenteLeitura }) {
  const dados = usePuckDoCampo((estado) => estado.appState.data);
  const ancora = normalizarAncora(valor);
  const repetida = quantasVezesAAncoraAparece(dados, ancora) > 1;
  return (
    <FieldLabel label={rotulo} icon={ICONE_DO_CAMPO.ancora} readOnly={somenteLeitura}>
      <div style={{ display: 'grid', gap: 6 }}>
        <input type="text" style={estiloDoCampo} placeholder="ex.: contato" maxLength={60} value={valor ?? ''} disabled={somenteLeitura}
          onChange={(evento) => aoMudar(normalizarAncora(evento.target.value, { digitando: true }))}
          onBlur={(evento) => { const limpa = normalizarAncora(evento.target.value); if (limpa !== evento.target.value) aoMudar(limpa); }} />
        <small style={estiloDaDica}>{ancora ? <>Um botão com o link <strong>#{ancora}</strong> rola até esta seção.</> : 'Dê um nome para um botão poder rolar até esta seção.'}</small>
        {repetida ? <small role="alert" style={{ ...estiloDaDica, color: 'var(--alva-warning)' }}>Outra seção desta página já usa “{ancora}”. O botão vai rolar só até a primeira — escolha outro nome.</small> : null}
      </div>
    </FieldLabel>
  );
}

// O link do botão: o endereço livre de sempre, com a dica de como rolar até uma seção e,
// havendo seções com âncora, a lista delas para escolher.
export function campoDeLink(rotulo) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => <CampoDeLink rotulo={rotulo} valor={value} aoMudar={onChange} somenteLeitura={readOnly} />,
  };
}
function CampoDeLink({ rotulo, valor, aoMudar, somenteLeitura }) {
  const ancoras = usePuckDoCampo((estado) => ancorasDaPagina(estado.appState.data).join('\n')).split('\n').filter(Boolean);
  const escolhida = ancoras.find((ancora) => valor === `#${ancora}`) ?? '';
  return (
    <FieldLabel label={rotulo} icon={ICONE_DO_CAMPO.link} readOnly={somenteLeitura}>
      <div style={{ display: 'grid', gap: 6 }}>
        <input type="text" style={estiloDoCampo} placeholder="https://… ou #contato" value={valor ?? ''} disabled={somenteLeitura} onChange={(evento) => aoMudar(evento.target.value)} />
        {ancoras.length ? (
          <select style={estiloDoCampo} aria-label="Rolar até uma seção desta página" value={escolhida} disabled={somenteLeitura} onChange={(evento) => { if (evento.target.value) aoMudar(`#${evento.target.value}`); }}>
            <option value="">Rolar até uma seção desta página…</option>
            {ancoras.map((ancora) => <option key={ancora} value={ancora}>#{ancora}</option>)}
          </select>
        ) : null}
        <small style={estiloDaDica}>Para rolar até uma seção, escreva #nome-da-âncora (o nome fica na seção, em “Nome da âncora”).</small>
      </div>
    </FieldLabel>
  );
}

// "+ Campo": acrescenta um campo no fim do formulário e já o seleciona, para a pessoa
// trocar a pergunta e o tipo ali mesmo. Serve ao painel do formulário e ao botão do canvas.
export function adicionarCampo(getPuck, formId) {
  const api = getPuck();
  const formulario = formId ? api.getItemById(formId) : null;
  if (!formulario) return;
  const zona = `${formId}:${SLOT}`;
  const indice = Array.isArray(formulario.props?.[SLOT]) ? formulario.props[SLOT].length : 0;
  api.dispatch({ type: 'insert', componentType: 'field', destinationZone: zona, destinationIndex: indice, id: `field-${globalThis.crypto.randomUUID()}` });
  api.dispatch({ type: 'setUi', ui: { itemSelector: { zone: zona, index: indice }, rightSideBarVisible: true } });
}

export function campoDeMaisCampo() {
  return { type: 'custom', label: 'Campos', render: () => <MaisCampo /> };
}
function MaisCampo() {
  const getPuck = useGetPuck();
  const formId = usePuckDoCampo((estado) => estado.selectedItem?.props?.id ?? null);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button type="button" className="alva-botao-tracejado" style={{ margin: 0, width: '100%' }} onClick={() => adicionarCampo(getPuck, formId)}>+ Campo</button>
      <small style={estiloDaDica}>Para mudar a pergunta, o tipo ou a largura de um campo, ou removê-lo, clique nele no formulário ou na Estrutura.</small>
    </div>
  );
}

// "Remover campo", no fim do painel do campo: o lixo da barra do Puck faz o mesmo, mas fica
// longe de quem está olhando as opções do campo.
export function campoDeRemoverCampo() {
  return { type: 'custom', label: 'Remover', render: () => <RemoverCampo /> };
}
function RemoverCampo() {
  const getPuck = useGetPuck();
  const id = usePuckDoCampo((estado) => estado.selectedItem?.props?.id ?? null);
  const remover = () => {
    const api = getPuck();
    const lugar = id ? api.getSelectorForId(id) : null;
    if (!lugar) return;
    api.dispatch({ type: 'remove', index: lugar.index, zone: lugar.zone });
    api.dispatch({ type: 'setUi', ui: { itemSelector: null } });
  };
  return <button type="button" style={{ ...estiloDoBotao, width: '100%', color: 'var(--alva-danger)' }} onClick={remover}>Remover campo</button>;
}

// O endereço para onde levar quem enviou o formulário: só http(s), e o campo diz na hora
// quando o que foi digitado não serve.
export function campoDeEnderecoDeDestino(rotulo) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => {
      const invalido = Boolean(String(value ?? '').trim()) && !enderecoDeRedirecionamento(value);
      return (
        <FieldLabel label={rotulo} icon={ICONE_DO_CAMPO.link} readOnly={readOnly}>
          <div style={{ display: 'grid', gap: 6 }}>
            <input type="url" style={{ ...estiloDoCampo, borderColor: invalido ? 'var(--alva-danger)' : 'var(--alva-line)' }} placeholder="https://seusite.com.br/obrigado" value={value ?? ''} disabled={readOnly} aria-invalid={invalido} onChange={(evento) => onChange(evento.target.value)} />
            {invalido
              ? <small role="alert" style={{ ...estiloDaDica, color: 'var(--alva-danger)' }}>Use um endereço completo, começando com https:// (ou http://). Sem ele, a pessoa vê a mensagem de obrigado.</small>
              : <small style={estiloDaDica}>Depois de enviar, a pessoa é levada para este endereço.</small>}
          </div>
        </FieldLabel>
      );
    },
  };
}

// Um texto com limite, com a contagem à vista (a descrição da página, até 160).
export function campoDeTextoLimitado(rotulo, limite, icone) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => (
      <FieldLabel label={rotulo} icon={icone} readOnly={readOnly}>
        <div style={{ display: 'grid', gap: 6 }}>
          <textarea style={{ ...estiloDoCampo, minHeight: 84, resize: 'vertical' }} maxLength={limite} value={value ?? ''} disabled={readOnly} onChange={(evento) => onChange(evento.target.value.replace(/[\r\n]+/g, ' '))} />
          <small style={{ ...estiloDaDica, textAlign: 'right' }}>{String(value ?? '').length}/{limite}</small>
        </div>
      </FieldLabel>
    ),
  };
}

// Para onde a opção leva: "a próxima etapa" ou uma etapa escolhida pelo nome dela (o
// primeiro título). A lista vem do que está no editor agora, então acompanha etapas novas.
const primeiroTitulo = (item) => {
  for (const filho of Array.isArray(item?.props?.itens) ? item.props.itens : []) {
    if (filho.type === 'heading' && filho.props?.text) return String(filho.props.text);
    if (filho.type === 'escolha' && filho.props?.pergunta) return String(filho.props.pergunta);
    const dentro = primeiroTitulo(filho);
    if (dentro) return dentro;
  }
  return '';
};
export function campoDeDestino(rotulo) {
  return {
    type: 'custom',
    label: rotulo,
    render: ({ value, onChange, readOnly }) => <SeletorDeDestino rotulo={rotulo} valor={value} aoMudar={onChange} somenteLeitura={readOnly} />,
  };
}
function SeletorDeDestino({ rotulo, valor, aoMudar, somenteLeitura }) {
  const etapas = usePuckDoCampo((estado) => estado.appState.data.root?.props?.itens ?? []);
  const curto = (texto) => (texto.length > 40 ? `${texto.slice(0, 39)}…` : texto);
  return (
    <FieldLabel label={rotulo} readOnly={somenteLeitura} el="div">
      <select style={estiloDoCampo} value={valor ?? ''} disabled={somenteLeitura} onChange={(evento) => aoMudar(evento.target.value)}>
        <option value="">Próxima etapa</option>
        {etapas.map((etapa, indice) => (
          <option key={etapa.props.id} value={etapa.props.id}>
            {indice === etapas.length - 1 ? 'Tela final' : `Etapa ${indice + 1}`}{primeiroTitulo(etapa) ? ` — ${curto(primeiroTitulo(etapa))}` : ''}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}
