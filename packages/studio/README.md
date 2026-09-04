# Alva Studio

Original. Primeira versão local de um construtor de landing pages para a Alva Marketing. Usa GrapesJS 0.23.6 sem alterar o núcleo original do fork.

## Executar

Requer Node.js 22 ou superior e pnpm 9.

```sh
cd packages/studio
pnpm --ignore-workspace install --frozen-lockfile
pnpm --ignore-workspace start
```

Abra o endereço impresso (padrão: http://127.0.0.1:4178). O pacote possui seu próprio lockfile para executar sem instalar documentação e ferramentas de desenvolvimento do núcleo.

## O que funciona nesta versão

- Criar, buscar, renomear, duplicar e excluir páginas locais.
- Editor visual, blocos, modelo de serviços, página em branco e tamanhos de tela.
- Salvamento automático do projeto completo em `.data/pages.json`, com revisão e escrita atômica.
- Prévia isolada sem executar scripts/formulários e download de HTML com CSS e JavaScript.
- Campos editáveis: nome, tipo, placeholder e obrigatoriedade na aba de atributos.
- Configurar destino HTTPS para POST direto do formulário. O receptor precisa aceitar `application/x-www-form-urlencoded` e responder com a confirmação; webhooks exclusivamente JSON exigem adaptador. Nenhuma caixa de leads é mantida neste painel.
- Conector Vercel: enviar HTML para projeto estável por página, consultar estado e adicionar domínio.

## Vercel

Crie um arquivo `.env` neste pacote, ignorado pelo Git, com `VERCEL_TOKEN` e, se a conta usar equipe, `VERCEL_TEAM_ID`. Não insira esses valores nas páginas nem no Git. Reinicie o servidor.

Salvar mantém um rascunho. Publicar requer ação explícita. A publicação enviada pode estar QUEUED/BUILDING; consulte o estado em Configurar. Só READY indica conclusão informada pela Vercel. Cada página usa um projeto `alva-<id>`. O domínio deve ser de sua propriedade; o apontamento e a eventual verificação DNS são configurados no provedor e na Vercel. Os limites e custos do plano da conta continuam aplicáveis.

Excluir uma página local não remove projetos ou domínios da Vercel. Duplicar limpa o vínculo de publicação e o domínio, mas mantém o destino do formulário; revise-o se a cópia for para outro cliente.

## Limites

Painel individual, vinculado exclusivamente a 127.0.0.1. Não publique este servidor na internet: ele ainda não tem login, isolamento entre usuários ou banco remoto. A persistência local não é adequada a funções efêmeras da Vercel. Faça backup de `.data/`. Um único processo deve usar cada diretório de dados.

O editor usa a release npm correspondente ao fork. Modificar `packages/core/src` não altera automaticamente a biblioteca servida pelo Studio; isso requer compilar/vincular o núcleo. Assets enviados pelo editor podem ser incorporados como base64; limite de salvamento de 8 MiB. Para páginas maiores, use URLs de mídia.

## Verificar

```sh
node --test test/*.test.mjs
```

Testes de Vercel usam transporte simulado: não comprovam credencial, domínio nem deploy real. Não há teste visual automatizado nesta etapa.
