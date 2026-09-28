// Os componentes do Puck, um por tipo do esquema do Alva.
//
// Um catálogo só: o miolo de cada bloco é o HTML do mesmo `renderConteudo` que o servidor
// usa para publicar, e a caixa de layout em volta usa as mesmas classes. Os blocos são
// `inline` (sem o invólucro do Puck), para a caixa deles ser o item do layout — é isso que
// faz largura, Linha e colunas funcionarem no editor como na página publicada.
//
// As escolhas de interface seguem docs/specs/2026-09-27-ux-do-editor.md: seções prontas
// primeiro, colunas por desenho, espaçamento em escala, ajuste fino recolhido.
import { AVISO_DE_PRIVACIDADE, avisoDePrivacidade, classeDaSecao, classeDasColunas, classeDoConteudo, classesDoBloco, estiloDaSecao, renderConteudo } from '../public/page-schema.js';
import { SLOT, alvaParaPuck } from '../public/puck-conversao.js';
import { secoesProntas } from '../public/secoes-prontas.js';
import { campoDeCor, campoDeDestino, campoDeIcone, campoDeImagem, campoDeProporcao, campoRecolhido, estiloParaReact } from './campos.jsx';
import { SlidersHorizontal } from 'lucide-react';
import { ICONE_DO_CAMPO } from './icones.jsx';

const Miolo = ({ type, props }) => {
  let html;
  try { html = renderConteudo({ type, props }); } catch (erro) { html = `<p style="color:var(--alva-danger)">${erro.message}</p>`; }
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
};

const simNao = [{ label: 'Sim', value: true }, { label: 'Não', value: false }];
const escala = (rotulo) => ({ type: 'radio', label: rotulo, labelIcon: ICONE_DO_CAMPO.espaco, options: [{ label: 'P', value: 'p' }, { label: 'M', value: 'm' }, { label: 'G', value: 'g' }] });
const BLOCOS_SOLTOS = ['heading', 'text', 'button', 'icon', 'image', 'video', 'vsl'];

// Ajuste fino, recolhido: largura manual, movimento e margem em escala.
const avancado = campoRecolhido('Avançado', {
    largura: { type: 'select', label: 'Largura', labelIcon: ICONE_DO_CAMPO.largura, options: [
      { label: 'Linha inteira', value: 'inteira' }, { label: '3/4', value: '3/4' }, { label: '2/3', value: '2/3' },
      { label: '1/2', value: '1/2' }, { label: '1/3', value: '1/3' }, { label: '1/4', value: '1/4' },
    ] },
    alinhamento: { type: 'radio', label: 'Alinhamento', labelIcon: ICONE_DO_CAMPO.alinhamento, options: [{ label: 'Esquerda', value: 'esquerda' }, { label: 'Centro', value: 'centro' }, { label: 'Direita', value: 'direita' }] },
    espacoAcima: escala('Espaço acima'),
    espacoAbaixo: escala('Espaço abaixo'),
    movimento: { type: 'select', label: 'Movimento de entrada', labelIcon: ICONE_DO_CAMPO.movimento, options: [
      { label: 'Nenhum', value: '' }, { label: 'Subir suavemente', value: 'fade-up' }, { label: 'Deslizar da direita', value: 'slide-left' }, { label: 'Aproximar', value: 'zoom-in' },
    ] },
}, SlidersHorizontal);

// Um bloco solto: a caixa de layout é o elemento que o Puck arrasta.
const bloco = (type, label, fields, defaultProps) => ({
  label,
  inline: true,
  fields: { ...fields, avancado },
  defaultProps: { ...defaultProps, avancado: {} },
  render: ({ puck, id: _id, ...props }) => (
    <div ref={puck.dragRef} className={classesDoBloco(props)}><Miolo type={type} props={props} /></div>
  ),
});

