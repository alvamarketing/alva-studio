# server

- `index.mjs`: servidor HTTP local e rotas.
- `store.mjs`: persistência e revisões das páginas.
- `form-store.mjs`: persistência, validação, arquivos e respostas dos formulários dinâmicos.
- `dynamic-form.mjs`: documento público sequencial com mídia, gráficos, movimento e confirmação de envio.
- `publisher.mjs`: chamadas à Vercel.

Autenticação do dono, sessões e configurações protegidas de integração são mantidas pelos módulos de conta nesta pasta.

- `auth.mjs`: conta do dono, sessões e credencial Vercel cifrada em disco.
