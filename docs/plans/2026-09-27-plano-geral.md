# Plano geral do Alva Studio

27/09/2026. Tudo o que falta, num lugar só: da conta da Vercel ao Puck, passando
pelo rastreamento, pelo esquema de página, pelo quiz e pela VSL.

Junta quatro fontes que até hoje moravam separadas — e uma delas só na conversa:
o roteiro das dez etapas combinado com o dono, a auditoria de 27/09, a simulação
de entrada de leads e as pontas soltas registradas pelo caminho.

---

## O plano em uma frase

**Primeiro o rastreamento passa a dizer a verdade, depois a página ganha uma
fundação que é do Alva, e só então o editor troca** — porque o rastreamento mexe
com dinheiro de anúncio e independe do editor, e o editor novo precisa de um chão
firme para pisar.

## A ordem

| Fase | O que é | Tamanho | Por que nesta posição |
|---|---|---|---|
| **0** | Conta e ambiente | pequeno | ações do dono, destravam o resto |
| **1** | O rastreamento dizer a verdade | médio | mexe em dinheiro de anúncio; independe do editor |
| **2** | O esquema do jeito certo | médio | o chão do editor novo |
| **3** | Puck | grande | precisa do esquema pronto |
| **4** | Quiz como jornada | médio | precisa do Puck |
| **5** | VSL | pequeno | dois itens moram nas fases 2 e 3 |
| **6** | As etapas de produto que faltam | grande | dependem das fases 1 a 4 |
| **7** | Pontas soltas | pequeno | podem correr em paralelo a qualquer fase |

Tamanho é relativo entre as fases, não prazo.

---

## As regras que valem para todas as fases

Vieram da auditoria, e cada uma existe porque a falta dela produziu um defeito real.

1. **Toda cadeia tem um teste que atravessa o caminho de produção de ponta a
   ponta.** Os dois defeitos graves de 26/09 nasceram de testar a peça com
   entrada inventada.
2. **Quem constrói não é quem confere.** O AGENTS.md já exige; até aqui eu
   conferi as minhas próprias telas. A partir desta fase, a verificação de cada
   passo é feita por um agente que não o escreveu.
3. **Commit só afirma o que foi provado.** Três commits de 26/09 afirmavam coisas
   falsas.
4. **Cada passo termina verde e commitado antes do próximo começar.**

---

## Fase 0 — Conta e ambiente

| # | O que | Quem |
|---|---|---|
| 0.1 | **Trocar o slug do time na Vercel** (`valariangm`). Ele aparece em toda prévia de cliente que o Studio publica. Vercel → Settings do time → General → Team URL. Muda os endereços automáticos existentes. | dono |
| 0.2 | **Apagar o projeto `alva-sonda-leads`.** Cumpriu o papel; é uma página pública que devolve os cabeçalhos de quem a acessa. | eu, com o ok do dono |
| 0.3 | **Autorizar o Composio**, se for usar. Pelas configurações de conectores do claude.ai, ou `/mcp` num terminal interativo. | dono |
| 0.4 | **Escrever o roteiro das dez etapas no repositório.** Ele existe só na conversa. | eu |

---

## Fase 1 — O rastreamento dizer a verdade

### 1.1 IP e navegador pelo gateway, assinados

**O defeito**, confirmado na Vercel real: o servidor recebe o IP da própria
Vercel (`98.81.200.226`) e o navegador `node` para todo visitante, e é isso que
iria para a Meta.

**O conserto**: o gateway lê o IP de quem visita e o navegador — a Vercel entrega
o IP em `x-forwarded-for`, `x-real-ip` e `x-vercel-forwarded-for`, e o navegador
em `user-agent` — e os repassa em campos próprios, **dentro da assinatura HMAC**.
Hoje a assinatura cobre método, caminho, publicação, ambiente, instante, nonce e
corpo, mas nenhum cabeçalho. O Studio só confia nesses valores quando vierem
assinados; sem assinatura, não envia nada, porque nada é melhor que falso.

As duas cópias do gateway mudam juntas — a em Node e o módulo publicado na
Vercel —, com o teste de acordo entre elas ampliado para cobrir os campos novos.

**Prova**: a sonda na Vercel mostra o servidor enxergando o IP e o navegador da
pessoa; `test/entrada-de-leads.test.mjs` passa a afirmar isso, em vez de só
relatar.

### 1.2 UTM até a conversão — *decisão do dono*

**O achado**: UTM chega à conversão em **0 dos 25** cenários simulados.

**O conserto**: gravar UTM no mesmo cookie assinado do runtime que já carrega o
identificador de clique, e levá-la até o evento. É o que permite ver, no painel
do anúncio, qual campanha e qual criativo trouxeram o lead.

**Recomendação: fazer.**

### 1.3 O Google e os leads que não são dele — *decisão do dono*

**O achado**: todo lead de Facebook, TikTok, direto ou orgânico vira entrega
recusada pelo Google — sem `gclid` e sem e-mail hasheado, ele não tem como
atribuir. A tela de rastreamento mostraria o Google como quebrado.

