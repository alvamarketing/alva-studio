---
no: redesenho-rastreamento
status: pendente
---
# Rastreamento → cartão "Plataformas" (conferência independente, 02/10/2026, 2 rodadas)
Seções do wireframe: "Biblioteca visual" › "Opção visual" e "Empresa e equipe".
O wireframe não prevê grade de plataformas, botão de marca, chips em fileira nem cartão recolhível:
a tela se afasta dele nesses pontos por pedido do dono (02/10/2026). Atualizar o wireframe depois.

Conferido por agente independente no app real local (Postgres descartável; rotas da Meta e dos
públicos simuladas), 1280 e 390 px, claro e escuro. Formulário manual: 124 comparações antigo×novo
(5 plataformas × prévia/produção), corpo da API idêntico. Achados A1–A4, A6, A7 corrigidos e
reconferidos; N1 (mensagem dos públicos) e N2 (azul do botão do Facebook = #1877F2, da doc oficial
do Login do Facebook) corrigidos na integração. Suíte 1445/1445.
Screenshots: scratchpad da sessão de 02/10 `conf/shots2/*.png` (copiar para .estado/screenshots/).

Exceção autorizada pelo dono: cores oficiais das marcas (bloco `--marca-*` de owner.css), só em logos
e no botão do Facebook. LinkedIn e Taboola ficam com inicial (simple-icons não os tem).

Pendente para "feito": conferência visual na produção, com sessão real, lado a lado com o wireframe,
em desktop e celular; estados "Enviando" e carregando só testados em JSDOM.
