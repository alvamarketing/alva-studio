# Encaixe de Vídeo/VSL no Alva Studio

Referência analisada: [Crie seu próprio VTurb com Claude Code](https://vturb-guia.vercel.app/) e arquitetura atual do Alva Studio em 2026-09-05.

## Proposta

Tratar **Vídeo/VSL** como conteúdo reutilizável dentro de um projeto, separado do arquivo de mídia e da página que o incorpora:

- `media_assets`: arquivo original, checksum, MIME real, tamanho, duração, estado de processamento, poster, legendas e rendições HLS/MP4. Sempre carrega `company_id` e pode pertencer a um projeto.
- `videos`: entidade editorial do projeto com nome, slug interno, mídia ativa, estado, `lock_version`, `published_version_id`, criador e datas.
- `video_versions`: snapshot imutável da mídia e da configuração do player. Páginas, formulários e embeds publicados apontam para uma versão publicada, não para o rascunho mutável.

O overview do projeto passa a contar/listar `kind: video`, mas Vídeo não deve entrar em `project_routes`, hoje desenhada para páginas e formulários. O player usa namespace próprio e sem conflito: `/embed/v/<publicId>` para iframe e `/v/<publicId>` para visualização direta. `publicId` identifica apenas uma versão publicada; configuração, pixel e URL da mídia não viajam em query string.

## Player e configurações

O editor de VSL pode aproveitar do guia: preview desktop/celular, poster, cores, raio, controles, autoplay mutado, retomada, CTA temporizado, progresso e embed. A configuração fica em JSONB validado por versão, com campos explícitos para acessibilidade e segurança: legendas, nome acessível, controles de teclado, preferência de movimento, domínio permitido para embed, CTA com URL validada e marcos de medição.

Autoplay com som depende de gesto do usuário; “sem download” não pode ser prometido; ocultar controles não protege o arquivo. A barra deve refletir o progresso real: o “progresso inteligente que parece mais curto” do guia é uma manipulação enganosa. Bloquear pausa, avanço ou velocidade deve ser evitado porque prejudica teclado, acessibilidade e controle do usuário. Retomada pode usar armazenamento local, com chave por vídeo + versão; sincronização entre dispositivos só entra com consentimento e persistência autenticada.

O iframe publica eventos ao host com `postMessage` usando origem, esquema e versão verificados; o host é o único remetente ao coletor nesse modo. Em uso direto, o próprio player envia ao mesmo coletor first-party. CSP `frame-ancestors` aplica a allowlist de embeds. A página publicada referencia a VSL por id/version e o gate de publicação rejeita referência ausente, não publicada ou de outro projeto. O bloco “Vídeo” já existente no formulário e o componente de vídeo da landing page passam a selecionar essa mesma entidade, em vez de criar upload, configuração ou tracking paralelos.

## Analytics sem duplicação

Não criar “pixels por vídeo”. IDs, tokens e destinos continuam em `project_integrations`/`company_secrets`, por projeto e ambiente. O player emite um vocabulário interno único — `video_play`, `video_progress` (25/50/75/90/100 uma vez por sessão), `video_complete`, `video_cta_view` e `video_cta_click` — com `event_id` opaco, `publicId`, contexto da página/formulário e posição/duração. O coletor deriva `company_id`, `project_id`, `video_id` e `video_version_id` da versão pública; nunca confia em tenant enviado pelo navegador. Sem e-mail, telefone, respostas abertas ou CTA URL completa.

O coletor deduplica por `event_id` e encaminha uma única vez: Umami mantém pageview/sessão; Aurora agrega jornada; NVS recebe eventos comerciais e conversões com pageview automático desligado, como já definido. O iframe não dispara Meta/Google/NVS diretamente. Consentimento, rate limit, batch, idempotência e retenção entram no contrato antes de habilitar eventos públicos.

## Mídia e CDN

Upload deve ser direto para storage S3-compatible por URL assinada curta e multipart, sem passar o binário pelo processo web. Um worker valida assinatura/MIME/container, aplica limites da empresa, gera checksum, poster e rendições adaptativas, e só então marca o asset como pronto. O CDN precisa suportar cache e byte ranges; origem privada e URLs assinadas evitam expor o bucket. Importação por URL deve copiar para o storage gerenciado e aplicar as mesmas defesas de SSRF/DNS rebinding do worker de webhook.

Bunny/R2 podem ser provedores futuros, mas Google Drive, Dropbox, blob URLs e um MP4 arbitrário são aceitáveis apenas em protótipo. Não oferecem contrato confiável de streaming, origem, CORS, cache, retenção ou isolamento. Vercel hospeda o app/player; não deve ser apresentada como CDN de vídeo “R$0/mês”. Custos dependem de armazenamento, transcodificação e tráfego e devem entrar nos entitlements da empresa.

## Permissões

- Acesso de leitura segue membership + `project_grants` e retorna 404 fora do tenant.
- Nova capacidade `video.write`: Proprietário, Administrador e Editor nos projetos concedidos; cobre criar, configurar, subir/substituir mídia e editar rascunho.
- Publicar versão/embed usa `deployment.publish`: Proprietário e Administrador.
- Integrações, allowlist de domínios e consentimento usam `integration.manage`: Proprietário e Administrador.
- Métricas usam `analytics.read`: Proprietário, Administrador e Analista; Editor só recebe essa visão se a política conceder explicitamente.
- Exclusão é lógica, auditada e bloqueada enquanto versões publicadas ainda referenciam a mídia; segredos nunca entram no navegador.

## Ordem sugerida no grafo

1. `midia_cdn` após `fundacao_saas`: assets multiempresa, upload assinado, processamento, quotas, CDN e limpeza auditável.
2. `vsl_player` após `midia_cdn` + `shell_saas`: vídeos/versões, editor de configuração, player público e embed seguro.
3. `vsl_nos_editores` após `vsl_player` + `editores_saas`: bloco de VSL por referência em landing pages e formulários, com validação no snapshot.
4. `publicacao_por_projeto` passa a depender também de `vsl_nos_editores` quando houver VSL referenciada.
5. `tracking_analytics` depende de `vsl_player` e consome seus eventos no pipeline único já planejado.

Primeiro corte útil: upload gerenciado, player acessível, CTA, embed e eventos internos; deixar progresso customizado avançado, PiP, múltiplas velocidades, retomada entre dispositivos e provedores externos para depois da homologação de mídia, tenancy e deduplicação.

## O que no guia é apenas protótipo

`localStorage` não oferece multiusuário, tenancy, versões, auditoria ou backup; blob URL morre com a sessão; parâmetros de URL são adulteráveis e vazam configuração; “pixel ID” no cliente duplica tracking e expõe integrações; link externo de vídeo não garante disponibilidade; ocultar controles não impede download; autoplay com som não é garantido; custo zero e deploy em 60 segundos ignoram mídia, tráfego, transcodificação, consentimento, segurança e operação. A UI é uma boa referência, mas o prompt de dois HTMLs não deve virar base de produção.
