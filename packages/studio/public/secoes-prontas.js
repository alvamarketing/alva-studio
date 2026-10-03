// As seções prontas do editor: arrastar uma já traz a faixa montada, com texto de exemplo
// para trocar. É a regra mais bem avaliada da pesquisa de UX de 27/09
// (docs/specs/2026-09-27-ux-do-editor.md): quem não sabe design começa de algo pronto.
const no = (type, props = {}, children = []) => ({ type, props, children });

export const secoesProntas = [
  {
    id: 'secao-topo',
    nome: 'Topo com chamada',
    props: { fundo: 'escuro', respiro: 'g', alinhamento: 'centro' },
    conteudo: () => [
      no('heading', { text: '[Sua oferta] para [quem ela serve]', level: 1 }),
      no('text', { text: 'Uma frase sobre o resultado que a pessoa leva, sem prometer o que você não pode provar.' }),
      no('button', { text: 'Quero saber mais', href: '#contato', newTab: false }),
    ],
  },
  {
    id: 'secao-beneficios',
    nome: 'Três benefícios',
    props: { fundo: 'branco', alinhamento: 'centro' },
    conteudo: () => [
      no('heading', { text: 'Por que vale a pena', level: 2 }),
      no('row', {}, [
        no('icon', { name: 'bolt' }), no('icon', { name: 'schedule' }), no('icon', { name: 'verified' }),
      ]),
      no('row', {}, [
        no('text', { text: '[Primeiro benefício, em uma frase]' }),
        no('text', { text: '[Segundo benefício, em uma frase]' }),
        no('text', { text: '[Terceiro benefício, em uma frase]' }),
      ]),
    ],
  },
  {
    id: 'secao-depoimento',
    nome: 'Depoimento',
    props: { fundo: 'suave', alinhamento: 'centro' },
    conteudo: () => [
      no('icon', { name: 'format_quote' }),
      no('text', { text: '"[Cole aqui um depoimento real de um cliente, com a autorização dele.]"' }),
      no('text', { text: '[Nome do cliente] · [Empresa]' }),
    ],
  },
  {
    id: 'secao-chamada',
    nome: 'Chamada final',
    props: { fundo: 'escuro', respiro: 'g', alinhamento: 'centro' },
    conteudo: () => [
      no('heading', { text: 'Pronto para começar?', level: 2 }),
      no('button', { text: 'Falar com a gente', href: '#contato', newTab: false }),
    ],
  },
  {
    id: 'secao-contato',
    nome: 'Contato com formulário',
    // A âncora "contato" é para onde os botões das outras seções prontas já apontam.
    props: { fundo: 'suave', alinhamento: 'centro', ancora: 'contato' },
    conteudo: () => [
      no('heading', { text: 'Fale com a gente', level: 2 }),
      no('text', { text: 'Deixe seu contato e respondemos em até um dia útil.' }),
      no('form', { submitLabel: 'Enviar', avancado: { largura: '2/3' } }, [
        no('field', { label: 'Nome', name: 'nome', fieldType: 'text', placeholder: 'Seu nome', required: true }),
        no('field', { label: 'E-mail', name: 'email', fieldType: 'email', placeholder: 'voce@exemplo.com', required: true }),
        no('field', { label: 'WhatsApp', name: 'whatsapp', fieldType: 'tel', placeholder: '(11) 91234-5678', required: false }),
      ]),
    ],
  },
];

export const TIPOS_DE_SECAO_PRONTA = new Set(secoesProntas.map((secao) => secao.id));

// O formulário que entra pela biblioteca já vem com o básico de um lead. Antes ele nascia
// vazio, e o "Campo" só era achado por acaso na biblioteca.
export const camposPadraoDoFormulario = () => [
  no('field', { label: 'Nome', name: 'nome', fieldType: 'text', placeholder: 'Seu nome', required: true, largura: 'inteira' }),
  no('field', { label: 'E-mail', name: 'email', fieldType: 'email', placeholder: 'voce@exemplo.com', required: true, largura: 'inteira' }),
  no('field', { label: 'Telefone', name: 'telefone', fieldType: 'tel', placeholder: '(11) 91234-5678', required: false, largura: 'inteira' }),
];
