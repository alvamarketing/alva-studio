---
no: conectar-facebook-f2
status: pendente
---
# Conectar com o Facebook — F2 (conferência independente, 02/10/2026)

Seção do wireframe: "Empresa e equipe" (cartões "Dados da empresa" e "Equipe").

Conferido por agente independente (não o construtor), em harness com `styles.css`/`owner.css` e
`conexao-meta-ui.js` reais, em 1280 e 390 px, nos estados: carregando, desconectado, automático,
várias contas, vence em ≤7 dias + termos pendentes, manual existente, precisa reconectar, erro de
contas, sem contas, sem pixel. Screenshots no scratchpad da sessão de 02/10/2026
(`shots/f2-*.png`, `shots/v2-*.png`, wireframe em `shots/wireframe-empresa-equipe-*.png`).

Suíte: 1394/1394 na branch; migração 035 em Postgres 16.6: ok (duas aplicações, só para frente).
Veredito final do conferente: APROVADO. Achado N1 (prazo do token curto gravado como prazo do
longo) corrigido na integração, com teste.

Pendente para "feito": conferência visual na tela REAL (com sessão e a Meta de verdade), lado a
lado com o wireframe, em desktop e celular, e screenshots copiados para `.estado/screenshots/`.

Conhecido e aceito (registrado na spec): conta de anúncios pessoal fora de portfólio não aparece;
um portfólio com erro de permissão derruba a lista inteira; reconectar com outra pessoa mantém a
escolha anterior; dois cliques em abas diferentes podem misturar; chip "Manual" no mesmo azul de
"Conectado"; `debug_token` sem `appsecret_proof` (com token do app não é exigido).
