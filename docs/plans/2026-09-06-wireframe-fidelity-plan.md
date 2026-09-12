# Fidelidade visual ao wireframe do Alva Studio

## Objetivo

Aplicar ao Studio real, sem reinterpretar, o contrato visual de
`docs/wireframes/alva-studio-ui-reference.html`. Dados, permissões, APIs,
persistência e integrações existentes permanecem funcionais. A mudança é do
shell, da hierarquia visual e da apresentação dos controles.

## Restrições globais

- O wireframe canônico é a única referência de UI.
- Reutilizar os tokens da seção **Biblioteca visual**: Inter, `#286eea`,
  `#edf4ff`, `#101828`, `#667085`, `#98a2b3`, `#e1e7ef`, `#f6f8fb`, branco,
  sucesso `#20a464` e sombra `0 12px 35px #1018280c`.
- Não criar uma segunda linguagem visual nem novos raios, sombras ou escalas.
- Preservar IDs, handlers, permissões, validações, salvamento e APIs.
- VSL continua preservada como V2 e oculta quando a flag está desligada.
- Cada bloco recebe implementação e revisão independentes.
- Pronto exige comparação visual em desktop e celular, além dos testes.

## Bloco 1 — Design system, Home e Projeto

Seções canônicas: **Biblioteca visual**, **Seus projetos**, **Histórico**,
**Conteúdos do projeto**, **Estrutura do projeto** e
**Visitas nos últimos 7 dias**.

- Alinhar tokens globais, tipografia e superfícies.
- Reproduzir sidebar, rodapé de três ícones e troca de contexto.
- Reproduzir cards quadrados de projeto e histórico em lista.
- Reproduzir o overview do projeto, suas quatro métricas, conteúdos, estrutura
  e gráfico no mesmo grid do wireframe.
- Manter os dados reais e estados vazios do produto.

Arquivos principais: `styles.css`, `index.html`, `app.js`,
`studio-dashboard.js`.

## Bloco 2 — Editor de landing pages

Seção canônica: **Landing · Imobiliárias**.

- Header de 64 px com voltar, título, estado e ações textuais.
- Árvore visual com seções, elementos, contadores e inserção contextual.
- Canvas com régua, moldura e seleção visual canônica.
- Inspetor orientado ao tipo, com controles existentes reorganizados.
- Breakpoints de 1050 px e 760 px conforme a referência.

Arquivos principais: `editor-shell.js`, `editor-shell.css` e estilos escopados
do header existente.

## Bloco 3 — Editor de quizzes

Seção canônica: **Formulário · Diagnóstico comercial**.

- Header de 64 px com título, estado, Prévia, Respostas e Salvar.
- Árvore única para topo e telas, com hierarquia e inserção contextual.
- Canvas composto como microlanding page, sem megacards por elemento.
- Seleção por outline, etiqueta e ponto de inserção.
- Inspetor específico para o elemento, incluindo opções visuais estruturadas.
- Breakpoints de 1050 px e 760 px conforme a referência.

Arquivos principais: `forms.js`, `forms.css` e estilos escopados do header.

## Bloco 4 — Configurações e superfícies restantes

Seções canônicas: **Configurações**, **Empresa e equipe**, **Páginas** e
**Quizzes**.

- Aplicar o mesmo shell, navegação, densidade e componentes às telas restantes.
- Transformar configurações em página e manter conta, empresa, equipe,
  publicação e cobrança nas áreas previstas.
- Manter listas quando necessárias ao produto, usando os componentes exatos da
  biblioteca visual.

## Validação e fechamento

- Testes focados por bloco.
- Comparação lado a lado com o wireframe em desktop e celular, registrada em
  `.estado/wireframe_fidelity.md` com os screenshots.
- Uma revisão independente por bloco e uma revisão final integrada.
- Suíte completa uma vez no fechamento.
- Commit e push somente após todos os gates locais.

## Resultado

- Blocos 1 a 4 implementados e aprovados por revisores independentes.
- Comparação integrada aprovada em desktop e em viewports móveis de 433 px e 355 px.
- Suíte final: 528 testes aprovados e 0 falhas.
- Decisões e pareceres consolidados em `.estado/wireframe_fidelity.md`.