// Seção: pronta ou vazia, é a mesma faixa com o conteúdo numa área central.
const camposDaSecao = (enviarImagem) => ({
  fundo: { type: 'select', label: 'Fundo pronto', labelIcon: ICONE_DO_CAMPO.fundo, options: [{ label: 'Branco', value: 'branco' }, { label: 'Suave', value: 'suave' }, { label: 'Escuro', value: 'escuro' }] },
  corDeFundo: campoDeCor('Cor de fundo'),
  corDeFundo2: campoDeCor('Segunda cor (degradê)'),
  direcaoDoDegrade: { type: 'radio', label: 'Direção do degradê', options: [{ label: 'Vertical', value: 'vertical' }, { label: 'Horizontal', value: 'horizontal' }, { label: 'Diagonal', value: 'diagonal' }] },
  imagemDeFundo: campoDeImagem('Imagem de fundo', enviarImagem),
  corDoTexto: campoDeCor('Cor do texto'),
  alinhamento: { type: 'radio', label: 'Alinhar conteúdo', labelIcon: ICONE_DO_CAMPO.alinhamento, options: [{ label: 'Esquerda', value: 'esquerda' }, { label: 'Centro', value: 'centro' }] },
  respiro: escala('Espaço dentro da seção'),
  espacamento: escala('Espaço entre os blocos'),
  // Com VSL na página: a seção só aparece quando o vídeo chega a este segundo.
  revelarNoSegundo: { type: 'number', label: 'Mostrar só depois do segundo (VSL)', min: 1, max: 86400 },
  // Campo só funciona dentro de formulário, e seção só na página: dentro de outra seção
  // ela vira uma faixa espremida.
  [SLOT]: { type: 'slot', disallow: ['field', 'section', ...secoesProntas.map((pronta) => pronta.id)] },
});
const renderDaSecao = ({ puck, id: _id, [SLOT]: Itens, ...props }) => (
  <section ref={puck.dragRef} className={classeDaSecao(props)} style={estiloParaReact(estiloDaSecao(props))}>
    <Itens className={classeDoConteudo(props)} collisionAxis="dynamic" />
  </section>
);
const secao = (label, enviarImagem, defaultProps) => ({ label, inline: true, fields: camposDaSecao(enviarImagem), defaultProps, render: renderDaSecao });

const semIds = (itens) => itens.map(({ type, props: { id: _id, ...props } }) => ({
  type,
  props: props[SLOT] ? { ...props, [SLOT]: semIds(props[SLOT]) } : props,
}));

