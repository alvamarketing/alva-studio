# Alva Studio — 2026-09-04

Original. Escopo derivado da conversa com Tai: construir landing pages rapidamente com GrapesJS, modelos, formulário e publicação independente por projeto/domínio na Vercel.

## Primeira versão
Painel local de uso individual com páginas criáveis, duplicáveis, renomeáveis e removíveis; editor GrapesJS em português; modelos de serviços e página vazia; visualização de celular; salvar/reabrir projeto JSON; exportar HTML; configurar formulário com destino HTTPS; preparar/publicar versões via API Vercel.

O fork contém TypeScript, GrapesJS 0.23.6 e testes Jest confirmados nos manifests. O aplicativo adicional utiliza Node.js >=22 e JavaScript ESM, com testes node:test, sem alterar o núcleo original. Armazenamento local em disco, com escrita atômica e revisão para evitar sobreposição. O núcleo instalado é a release 0.23.6 correspondente ao fork; alterações futuras no núcleo exigirão vinculá-lo ao build local.

O painel escuta apenas 127.0.0.1; não deve ser publicado como SaaS nesta etapa. Multiusuário, autenticação pública e armazenamento remoto são uma etapa separada. Páginas exportadas são estáticas. Formulários enviam diretamente ao endpoint HTTPS configurado; esse endpoint precisa aceitar POST de formulário e responder ao visitante. Não existe inbox de leads nesta etapa.

Vercel: token somente no ambiente do servidor, projeto estável por landing page, publicação explícita e estado real consultado; configurar DNS no provedor continua necessário. Não realizar publicação externa nesta implementação sem confirmação do dono.

Critério: criar, salvar, reabrir, duplicar e excluir preserva isolamento; revisões antigas são rejeitadas; exportação não contém editor nem credenciais; integração Vercel testada com transporte simulado, sem representar isso como deploy real.
