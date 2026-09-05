# Relatório final — formulários públicos SaaS

Data: 2026-09-04

## Resultado

- A resolução por domínio exige empresa e projeto ativos, domínio de produção, canônico e com `verification_status = 'verified'`.
- A resolução pelo namespace local também recusa empresa ou projeto arquivado.
- Domínios importados pendentes, domínios não canônicos e domínios de preview não servem formulários.
- O roteamento público usa um parser único para GET e POST, decodifica cada segmento com segurança e preserva o namespace empresa/projeto.
- Rotas de formulário válidas como `/`, `/a` e `/x/y` geram `publicPath`, renderizam e recebem submissões.
- Criação, atualização, publicação e renderização reutilizam `normalizeFormInput`, construído com os normalizadores já usados pelo formulário local.
- Schemas sem `steps`, com `steps` malformado ou vazios retornam 400 antes de persistir ou publicar. Um schema rico válido é normalizado, publicado e renderizado.

## TDD

Os três testes de regressão falharam antes da implementação:

- schema `{}` foi criado com 201 em vez de ser recusado com 400;
- a rota pública raiz retornou 404;
- domínio não canônico respondeu 200 em vez de 404.

Depois das alterações, os três casos passaram. Fixtures diretas do repositório que ainda usavam o antigo JSON livre foram atualizadas para schemas válidos.

## Validação final sequencial

1. Foco: 3 testes, 3 passaram.
2. Servidor: 6 testes, 6 passaram.
3. Suíte Studio: 122 testes, 122 passaram.

`git diff --check` não encontrou erros. Prettier e ESLint não estavam instalados neste clone, portanto a checagem automatizada de estilo não pôde ser executada. Antes dos comandos Git, `hermes mcp list` informou que não há servidores configurados e `hermes mcp test github` confirmou que o servidor `github` não existe na configuração.

Nenhum arquivo de documentação do produto, MAPA, migração ou controle de acesso foi alterado.
