---
no: editor-imagem-e-arrastar
status: pendente
---
# Editor de páginas: imagem sem endereço (E1), arrastar entre zonas (E2) e barra do topo — 02/10/2026
Seções do wireframe: "Biblioteca visual" › botão tracejado; "Configure sua VSL" › "+ Escolher imagem";
"Estrutura" (ordem das ações do topo). A barra do topo (logo, voltar + nome, alças nas pontas da faixa de
ícones) foi pedida pelo dono e se afasta do wireframe; atualizar o wireframe depois.

Conferência independente (app local, Postgres descartável, main × branch, Chromium headless, 1280/1440 e
canvas celular 390). E1: lugar da imagem com 180 px (na main, 0 px); envio assíncrono grava no bloco certo
em 4 trocas de seleção; arquivo solto não abre mais aba; erros de tamanho e tipo legíveis; rota /images
valida no servidor. E2: 4 casos do construtor 4/12→11/12 (1440), 8/12→11/12 (1280), 3/12→6/12 (celular);
canvas = página publicada nos modelos e na página com colunas/metades.
Corrigido depois da conferência: bloco apagado durante o envio travava em "Enviando…" (o Puck lança erro);
erro antigo ficava na barra lateral; espaço da imagem sem teclado (agora botão com Enter/Espaço e foco);
peso de letra 650 → 600. Suíte 1469/1469.

Pendente para "feito": ida e volta nas Colunas e no canvas celular ainda falha (código de colisão do Puck);
conferência na produção, lado a lado com o wireframe, desktop e celular, com toque real; a barra do topo
só foi vista em Chromium headless (1440 e 390), não em produção.
Conhecido: imagem com endereço sem https:// não avisa; "Três benefícios" mostra 2 por linha no editor e 3
na publicada (já era assim antes).