**Dois caminhos**: ou a fila deixa de endereçar ao Google o evento que ele não
tem como atribuir, ou a tela passa a distinguir "recusado por não ter como
atribuir" de "falhou".

**Recomendação: não enfileirar.** No momento de enfileirar já se sabe se há
`gclid` e se há consentimento; decidir ali é determinístico e mantém a tela
honesta sem precisar de uma categoria nova.

### 1.4 Fechar os limites da simulação

Três coisas que a simulação de 27/09 não cobriu, ditas no próprio relatório:

- o **referer** na Vercel, que ficou sem teste por erro no meu comando de envio;
- as **UTMs no analytics** — o coletor, que grava UTM na sessão, não foi chamado;
- as **UTMs estranhas** (600 caracteres, script, emoji) chegando às telas de
  Analytics — conferir que a interface as escapa ao desenhar.

### 1.5 A prova na Vercel de verdade

Com 1.1 a 1.3 prontos: publicar uma landing real na Vercel, com o Studio local
alcançável por túnel, mandar tráfego e ver o lead chegar ao banco com a
atribuição inteira.

E, se o dono configurar um **pixel de teste da Meta**: mandar eventos de teste e
ler a **nota real** de correspondência da Meta — o conector da Meta já está
disponível —, para comparar com a nossa estimativa. É a primeira vez que a nota
do Studio seria conferida contra a da plataforma.

---

## Fase 2 — O esquema do jeito certo

A fundação do editor novo. Hoje o esquema existe e a extração de captura roda
sobre ele, mas a auditoria achou quatro defeitos nele.

| # | O que | Prova |
|---|---|---|
| 2.1 | **Um catálogo só.** O esquema passa a usar a função de desenho do catálogo e deixa de ter a sua. O plano do Puck proíbe dois catálogos, e o esquema nasceu com dois. | teste que falha se `page-schema.js` voltar a escrever marcação |
| 2.2 | **Toda classe emitida tem regra no CSS.** Colunas, imagem e formulário emitem hoje classes que não existem, e sairiam sem estilo. O formulário passa a usar `.alva-form`. | teste sobre todas as folhas |
| 2.3 | **A VSL com o marcador que a publicação lê** (`data-alva-vsl`). Hoje ela sumiria da página publicada, sem erro. | página do esquema com VSL, e a publicação a encontra |
| 2.4 | **Os modelos de página como árvores do esquema.** Os seis modelos prontos (serviços, oferta, evento, B2B, lançamento, contato) são hoje strings de HTML da era GrapesJS. Sem convertê-los, o editor novo nasce sem modelo. *Decisão: converter os seis, ou recriar menos e melhores.* | cada modelo publicado igual ao de hoje |

---

## Fase 3 — Puck

O plano de 25/09 já decidiu a parte de fundo, e continua valendo: **React e
bundler confinados ao editor**; o runtime publicado continua em JavaScript puro,
porque framework na página de quem visita é página mais lenta e conversão menor;
o **Puck AI fica de fora** (é pago, e a geração por IA chama a API direto).

| # | O que |
|---|---|
| 3.1 | **A fronteira do React.** Bundler só para o editor, peso medido, allowlist do servidor ampliado para a pasta do build, e um teste de que nada de React chega ao HTML publicado. |
| 3.2 | **O Puck lendo e escrevendo o esquema.** Cada elemento do catálogo vira componente; o painel de propriedades nasce dos campos declarados, em vez de ser montado à mão como hoje. |
| 3.3 | **A VSL como componente do Puck**, escolhendo entre as VSLs publicadas do projeto. |
| 3.4 | **O servidor renderiza a partir do esquema.** O `rendered_html` deixa de vir pronto do navegador — hoje o servidor serve ao público um artefato montado no cliente. O caminho do GrapesJS fica intocado até o novo estar provado. |
| 3.5 | **Verificação visual** contra o wireframe, em 1440×900 e 390×844, conferida por quem não construiu, com registro em `.estado/`. |
| 3.6 | **A saída do GrapesJS**, só depois de 3.5: `editor-shell.js`, `editor-novo.html` e o Studio SDK, `packages/core` e `packages/cli` (o fork do GrapesJS), os doze testes que o instanciam, o `form()` duplicado dos modelos e a dependência `grapesjs`. *Em 28/09: landing nova já nasce e abre só no Puck (`openPage` desvia `alva/1` para `/editor.html`); o GrapesJS segue vivo porque o quiz ainda é editado nele e landings antigas abrem por ele. A remoção inteira espera a 4.2.* |

---

## Fase 4 — Quiz como jornada

