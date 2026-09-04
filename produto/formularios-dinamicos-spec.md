# Formulários Dinâmicos — especificação funcional

## Objetivo

Adicionar ao Alva Studio uma área chamada **Formulários Dinâmicos**, ao lado de **Páginas**, para criar experiências sequenciais de captação sem código.

## Experiência do dono

- Criar, listar, renomear, duplicar e excluir formulários.
- Montar sequências com texto curto e longo, e-mail, telefone, escolhas única e múltipla, data, número, escala, endereço e arquivo.
- Intercalar perguntas com imagem, vídeo, tela informativa, botão de ação e gráfico de barras ou circular.
- Editar título, descrição, obrigatoriedade, placeholder e opções de cada etapa.
- Escolher um ícone Material Symbols e um movimento para cada etapa.
- Reordenar etapas e visualizar o formulário durante a edição.
- Configurar título e mensagem de conclusão e um webhook HTTPS opcional.
- Abrir o formulário por um link público e consultar as respostas no Studio.

## Experiência do visitante

- Ver uma pergunta por vez com progresso, voltar e avançar.
- Ver transições, fundos vivos e gráficos animados, respeitando a preferência do sistema por menos movimento.
- Receber validação clara dos campos obrigatórios.
- Enviar uma única resposta ao final e ver a confirmação configurada.
- Usar o formulário por teclado e em telas pequenas.

## Dados e segurança

- Formulários e respostas ficam em arquivos separados dentro de `DATA_DIR`.
- Rotas de administração exigem a sessão do dono.
- A rota pública aceita somente campos previstos no formulário publicado.
- O webhook aceita apenas HTTPS, recebe JSON e nunca bloqueia o armazenamento local da resposta.
- Respostas têm identificador, data e respostas normalizadas; valores são limitados em tamanho.
- Arquivos aceitos são imagens, PDF ou documento, com limite de 3 MB.

## Fora desta primeira versão

Ramificações condicionais, métricas por etapa, pixels, colaboração e publicação Vercel serão adicionados depois que o fluxo linear estiver sendo usado e medido.
