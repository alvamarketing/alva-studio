// Campos próprios do editor: imagem (endereço ou anexo do computador) e cor.
import { useRef, useState } from 'react';
import { FieldLabel } from '@puckeditor/core';

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
    <FieldLabel label={rotulo} readOnly={somenteLeitura}>
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
      <FieldLabel label={rotulo} readOnly={readOnly}>
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
      <FieldLabel label={rotulo} readOnly={readOnly}>
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