// As VSLs publicadas do projeto viram uma lista para escolher: digitar um identificador era
// convite ao erro, e VSL não publicada impede a página de publicar.
export function criarConfig({ vsls = [], enviarImagem = async () => { throw new Error('Envio de imagem indisponível.'); }, quiz = false } = {}) {
  const opcoesDeVsl = vsls.length
    ? [{ label: 'Escolha uma VSL', value: '' }, ...vsls.map((vsl) => ({ label: vsl.name, value: vsl.publicId }))]
    : [{ label: 'Nenhuma VSL publicada neste projeto', value: '' }];
  const prontas = Object.fromEntries(secoesProntas.map((pronta) => [pronta.id, secao(pronta.nome, enviarImagem, {
    fundo: 'branco', corDeFundo: '', corDeFundo2: '', imagemDeFundo: '', corDoTexto: '', respiro: 'm', espacamento: 'm', alinhamento: 'esquerda',
    ...pronta.props,
    // Os filhos entram já montados. Sem id: o Puck só gera id novo para quem chega sem, e
    // um id fixo aqui faria duas inserções da mesma seção dividirem os mesmos ids.
    [SLOT]: semIds(alvaParaPuck({ content: pronta.conteudo() }).root.props[SLOT]),
  })]));
  // O quiz: etapas no lugar de seções, perguntas no lugar de formulário. A página inteira é
  // a captura, então campo e pergunta entram direto na etapa.
  const categorias = quiz
    ? {
      etapas: { title: 'Etapas', components: ['etapa'], defaultExpanded: true },
      perguntas: { title: 'Perguntas', components: ['escolha', 'field'] },
      conteudo: { title: 'Conteúdo', components: BLOCOS_SOLTOS },
      estrutura: { title: 'Layout', components: ['row', 'columns'] },
      other: { visible: false },
    }
    : {
      prontas: { title: 'Seções prontas', components: secoesProntas.map((pronta) => pronta.id), defaultExpanded: true },
      estrutura: { title: 'Layout', components: ['section', 'row', 'columns'] },
      conteudo: { title: 'Conteúdo', components: BLOCOS_SOLTOS },
      captacao: { title: 'Captação', components: ['form', 'field'] },
      other: { visible: false },
    };
  return {
    categories: categorias,
    // A página recebe só seções (o quiz, só etapas): bloco solto na raiz ficava sem
    // espaçamento e sem layout.
    root: {
      fields: {
        title: { type: 'text', label: quiz ? 'Título do quiz (aba do navegador)' : 'Título da página (aba do navegador)' },
        // O cabeçalho fixo do quiz (contrato: "Vamos conhecer você?"): marca e barra.
        ...(quiz ? { marca: { type: 'text', label: 'Marca no topo (vazio usa o título)' }, logo: campoDeImagem('Logo no topo (opcional)', enviarImagem) } : {}),
        [SLOT]: { type: 'slot', allow: quiz ? ['etapa'] : ['section', ...secoesProntas.map((pronta) => pronta.id)] },
      },
      defaultProps: { title: '', [SLOT]: [] },
      render: ({ [SLOT]: Itens, title, marca, logo }) => (quiz
        ? (
          <div data-alva-quiz="true">
            <header className="alva-quiz-topo">
              <span className="alva-quiz-marca">{logo ? <img src={logo} alt={marca || title || ''} /> : (marca || title || 'Sua marca')}</span>
              <div className="alva-quiz-progresso"><i style={{ width: '25%' }} /></div>
              <small className="alva-quiz-porcento">25%</small>
            </header>
            <Itens as="main" className="alva-pagina alva-quiz-no-editor" minEmptyHeight={400} />
          </div>
        )
        : <Itens as="main" className="alva-pagina" minEmptyHeight={400} />),
    },
    components: {
      ...prontas,
      section: secao('Seção vazia', enviarImagem, { fundo: 'branco', corDeFundo: '', corDeFundo2: '', imagemDeFundo: '', corDoTexto: '', respiro: 'm', espacamento: 'm', alinhamento: 'centro' }),
      etapa: {
        label: 'Etapa',
        inline: true,
        fields: { ...camposDaSecao(enviarImagem), [SLOT]: { type: 'slot', disallow: ['etapa', 'section', 'form', ...secoesProntas.map((pronta) => pronta.id)] } },
        defaultProps: { fundo: 'branco', corDeFundo: '', corDeFundo2: '', imagemDeFundo: '', corDoTexto: '', respiro: 'm', espacamento: 'm', alinhamento: 'centro' },
        render: ({ puck, id: _id, [SLOT]: Itens, ...props }) => (
          <section ref={puck.dragRef} className={classeDaSecao(props).replace('alva-secao', 'alva-secao alva-etapa')} style={estiloParaReact(estiloDaSecao(props))}>
            <Itens className={classeDoConteudo(props)} collisionAxis="dynamic" minEmptyHeight={120} />
          </section>
        ),
      },
      escolha: bloco('escolha', 'Pergunta de escolha', {
        pergunta: { type: 'textarea', label: 'Pergunta' },
        opcoes: {
          type: 'array',
          label: 'Opções',
          getItemSummary: (opcao, indice) => opcao?.rotulo || `Opção ${indice + 1}`,
          defaultItemProps: { rotulo: 'Nova opção', icone: '', imagem: '', destino: '' },
          arrayFields: {
            rotulo: { type: 'text', label: 'Texto da opção' },
            icone: { type: 'text', label: 'Ícone (nome do Material Symbols, opcional)' },
            imagem: campoDeImagem('Imagem (opcional)', enviarImagem),
            destino: campoDeDestino('Ao escolher, ir para'),
          },
        },
        multipla: { type: 'radio', label: 'Quantas a pessoa pode marcar', options: [{ label: 'Uma', value: false }, { label: 'Várias', value: true }] },
        avancar: { type: 'radio', label: 'Avançar ao escolher (só com uma)', options: simNao },
        obrigatoria: { type: 'radio', label: 'Obrigatória', options: simNao },
        colunas: { type: 'radio', label: 'Opções em', options: [{ label: 'Lista', value: 1 }, { label: 'Grade 2×', value: 2 }] },
        name: { type: 'text', label: 'Nome da resposta no lead (opcional)' },
      }, {
        pergunta: 'Qual opção descreve melhor você?',
        opcoes: [{ rotulo: 'Opção A', icone: '', imagem: '', destino: '' }, { rotulo: 'Opção B', icone: '', imagem: '', destino: '' }],
        multipla: false, avancar: true, obrigatoria: true, colunas: 1, name: '',
      }),
      row: {
        label: 'Linha (lado a lado)',
        inline: true,
        fields: { [SLOT]: { type: 'slot', allow: BLOCOS_SOLTOS }, avancado },
        defaultProps: { avancado: {} },
        // Soltar o segundo bloco já divide 50/50; o terceiro, em três. O slot desenha a
        // linha, com os lugares de soltar lado a lado.
        render: ({ puck, [SLOT]: Itens, ...props }) => (
          <div ref={puck.dragRef} className={classesDoBloco(props)}>
            <Itens className="alva-linha" collisionAxis="x" minEmptyHeight={72} />
          </div>
        ),
      },
      columns: {
        label: 'Colunas',
        inline: true,
        fields: { estrutura: campoDeProporcao('Proporção das colunas'), [SLOT]: { type: 'slot', disallow: ['field'] }, avancado },
        defaultProps: { estrutura: '1/2+1/2', avancado: {} },
        render: ({ puck, estrutura, [SLOT]: Itens, ...props }) => (
          <div ref={puck.dragRef} className={classesDoBloco(props)}>
            <Itens as="div" className={classeDasColunas({ estrutura })} collisionAxis="dynamic" />
          </div>
        ),
      },
      heading: bloco('heading', 'Título', {
        text: { type: 'textarea', label: 'Texto' },
        level: { type: 'radio', label: 'Nível do título', options: [{ label: 'H1', value: 1 }, { label: 'H2', value: 2 }, { label: 'H3', value: 3 }] },
      }, { text: 'Um título que diz o que a pessoa ganha', level: 2 }),
      text: bloco('text', 'Texto', { text: { type: 'textarea', label: 'Texto' } }, { text: 'Uma ou duas frases que explicam, em palavras simples, por que isso importa.' }),
      button: bloco('button', 'Botão', {
        text: { type: 'text', label: 'Texto' },
        href: { type: 'text', label: 'Link (https://…, #seção, mailto:, tel:)', labelIcon: ICONE_DO_CAMPO.link },
        newTab: { type: 'radio', label: 'Abrir em nova aba', options: simNao },
        corDoBotao: campoDeCor('Cor do botão'),
        corDoBotao2: campoDeCor('Segunda cor (degradê)'),
        direcaoDoDegrade: { type: 'radio', label: 'Direção do degradê', options: [{ label: 'Vertical', value: 'vertical' }, { label: 'Horizontal', value: 'horizontal' }, { label: 'Diagonal', value: 'diagonal' }] },
        corDoTextoDoBotao: campoDeCor('Cor do texto do botão'),
      }, { text: 'Quero saber mais', href: '#contato', newTab: false, corDoBotao: '', corDoBotao2: '', corDoTextoDoBotao: '' }),
      icon: bloco('icon', 'Ícone', { name: campoDeIcone('Ícone') }, { name: 'star' }),
      image: bloco('image', 'Imagem', { src: campoDeImagem('Imagem', enviarImagem), alt: { type: 'text', label: 'Descrição para quem não vê a imagem' } }, { src: '', alt: '' }),
      video: bloco('video', 'Vídeo (YouTube ou Vimeo)', { url: { type: 'text', label: 'Link do vídeo no YouTube ou no Vimeo' }, title: { type: 'text', label: 'Título do vídeo (para leitores de tela)' } }, { url: '', title: '' }),
      vsl: {
        ...bloco('vsl', 'VSL do Studio', { publicId: { type: 'select', label: 'VSL publicada', options: opcoesDeVsl } }, { publicId: '' }),
        // No canvas, a VSL escolhida já aparece tocando: o player do próprio Studio. O
        // clique vai para o bloco (selecionar, arrastar), não para o vídeo.
        render: ({ puck, id: _id, ...props }) => (
          <div ref={puck.dragRef} className={classesDoBloco(props)}>
            {/^[A-Za-z0-9_-]{16,32}$/.test(props.publicId ?? '')
              ? <iframe className="alva-vsl-frame" src={`${window.location.origin}/embed/v/${props.publicId}?previa=1`} title="VSL" allow="autoplay; fullscreen" style={{ pointerEvents: 'none' }} />
              : <Miolo type="vsl" props={props} />}
          </div>
        ),
      },
      form: {
        label: 'Formulário',
        inline: true,
        fields: {
          submitLabel: { type: 'text', label: 'Texto do botão' },
          aviso: { type: 'textarea', label: 'Aviso de privacidade (abaixo do botão)' },
          politica: { type: 'text', label: 'Link da política de privacidade (https://…)' },
          [SLOT]: { type: 'slot', allow: ['field'] },
          avancado,
        },
        defaultProps: { submitLabel: 'Enviar', aviso: AVISO_DE_PRIVACIDADE, politica: '', avancado: {} },
        // A captura precisa de um UUID estável, que o Puck não dá: nasce aqui, uma vez.
        resolveData: ({ props }) => (props.captureId ? { props } : { props: { ...props, captureId: globalThis.crypto.randomUUID() } }),
        render: ({ puck, submitLabel, [SLOT]: Itens, ...props }) => (
          <div ref={puck.dragRef} className={classesDoBloco(props)}>
            <form className="alva-form" onSubmit={(evento) => evento.preventDefault()}>
              <Itens />
              <button type="submit" className="cta">{submitLabel || 'Enviar'}</button>
              <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: avisoDePrivacidade(props) }} />
            </form>
          </div>
        ),
      },
      field: {
        label: 'Campo',
        fields: {
          label: { type: 'text', label: 'Pergunta' },
          name: { type: 'text', label: 'Nome do campo (vai para o lead)' },
          fieldType: { type: 'select', label: 'Tipo de resposta', options: [
            { label: 'Texto', value: 'text' }, { label: 'E-mail', value: 'email' }, { label: 'Telefone', value: 'tel' },
            { label: 'Número', value: 'number' }, { label: 'Texto longo', value: 'long_text' },
          ] },
          placeholder: { type: 'text', label: 'Exemplo dentro do campo' },
          required: { type: 'radio', label: 'Obrigatório', options: simNao },
        },
        defaultProps: { label: 'Seu e-mail', name: 'email', fieldType: 'email', placeholder: 'voce@exemplo.com', required: true },
        render: ({ puck: _puck, id: _id, ...props }) => <Miolo type="field" props={props} />,
      },
    },
  };
}
