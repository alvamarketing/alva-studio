---
no: editor-pacote-a1
status: pendente
---
# Editor, pacote A1: âncora, formulário e dados da página — 03/10/2026
Pedido do dono: âncora de seção (#contato), formulário editável com tipos novos e campos lado a lado,
descrição e imagem de compartilhamento. Telas: formulário e campos de raiz no painel do editor (seção
"Biblioteca visual" › campos); páginas publicadas (HTML puro).

Conferência independente, focada em risco (servidor local, Postgres descartável, gateway publicado de
verdade, 31 envios forjados): opção inexistente, tipo trocado, campo extra reservado, __proto__, corpo
de 6 MB (413), isca preenchida (200 sem gravar), CSV com fórmula escapada, HTML do visitante escapado,
redirecionamento só http/https. Páginas e quiz publicados ANTES da mudança continuam enviando e gravando.
Achado corrigido na integração: redirecionamento com usuário/senha (https://banco.com@outro.site/) agora
recusado no editor e no servidor (mesma função). Suíte 1505/1505.

Pendente para "feito": trocar o tipo de um campo no editor; tela de Leads aberta no navegador; atraso de
2 s do redirecionamento com pixel real; comparação visual com o wireframe; teste real na produção.
Observações: isca descarta sem contagem (autopreenchimento do navegador pode perder um lead verdadeiro:
contar os descartes); duas seções com a mesma âncora geram dois ids (o editor avisa); páginas já publicadas
só ganham âncora, isca e metadados ao serem salvas e publicadas de novo.
