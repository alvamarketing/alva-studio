// Os componentes do Puck, um por tipo do esquema do Alva.
//
// Um catálogo só: a pré-visualização dos elementos simples é o HTML do mesmo `renderNode`
// que o servidor usa para publicar. Os contêineres (seção, colunas, formulário) desenham a
// mesma casca com um slot dentro, que é como o Puck deixa arrastar para dentro deles.
import { classeDaSecao, classeDasColunas, renderNode } from '../public/page-schema.js';
import { SLOT } from '../public/puck-conversao.js';

const Html = ({ type, props }) => {
  let html;
  try { html = renderNode({ type, props }); } catch (erro) { html = `<p style="color:#b42318">${erro.message}</p>`; }
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
};

const simNao = [{ label: 'Sim', value: true }, { label: 'Não', value: false }];
const folha = (type, fields, defaultProps) => ({
  fields,
  defaultProps,
  render: ({ puck: _puck, editMode: _editMode, id: _id, ...props }) => <Html type={type} props={props} />,
});

// As VSLs publicadas do projeto viram uma lista para escolher: digitar um identificador era
// convite ao erro, e VSL não publicada impede a página de publicar.
export function criarConfig({ vsls = [] } = {}) {
  const opcoesDeVsl = vsls.length
    ? [{ label: 'Escolha uma VSL', value: '' }, ...vsls.map((vsl) => ({ label: vsl.name, value: vsl.publicId }))]
    : [{ label: 'Nenhuma VSL publicada neste projeto', value: '' }];
  return {
  categories: {
    estrutura: { title: 'Estrutura', components: ['section', 'columns'] },
    conteudo: { title: 'Conteúdo', components: ['heading', 'text', 'button', 'icon', 'image', 'vsl'] },
    captacao: { title: 'Captação', components: ['form', 'field'] },
  },
  root: {
    fields: { title: { type: 'text', label: 'Título da página (aba do navegador)' } },
    defaultProps: { title: '' },
  },
  components: {
    section: {
      label: 'Seção',
      fields: {
        fundo: { type: 'select', label: 'Fundo', options: [{ label: 'Branco', value: 'branco' }, { label: 'Suave', value: 'suave' }, { label: 'Escuro', value: 'escuro' }] },
        // Campo só funciona dentro de formulário: solto, não captura nada.
        [SLOT]: { type: 'slot', disallow: ['field'] },
      },
      defaultProps: { fundo: 'branco' },
      render: ({ fundo, [SLOT]: Itens }) => <section className={classeDaSecao({ fundo })}><Itens /></section>,
    },
    columns: {
      label: 'Colunas',
      fields: {
        quantidade: { type: 'select', label: 'Quantas colunas', options: [{ label: 'Duas', value: 2 }, { label: 'Três', value: 3 }] },
        // Campo só funciona dentro de formulário: solto, não captura nada.
        [SLOT]: { type: 'slot', disallow: ['field'] },
      },
      defaultProps: { quantidade: 2 },
      // O slot do Puck desenha um elemento próprio: é ele que vira a grade, para os blocos
      // serem filhos diretos dela, como na página publicada.
      render: ({ quantidade, [SLOT]: Itens }) => <Itens as="div" className={classeDasColunas({ quantidade })} collisionAxis="x" />,
    },
    heading: {
      label: 'Título',
      ...folha('heading', {
        text: { type: 'textarea', label: 'Texto' },
        level: { type: 'select', label: 'Tamanho', options: [{ label: 'Principal (H1)', value: 1 }, { label: 'Seção (H2)', value: 2 }, { label: 'Menor (H3)', value: 3 }] },
      }, { text: 'Seu próximo grande título', level: 2 }),
    },
    text: {
      label: 'Texto',
      ...folha('text', { text: { type: 'textarea', label: 'Texto' } }, { text: 'Uma mensagem simples para apresentar sua solução.' }),
    },
    button: {
      label: 'Botão',
      ...folha('button', {
        text: { type: 'text', label: 'Texto' },
        href: { type: 'text', label: 'Link (https://…, #seção, mailto:, tel:)' },
        newTab: { type: 'radio', label: 'Abrir em nova aba', options: simNao },
      }, { text: 'Quero saber mais', href: '#contato', newTab: false }),
    },
    icon: {
      label: 'Ícone',
      ...folha('icon', { name: { type: 'text', label: 'Nome do ícone (Material Symbols)' } }, { name: 'star' }),
    },
    image: {
      label: 'Imagem',
      ...folha('image', { src: { type: 'text', label: 'Endereço da imagem (https://…)' }, alt: { type: 'text', label: 'Descrição para quem não vê a imagem' } }, { src: '', alt: '' }),
    },
    vsl: {
      label: 'VSL do Studio',
      ...folha('vsl', { publicId: { type: 'select', label: 'VSL publicada', options: opcoesDeVsl } }, { publicId: '' }),
    },
    form: {
      label: 'Formulário',
      fields: {
        submitLabel: { type: 'text', label: 'Texto do botão' },
        [SLOT]: { type: 'slot', allow: ['field'] },
      },
      defaultProps: { submitLabel: 'Enviar' },
      // A captura precisa de um UUID estável, que o Puck não dá: nasce aqui, uma vez.
      resolveData: ({ props }) => (props.captureId ? { props } : { props: { ...props, captureId: globalThis.crypto.randomUUID() } }),
      render: ({ submitLabel, [SLOT]: Itens }) => (
        <form className="alva-form" onSubmit={(evento) => evento.preventDefault()}>
          <Itens />
          <button type="submit" className="cta">{submitLabel || 'Enviar'}</button>
        </form>
      ),
    },
    field: {
      label: 'Campo',
      ...folha('field', {
        label: { type: 'text', label: 'Pergunta' },
        name: { type: 'text', label: 'Nome do campo (vai para o lead)' },
        fieldType: { type: 'select', label: 'Tipo de resposta', options: [
          { label: 'Texto', value: 'text' }, { label: 'E-mail', value: 'email' }, { label: 'Telefone', value: 'tel' },
          { label: 'Número', value: 'number' }, { label: 'Texto longo', value: 'long_text' },
        ] },
        placeholder: { type: 'text', label: 'Exemplo dentro do campo' },
        required: { type: 'radio', label: 'Obrigatório', options: simNao },
      }, { label: 'Seu e-mail', name: 'email', fieldType: 'email', placeholder: 'voce@exemplo.com', required: true }),
    },
  },
};
}
