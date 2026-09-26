---
no: configuracao-de-pixels
status: feito
---

# Configuração de pixels no projeto

## O buraco

A rota `PUT /api/projects/:id/tracking/destinations/:provider` existia e
funcionava desde antes, mas **nada na interface a chamava**. O bloco "Destinos"
da tela de Rastreamento só mostrava os cinco provedores com "Enviando" ou "Sem
envios", derivado das entregas. Não havia como um dono de projeto informar o
pixel dele pelo Studio: a única forma era uma chamada HTTP à mão.

Faltavam também duas peças no servidor para a tela existir: ler o que já está
configurado (sem devolver segredo) e desconfigurar um destino.

## Seção do wireframe

Referência: `docs/wireframes/alva-studio-ui-reference.html`.

O wireframe **não desenha a tela de Rastreamento** — ela aparece apenas como
item de menu (`r0127`). Nesse caso a seção que rege é a **"Biblioteca visual"**
(`r0306`), como manda o AGENTS.md: tipografia, botões e campos saem de lá, e
nada de cor, raio, sombra ou tamanho novo é inventado.

Tokens reaproveitados, todos já existentes em `packages/studio/public/styles.css`:
`--alva-line`, `--alva-ink`, `--alva-muted`, `--alva-blue`, `--alva-danger`,
`--radius-sm`, `--text-sm`, `--text-md`. O formulário herda a altura de 36px e a
borda de 1px que o `.control` da própria tela já usava.

## Decisões que valem registro

**O segredo entra e não volta.** O token é gravado cifrado e o servidor nunca o
devolve, então o campo dele aparece sempre vazio, mesmo num destino configurado.
Deixá-lo em branco ao salvar significa *manter o que está lá* — sem isso,
corrigir o número de um pixel exigiria redigitar um token que a pessoa
provavelmente não tem mais à mão.

**Configurado e entregando são estados diferentes.** Credencial salva que nunca
entregou nada é exatamente o caso que faz alguém desconfiar da configuração, e a
tela distingue "Configurado" de "Enviando" em vez de juntar os dois.

**Não conseguir ler não é "nada configurado".** Se a leitura dos destinos falha,
o bloco diz que falhou. Desenhar os cinco como "Não configurado" diria ao dono do
projeto que o pixel dele sumiu.

**Permissão.** A tela abre com `analytics.read`, mas gravar credencial é
`integration.manage`. Sem a segunda, o estado continua visível e o formulário não
aparece — em vez de preencher tudo para receber 403 no envio.

**O contrato de campos não é duplicado.** O que a tela pergunta é conferido
contra o que o servidor aceita (`CAMPOS_POR_DESTINO` e
`CAMPOS_EXIGIDOS_POR_DESTINO`, exportados do repositório) por um teste. Se as
duas listas andarem separadas, o teste fica vermelho antes de alguém preencher um
formulário para ouvir "Configuração do destino inválida".

## O que foi conferido contra o app rodando

Studio local em `https://alva.orb.local`, autenticado, projeto real, com as rotas
de verdade — nada dublado.

**A mescla parcial, que é a promessa mais arriscada da tela.** Salvei o destino
Meta com `pixel_id` e um token conhecido; depois salvei de novo mandando **só** o
`pixel_id`, como a tela faz quando o campo do token fica em branco. Decifrando a
credencial guardada logo em seguida, dentro do container:

    GUARDADO: {"meta":{"pixel_id":"999888777666555","access_token":"SEGREDO-ORIGINAL-abc123"}}

O identificador trocou; o segredo continuou o mesmo. Era isso que precisava ser
provado, e não dava para provar só com teste de unidade dos dois lados.

**O segredo não volta na leitura.** A resposta do `GET` foi conferida inteira
contra o valor do token salvo: não aparece.

**Prévia e produção não se misturam.** Com a Meta configurada em produção, o
`GET` de prévia devolve os cinco destinos não configurados.

**Remover o último destino não deixa trabalho condenado.** Antes: um job
`queued` por ambiente. Depois de remover o único destino de produção: sobrou o
job da prévia, o de produção saiu, o binding voltou a `pending` sem erro, e a
linha da credencial sumiu do banco. Conferi no código que `markReady` devolve
`null` quando o job sumiu e **não** marca o binding como pronto — então um
provisionamento em voo no momento da remoção simplesmente não faz nada, em vez
de dar o projeto por pronto sem destino.

## Evidência

- `.estado/screenshots/configuracao-de-pixels-destinos-desktop.png` — 1440×1400
- `.estado/screenshots/configuracao-de-pixels-destinos-mobile-390.png` — 390×1400

As duas capturas saíram do Chrome sem cabeça, autenticadas, lendo a rota real.

Suíte completa: **1122 testes, 0 falhas.**

## O que ficou de fora

A entrega em si não foi exercitada ponta a ponta contra as plataformas: a flag
`CONVERSIONS_ENABLED` continua `false` no ambiente local, e a tela avisa isso em
vez de deixar alguém concluir que o pixel está entregando. Ligar a flag e ver um
evento chegar na Meta é verificação de outra natureza, com credencial de verdade.

Os destinos que usei para as capturas foram removidos do banco local depois —
um pixel fictício guardado ali viraria falha de entrega inexplicável mais tarde.