| # | O que |
|---|---|
| 4.1 | **Ligar as engines órfãs.** Ramificação condicional e cálculo sobre respostas existem, são puras e testadas — e nada do quiz que o Studio cria hoje as usa. O quiz atual avança em linha reta. *Aprovado pelo dono em 26/09.* |
| 4.2 | **O quiz no Puck**: telas, ordem, campo obrigatório segurando o avanço. |
| 4.3 | **Fechar a rota legada da tabela `forms`.** A API ainda aceita escrita nela; a interface só escreve em `pages`. |
| 4.4 | **Os ~13 tipos legados** — carrossel de depoimentos, gráfico, contagem regressiva, cronômetro, loader, CTA no meio do fluxo. Têm CSS, comportamento e inspetor prontos, mas nenhum bloco na paleta. *Decisão: resgatar ou aposentar.* O que não for decidido some na migração sem ninguém notar. |
| 4.5 | **Os estados da escolha.** Hoje "cursor em cima" e "escolhido" são visualmente idênticos — a pessoa não enxerga o que marcou; e não existe estado desabilitado. |

---

## Fase 5 — VSL

Dois itens da VSL moram em outras fases: o marcador no esquema (2.3) e o
componente no Puck (3.3). Os que ficam aqui:

**Decidido: a VSL sobe pela Cloudflare** (Cloudflare Stream, com envio direto do
navegador). Combinado antes deste plano; a primeira versão dele sugeria manter a
VSL só por URL, e estava errada.

| # | O que |
|---|---|
| 5.1 | **Declarar as variáveis do pipeline.** Ele exige `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN` e `MEDIA_PIPELINE_ENABLED=true`, e nenhuma das três está no `runtime/.env.example` nem no gerador do `.env` local. Quem sobe o ambiente não tem como saber que elas existem. |
| 5.2 | **Ligar o pipeline** com as credenciais da conta Cloudflare. *Credenciais: dono.* O menu da VSL, que hoje está escondido para todo mundo, aparece junto — ele depende exatamente desse pipeline. |
| 5.3 | **Uma VSL de ponta a ponta**: enviar um vídeo, esperar a conversão da Cloudflare, publicar numa landing e conferir no navegador o player tocando e os marcos de retenção chegando ao Analytics. Pela regra 1: o caminho inteiro, não a peça. |

---

## Fase 6 — As etapas de produto que faltam

Do roteiro das dez etapas: **1 a 4 estão feitas** (NVS → Alva, tela de pixels,
contexto do funil, nota de correspondência). A 6 é o Puck, nas fases 2 a 4. Na
ordem combinada, depois dela:

| Etapa | O que | Depende de |
|---|---|---|
| **7** | **Sinais de seção no tracker** — rolagem, tempo, vídeo e clique por bloco | Puck: cada bloco precisa de identidade estável |
| **5** | **Públicos automáticos na Meta** a partir dos eventos | fase 1: os eventos precisam estar certos |
| **9** | **Jev no quiz** — e, lembrado pelo dono em 27/09, talvez também na VSL | fase 4 |
| **8** | **Painel de sanidade** — navegador × servidor | fase 1 e tráfego real |
| **10** | **Auto-aperfeiçoamento da landing em lote** | etapas 7 e 9 |

---

## Fase 7 — Pontas soltas

Pequenas, independentes, podem correr ao lado de qualquer fase.

- `runtime/backup-restore-local-test.sh` chamava funções que não existiam e
  nenhum teste o exercita.
- `CommercialConversionService` só é alcançável por testes; a fila faz o
  trabalho dele.
- `server/MAPA.md` não lista as migrações 016 e 019 a 022.
- O estado vazio do painel de visitas diz "atualizado agora" com as barras
  zeradas.
- Três blocos de quiz com ícone genérico; título e texto sem respiro lateral
  fora de uma seção.
- O wireframe ainda escreve "Aurora · Umami + NVS". *Decisão do dono: é o
  contrato visual.*

---

## Decisões do dono

Nada abaixo trava a fase 1; cada uma trava só o item citado.

| # | Decisão | Recomendação | Trava |
|---|---|---|---|
| D1 | Novo slug do time na Vercel | um nome da marca, se estiver livre | 0.1 |
| D2 | UTM até a conversão | **sim** | 1.2 |
| D3 | Google e leads que não são dele | **não enfileirar** | 1.3 |
| D4 | Os seis modelos de página | converter os que são usados; aposentar os outros | 2.4 |
| D5 | Os ~13 tipos legados de elemento | decidir um a um | 4.4 |
| D6 | Fechar o `editor-novo.html` | **sim** — é uma porta aberta que grava por cima das páginas | 3.6 |
| D7 | Credenciais da Cloudflare Stream | — | 5.2 |
| D8 | "Aurora · Umami + NVS" no wireframe | trocar o nome | 7 |

## O que já está decidido e não se reabre

- React confinado ao editor; runtime publicado sem framework. *(plano de 25/09)*
- Puck AI fora. *(plano de 25/09)*
- Vocabulário do esquema em inglês. *(dono, 26/09)*
- Nenhum conteúdo antigo a preservar: o esquema nasce limpo. *(dono, 26/09)*
- IP e navegador vão para as plataformas, e saem da fila na entrega. *(dono, 26/09)*
- Esquema antes do editor novo. *(dono, 26/09)*
- Ligar as engines de ramificação e cálculo ao quiz. *(dono, 26/09)*
- A VSL sobe pela Cloudflare Stream. *(combinado antes deste plano; lembrado pelo
  dono em 27/09)*
