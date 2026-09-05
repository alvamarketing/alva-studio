---
no: publicacao_por_projeto
status: feito
---

# Publicação por projeto

Concluído em 2026-09-05.

- Um snapshot determinístico reúne todas as landing pages e formulários publicados do projeto.
- Prévia e produção usam o mesmo projeto Vercel, com rotas completas e confirmação humana para produção.
- Token cifrado permanece no servidor; respostas e configurações públicas não expõem credenciais.
- Execuções são idempotentes, usam claim com fencing e preservam falhas e estados da Vercel.
- Formulários publicados enviam respostas ao Studio com CORS restrito ao próprio projeto.
- Domínios não podem ser transferidos silenciosamente entre empresas ou projetos.
- A seção Publicação apresenta conexão, rotas, estados, prévia, produção e domínio em linguagem simples.
- Revisões independentes: aprovadas após correções de segurança e concorrência.
- Suíte final: 194 testes aprovados, 0 falhas.
- Homologação real com uma conta Vercel permanece como validação externa antes de produção.
