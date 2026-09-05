# Studio

- `server/`: HTTP, fundação PostgreSQL multiempresa, compatibilidade local, publicação por projeto e integração Vercel.
- `public/`: interface, editores e seção de publicação por projeto.
- `vsl-html.js`: tokenizador HTML compartilhado que transforma somente elementos reais e preserva comentários e raw text.
- `test/`: testes automatizados.
- `README.md`: uso, configuração e limites.
- `package.json` e `pnpm-lock.yaml`: dependências e comandos.
- `.data/`: dados locais gerados, ignorados pelo Git; fonte de inspeção e importação na transição ao SaaS.
