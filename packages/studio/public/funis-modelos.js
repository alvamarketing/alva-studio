// Os modelos de funil do Studio: os funis da biblioteca da Jornada da Alva (aba Funis),
// copiados como dados em 28/09/2026. Cada etapa tem um tipo (`k`), um nome, uma descrição
// e uma posição; cada seta liga duas etapas. Quem importa um modelo recebe uma cópia —
// editar o funil do projeto não muda o modelo.
export const modelosDeFunil = Object.freeze([
 {
  "id": "diagnostico-pago",
  "nome": "Diagnóstico pago",
  "tipo": "Diagnóstico pago",
  "tags": [
   "Alto ticket",
   "Negócio local"
  ],
  "para": "A pessoa paga um valor baixo para garantir a reunião; a reunião já é a apresentação da proposta.",
  "quando": "",
  "metrica": "Custo por diagnóstico pago e quantos fecham depois da reunião",
  "nos": [
   {
    "id": "anuncio",
    "k": "meta",
    "nome": "Anúncio",
    "texto": "O Tai aparece nos stories como um dia comum; a campanha de conversão leva direto à página.\n• StoryAds leva gente ao perfil (Referência: R$ 0,15 a R$ 0,25 por visita ao perfil.)\n• Campanha de conversão leva à página do diagnóstico\n• Público de engajamento de quem recebeu visita sincera",
    "x": 15,
    "y": 23
   },
   {
    "id": "visita",
    "k": "dm",
    "nome": "Visita sincera",
    "texto": "Quem reagiu às visitas recebe o convite pelo direct.\n• Convite só depois que a pessoa reagiu\n• Mensagem escrita a partir do diagnóstico de maturidade (O Tai aprova antes de sair.)",
    "x": 15,
    "y": 183
   },
   {
    "id": "perfil",
    "k": "instagram",
    "nome": "Perfil do Instagram",
    "texto": "A vitrine que o anúncio e a visita trazem.\n• Bio explica o diagnóstico e tem o link da página",
    "x": 215,
    "y": 183
   },
   {
    "id": "pagina",
    "k": "pagina",
    "nome": "Página do diagnóstico",
    "texto": "Explica a ponte do ponto A ao ponto B e vende a reunião.\n• Ponte A → B e os quatro degraus\n• Regras dos o valor do diagnóstico visíveis antes do Pix (Regra que o cliente lê depois de pagar não é regra, é discussão.)",
    "x": 400,
    "y": 160
   },
   {
    "id": "pix",
    "k": "checkout",
    "nome": "Pagamento do diagnóstico",
    "texto": "Paga para garantir a vaga na agenda.\n• Cobrança no Asaas\n• Regras aceitas antes de pagar",
    "x": 600,
    "y": 160
   },
   {
    "id": "agenda",
    "k": "agenda",
    "nome": "Agenda da call",
    "texto": "Logo depois do Pix, escolhe o horário.\n• Remarcar avisando não é falta (Na terceira remarcação, o Tai devolve e encerra.)",
    "x": 800,
    "y": 160
   },
   {
    "id": "faltou",
    "k": "perda",
    "nome": "Faltou sem avisar",
    "texto": "Única forma de perder os o valor do diagnóstico.\n• Os o valor do diagnóstico ficam",
    "x": 1015,
    "y": 183
   },
   {
    "id": "lembrete",
    "k": "whatsapp",
    "nome": "Lembretes no WhatsApp",
    "texto": "A ISIS lembra da call.\n• Na véspera e uma hora antes",
    "x": 1015,
    "y": 343
   },
   {
    "id": "call",
    "k": "reuniao",
    "nome": "Call do diagnóstico",
    "texto": "O Tai escuta e desenha o mapa na hora.\n• Pesquisa pré-call com o diagnóstico de maturidade (Feita antes da call pela ISIS.)\n• Mapa desenhado junto com o dono",
    "x": 1215,
    "y": 343
   },
   {
    "id": "proposta",
    "k": "proposta",
    "nome": "Proposta na call",
    "texto": "Preço e proposta entregues na mesma conversa.\n• Setup somado pela régua do nicho\n• Degrau escolhido: atração, conversão ou escala",
    "x": 1400,
    "y": 320
   },
   {
    "id": "contrato",
    "k": "contrato",
    "nome": "Contrato",
    "texto": "Valor cheio do setup, parcelas e regras de saída.\n• O envio abre o prazo de resposta para responder",
    "x": 1600,
    "y": 320
   },
   {
    "id": "sim",
    "k": "cliente",
    "nome": "Assinou: cliente fechado",
    "texto": "Os o valor do diagnóstico viram desconto e o cliente vai para a Entrega.\n• o bônus de desconto no setup (Cashback de 3x.)\n• Passagem para o onboarding",
    "x": 1815,
    "y": 343
   },
   {
    "id": "nao",
    "k": "perda",
    "nome": "Disse não: devolução",
    "texto": "Devolve e tenta mais uma vez.\n• Perguntar o motivo e tentar a segunda venda por telefone\n• Estorno integral no Pix em até 24 horas",
    "x": 1815,
    "y": 503
   },
   {
    "id": "silencio",
    "k": "nota",
    "nome": "Sem resposta: prazo vence",
    "texto": "Os o valor do diagnóstico ficam como pagamento do diagnóstico.\n• Se voltar com uma justificativa, o Tai devolve",
    "x": 1757,
    "y": 668
   }
  ],
  "setas": [
   {
    "de": "anuncio",
    "para": "perfil",
    "rotulo": ""
   },
   {
    "de": "perfil",
    "para": "pagina",
    "rotulo": ""
   },
   {
    "de": "anuncio",
    "para": "pagina",
    "rotulo": ""
   },
   {
    "de": "visita",
    "para": "pagina",
    "rotulo": "convite"
   },
   {
    "de": "pagina",
    "para": "pix",
    "rotulo": ""
   },
   {
    "de": "pix",
    "para": "agenda",
    "rotulo": ""
   },
   {
    "de": "agenda",
    "para": "faltou",
    "rotulo": "faltou"
   },
   {
    "de": "agenda",
    "para": "lembrete",
    "rotulo": ""
   },
   {
    "de": "lembrete",
    "para": "call",
    "rotulo": ""
   },
   {
    "de": "call",
    "para": "proposta",
    "rotulo": ""
   },
   {
    "de": "proposta",
    "para": "contrato",
    "rotulo": ""
   },
   {
    "de": "contrato",
    "para": "sim",
    "rotulo": "sim"
   },
   {
    "de": "contrato",
    "para": "nao",
    "rotulo": "não"
   },
   {
    "de": "contrato",
    "para": "silencio",
    "rotulo": "sem resposta"
   }
  ]
 },
 {
  "id": "escada-de-valor-ascensao-oferta",
  "nome": "Escada de Valor (Oferta e Ascensão)",
  "tipo": "Upsell",
  "tags": [
   "Ascensão e recorrência"
  ],
  "para": "Estruturar a oferta (promessa + garantia + bônus) e depois subir o cliente por ofertas cada vez maiores, aumentando o resultado percebido e reduzindo tempo/esforço a cada passo.",
  "quando": "Ticket médio a alto. Qualquer negócio que já tem oferta principal e quer aumentar o valor por cliente.",
  "metrica": "Valor médio por cliente ao longo da esteira (LTV da escada)",
  "nos": [
   {
    "id": "vl1",
    "k": "pagina",
    "nome": "Oferta de entrada (Grand Slam Offer)",
    "texto": "• Promessa + garantia forte + bônus que tornam a decisão óbvia",
    "x": 0,
    "y": 0
   },
   {
    "id": "vl2",
    "k": "checkout",
    "nome": "Compra da oferta de entrada",
    "texto": "",
    "x": 190,
    "y": 0
   },
   {
    "id": "vl3",
    "k": "cliente",
    "nome": "Primeira vitória rápida",
    "texto": "• Reduz o tempo até o primeiro resultado percebido",
    "x": 380,
    "y": 0
   },
   {
    "id": "vl4",
    "k": "crm",
    "nome": "Acompanhamento de resultado",
    "texto": "• Time acompanha o uso/resultado do cliente",
    "x": 570,
    "y": 0
   },
   {
    "id": "vl5",
    "k": "upsellpg",
    "nome": "Oferta de ascensão",
    "texto": "• Nova oferta com resultado maior, mais \"feito para você\"",
    "x": 760,
    "y": 0
   },
   {
    "id": "vl6",
    "k": "checkout",
    "nome": "Compra da oferta de ascensão",
    "texto": "",
    "x": 950,
    "y": 0
   }
  ],
  "setas": [
   {
    "de": "vl1",
    "para": "vl2",
    "rotulo": ""
   },
   {
    "de": "vl2",
    "para": "vl3",
    "rotulo": ""
   },
   {
    "de": "vl3",
    "para": "vl4",
    "rotulo": ""
   },
   {
    "de": "vl4",
    "para": "vl5",
    "rotulo": "resultado percebido"
   },
   {
    "de": "vl5",
    "para": "vl6",
    "rotulo": ""
   }
  ]
 },
 {
  "id": "evento-presencial",
  "nome": "Evento presencial",
  "tipo": "Lançamento",
  "tags": [
   "Lançamento",
   "Alto ticket"
  ],
  "para": "Ingresso, evento com oferta e acompanhamento de quem não fechou.",
  "quando": "",
  "metrica": "",
  "nos": [
   {
    "id": "nA",
    "k": "meta",
    "nome": "Divulgar o evento",
    "texto": "divulgar o evento presencial (organico + trafego) — entra em faturamento alto (Nivel 3 do seletor: acima de ~400k/mes ou 200+ reunioes/mes). Catalogo nao tem skill dedicada para evento presencial, gap ja registrado na doutrina",
    "x": 0,
    "y": 0
   },
   {
    "id": "nB",
    "k": "checkout",
    "nome": "Vender ingressos",
    "texto": "processar a venda de ingressos/inscricao do evento — indicador: taxa Impressao->Clique->Lead da regua (secao 5), equivalente a inscricao virando ingresso comprado",
    "x": 200,
    "y": 0
   },
   {
    "id": "nC",
    "k": "crm",
    "nome": "Check-in e CRM",
    "texto": "instalar medicao do evento (check-in, CRM presencial) antes da data — funil sem medicao nao entra no premium, mesmo gate do seletor-funil\n• GATE-MEDICAO-INSTALADA",
    "x": 400,
    "y": 0
   },
   {
    "id": "nD",
    "k": "reuniao",
    "nome": "Evento com oferta",
    "texto": "conduzir o evento presencial e fechar com o pitch de vendas — pico de vendas (3x o normal) mais marca. Sem skill de criacao/logistica de evento presencial no catalogo, gap ja registrado na doutrina",
    "x": 600,
    "y": 0
   },
   {
    "id": "nE",
    "k": "cliente",
    "nome": "Vendas no evento",
    "texto": "capturar as vendas fechadas ao vivo no evento — indicador: Reuniao realizada -> Venda (regua secao 5: referencia 20% a 30%, mas com pico de ate 3x o normal)",
    "x": 800,
    "y": 0
   },
   {
    "id": "nF",
    "k": "email",
    "nome": "Acompanhamento pós-evento",
    "texto": "rodar follow-up com quem nao fechou no evento (Break Out Follow Up)\n• Break Out Follow Up",
    "x": 1000,
    "y": 0
   },
   {
    "id": "nESC",
    "k": "perda",
    "nome": "Escala para um humano",
    "texto": "",
    "x": 1000,
    "y": 130
   }
  ],
  "setas": [
   {
    "de": "nA",
    "para": "nB",
    "rotulo": ""
   },
   {
    "de": "nB",
    "para": "nC",
    "rotulo": ""
   },
   {
    "de": "nC",
    "para": "nD",
    "rotulo": ""
   },
   {
    "de": "nD",
    "para": "nE",
    "rotulo": ""
   },
   {
    "de": "nE",
    "para": "nF",
    "rotulo": "nao fechou"
   },
   {
    "de": "nE",
    "para": "nESC",
    "rotulo": "logistica falha /<br/>dado conflitante"
   }
  ]
 },
 {
  "id": "funil-agendamento-clinica-estetica",
  "nome": "Agendamento para Clínica de Estética",
  "tipo": "Agendamento",
  "tags": [
   "Negócio local"
  ],
  "para": "Levar quem clicou no anúncio até uma consulta confirmada na agenda da clínica, usando o WhatsApp como canal central e automações para reduzir no-show.",
  "quando": "Ticket médio a alto (procedimentos estéticos). Clínicas e consultórios.",
  "metrica": "Taxa de conversão de lead em consulta agendada e taxa de no-show",
  "nos": [
   {
    "id": "cl1",
    "k": "meta",
    "nome": "Anúncio da clínica",
    "texto": "",
    "x": 15,
    "y": 23
   },
   {
    "id": "cl2",
    "k": "whatsapp",
    "nome": "Captura no WhatsApp",
    "texto": "• Lead cai direto na conversa, mesmo fora do horário comercial",
    "x": 215,
    "y": 23
   },
   {
    "id": "cl3",
    "k": "whatsapp",
    "nome": "Qualificação",
    "texto": "• Coleta interesse, procedimento e disponibilidade",
    "x": 415,
    "y": 23
   },
   {
    "id": "cl4",
    "k": "agenda",
    "nome": "Agendamento via WhatsApp Flow",
    "texto": "• Escolhe horário dentro do próprio WhatsApp, sem sair do app",
    "x": 600,
    "y": 0
   },
   {
    "id": "cl5",
    "k": "crm",
    "nome": "Sincronização com a agenda",
    "texto": "• Evita conflito de horário e agenda duplicada",
    "x": 865,
    "y": 156
   },
   {
    "id": "cl6",
    "k": "email",
    "nome": "Follow-up de orçamento pendente",
    "texto": "• Reativação em 24h/48h/72h para quem recebeu proposta e não confirmou",
    "x": 1000,
    "y": 157
   },
   {
    "id": "cl7",
    "k": "whatsapp",
    "nome": "Confirmação 24h antes",
    "texto": "• Reduz no-show; permite remarcação automática",
    "x": 1215,
    "y": 23
   },
   {
    "id": "cl8",
    "k": "cliente",
    "nome": "Consulta realizada",
    "texto": "• Resposta em até 5min: conversão até 21x maior (citado, MIT)",
    "x": 1415,
    "y": 23
   }
  ],
  "setas": [
   {
    "de": "cl1",
    "para": "cl2",
    "rotulo": ""
   },
   {
    "de": "cl2",
    "para": "cl3",
    "rotulo": ""
   },
   {
    "de": "cl3",
    "para": "cl4",
    "rotulo": ""
   },
   {
    "de": "cl4",
    "para": "cl5",
    "rotulo": ""
   },
   {
    "de": "cl5",
    "para": "cl6",
    "rotulo": ""
   },
   {
    "de": "cl6",
    "para": "cl7",
    "rotulo": ""
   },
   {
    "de": "cl7",
    "para": "cl8",
    "rotulo": ""
   },
   {
    "de": "cl7",
    "para": "cl4",
    "rotulo": "precisa remarcar"
   }
  ]
 },
 {
  "id": "funil-aplicacao-alto-ticket",
  "nome": "Aplicação (Alto Ticket)",
  "tipo": "Agendamento",
  "tags": [
   "Alto ticket"
  ],
  "para": "Inverter a venda: o prospect se candidata a comprar, é filtrado por um formulário e só então chega a uma call de fechamento.",
  "quando": "Ticket alto (a partir de ~R$3.000-15.000+). Consultoria, mentoria, serviços B2B e coaching.",
  "metrica": "Taxa de conversão de aplicação → call agendada → venda fechada",
  "nos": [
   {
    "id": "ap1",
    "k": "meta",
    "nome": "Anúncio para o alto ticket",
    "texto": "",
    "x": 0,
    "y": 0
   },
   {
    "id": "ap2",
    "k": "pagina",
    "nome": "Página de histórias de sucesso",
    "texto": "• Mostra um case de cliente com resultado parecido ao desejado",
    "x": 190,
    "y": 0
   },
   {
    "id": "ap3",
    "k": "formulario",
    "nome": "Formulário de aplicação",
    "texto": "• 8 a 10 perguntas que qualificam orçamento, dor e prontidão",
    "x": 380,
    "y": 0
   },
   {
    "id": "ap4",
    "k": "obrigado",
    "nome": "Confirmação + tarefas",
    "texto": "• Confirma a inscrição e passa tarefas até a call",
    "x": 570,
    "y": 0
   },
   {
    "id": "ap5",
    "k": "agenda",
    "nome": "Agendamento da call",
    "texto": "• Prospect escolhe horário para a ligação de fechamento",
    "x": 760,
    "y": 0
   },
   {
    "id": "ap6",
    "k": "reuniao",
    "nome": "Call de fechamento",
    "texto": "• Formato four-question close (US$2K-8K) ou setter+closer (US$10K+)",
    "x": 950,
    "y": 0
   },
   {
    "id": "ap7",
    "k": "checkout",
    "nome": "Checkout / contrato",
    "texto": "• Fechamento da venda após a call",
    "x": 1140,
    "y": 0
   },
   {
    "id": "ap8",
    "k": "perda",
    "nome": "Não qualificado",
    "texto": "• Reprovado no formulário de aplicação",
    "x": 380,
    "y": 190
   },
   {
    "id": "ap9",
    "k": "perda",
    "nome": "Não fechou na call",
    "texto": "",
    "x": 950,
    "y": 190
   }
  ],
  "setas": [
   {
    "de": "ap1",
    "para": "ap2",
    "rotulo": ""
   },
   {
    "de": "ap2",
    "para": "ap3",
    "rotulo": ""
   },
   {
    "de": "ap3",
    "para": "ap4",
    "rotulo": ""
   },
   {
    "de": "ap4",
    "para": "ap5",
    "rotulo": ""
   },
   {
    "de": "ap5",
    "para": "ap6",
    "rotulo": ""
   },
   {
    "de": "ap6",
    "para": "ap7",
    "rotulo": ""
   },
   {
    "de": "ap3",
    "para": "ap8",
    "rotulo": "reprovado na aplicação"
   },
   {
    "de": "ap6",
    "para": "ap9",
    "rotulo": "não fechou"
   }
  ]
 },
 {
  "id": "funil-assinatura-continuidade",
  "nome": "Assinatura (Continuidade)",
  "tipo": "Upsell",
  "tags": [
   "Ascensão e recorrência",
   "Infoproduto"
  ],
  "para": "Converter quem já comprou uma oferta pontual (tripwire, livro) em assinante recorrente, geralmente via teste gratuito ou de baixo custo.",
  "quando": "Ticket recorrente baixo a médio. Software, clube de conteúdo, comunidade paga.",
  "metrica": "Taxa de conversão de teste em assinatura ativa e churn mensal",
  "nos": [
   {
    "id": "as1",
    "k": "email",
    "nome": "Oferta de continuidade",
    "texto": "• Enviada depois que o cliente já passou por um tripwire ou funil de livro",
    "x": 15,
    "y": 23
   },
   {
    "id": "as2",
    "k": "pagina",
    "nome": "Página da assinatura",
    "texto": "• Apresenta o valor recorrente: acesso contínuo, comunidade, atualizações",
    "x": 200,
    "y": 0
   },
   {
    "id": "as3",
    "k": "formulario",
    "nome": "Início do teste",
    "texto": "• Cliente ativa teste gratuito ou de US$1, informando cartão",
    "x": 400,
    "y": 0
   },
   {
    "id": "as4",
    "k": "checkout",
    "nome": "Cobrança recorrente",
    "texto": "• Após o teste, a cobrança mensal/anual começa automaticamente",
    "x": 600,
    "y": 0
   },
   {
    "id": "as5",
    "k": "crm",
    "nome": "Onboarding e uso",
    "texto": "• Time guia o uso do produto/comunidade para reduzir cancelamento",
    "x": 815,
    "y": 23
   },
   {
    "id": "as6",
    "k": "upsellpg",
    "nome": "Upgrade anual/vitalício",
    "texto": "• Proposta de trocar a mensalidade por um plano maior com desconto",
    "x": 1000,
    "y": 0
   },
   {
    "id": "as7",
    "k": "perda",
    "nome": "Cancelou a assinatura",
    "texto": "",
    "x": 815,
    "y": 183
   }
  ],
  "setas": [
   {
    "de": "as1",
    "para": "as2",
    "rotulo": ""
   },
   {
    "de": "as2",
    "para": "as3",
    "rotulo": ""
   },
   {
    "de": "as3",
    "para": "as4",
    "rotulo": ""
   },
   {
    "de": "as4",
    "para": "as5",
    "rotulo": ""
   },
   {
    "de": "as5",
    "para": "as6",
    "rotulo": ""
   },
   {
    "de": "as4",
    "para": "as7",
    "rotulo": "cancelou"
   }
  ]
 },
 {
  "id": "funil-captacao-core-four",
  "nome": "Captação (Core Four + Isca Digital)",
  "tipo": "Isca",
  "tags": [
   "Captação de leads"
  ],
  "para": "Gerar volume de leads por 4 canais (indicação/rede quente, conteúdo, contato frio, anúncios pagos), entregando uma isca tão valiosa que o próprio material já convence a comprar depois.",
  "quando": "Ticket baixo a alto. Qualquer negócio em fase de geração de leads, antes da oferta/ascensão.",
  "metrica": "Custo por lead (CPL) e volume de leads/dia (Regra dos 100)",
  "nos": [
   {
    "id": "cf1",
    "k": "indicacao",
    "nome": "Contato quente",
    "texto": "• Pede indicação de quem já conhece a marca",
    "x": 15,
    "y": -137
   },
   {
    "id": "cf2",
    "k": "conteudo",
    "nome": "Conteúdo orgânico",
    "texto": "• Publica conteúdo educativo próprio para atrair desconhecidos",
    "x": 15,
    "y": 23
   },
   {
    "id": "cf3",
    "k": "prospeccao",
    "nome": "Prospecção fria",
    "texto": "• Mensagem direta a quem nunca ouviu falar da marca",
    "x": 15,
    "y": 343
   },
   {
    "id": "cf4",
    "k": "meta",
    "nome": "Anúncios pagos",
    "texto": "• Compra atenção paga nos canais onde o público está",
    "x": 15,
    "y": 183
   },
   {
    "id": "cf5",
    "k": "captura",
    "nome": "Entrega da isca digital",
    "texto": "• Troca a isca (checklist, aula, ferramenta) pelo contato do lead",
    "x": 200,
    "y": 0
   },
   {
    "id": "cf6",
    "k": "crm",
    "nome": "Qualificação do lead",
    "texto": "• Lead entra no CRM e é segmentado antes da oferta",
    "x": 415,
    "y": 23
   },
   {
    "id": "cf7",
    "k": "perda",
    "nome": "Não respondeu",
    "texto": "",
    "x": 215,
    "y": 343
   }
  ],
  "setas": [
   {
    "de": "cf1",
    "para": "cf5",
    "rotulo": ""
   },
   {
    "de": "cf2",
    "para": "cf5",
    "rotulo": ""
   },
   {
    "de": "cf3",
    "para": "cf5",
    "rotulo": ""
   },
   {
    "de": "cf4",
    "para": "cf5",
    "rotulo": ""
   },
   {
    "de": "cf5",
    "para": "cf6",
    "rotulo": ""
   },
   {
    "de": "cf3",
    "para": "cf7",
    "rotulo": "não respondeu"
   }
  ]
 },
 {
  "id": "funil-clique-whatsapp",
  "nome": "Clique para WhatsApp",
  "tipo": "Agendamento",
  "tags": [
   "Negócio local",
   "Captação de leads"
  ],
  "para": "Levar o clique do anúncio direto para uma conversa no WhatsApp da empresa, sem landing page ou formulário no meio, para vender ou agendar serviços locais.",
  "quando": "Ticket baixo a médio. Negócios locais e serviços (salões, prestadores) que vendem por conversa.",
  "metrica": "Custo por conversa iniciada (CPiC) e taxa de conversão de lead em cliente",
  "nos": [
   {
    "id": "wa1",
    "k": "meta",
    "nome": "Anúncio Clique para WhatsApp",
    "texto": "• CTR típico citado: 1,5% a 3,5%",
    "x": 0,
    "y": 0
   },
   {
    "id": "wa2",
    "k": "whatsapp",
    "nome": "Abertura automática da conversa",
    "texto": "• Clique abre o WhatsApp com mensagem pré-preenchida",
    "x": 190,
    "y": 0
   },
   {
    "id": "wa3",
    "k": "whatsapp",
    "nome": "Qualificação automática",
    "texto": "• Chatbot pergunta serviço, urgência e localização",
    "x": 380,
    "y": 0
   },
   {
    "id": "wa4",
    "k": "dm",
    "nome": "Transferência para atendente",
    "texto": "• Dentro da janela gratuita de 72h do CTWA (vs. 24h padrão)",
    "x": 570,
    "y": 0
   },
   {
    "id": "wa5",
    "k": "proposta",
    "nome": "Envio de proposta/orçamento",
    "texto": "• Atendente detalha preço e tira objeções",
    "x": 760,
    "y": 0
   },
   {
    "id": "wa6",
    "k": "agenda",
    "nome": "Agendamento ou fechamento",
    "texto": "• Marca horário ou fecha a venda\n• Conversão lead-cliente citada: 10-30%",
    "x": 950,
    "y": 0
   },
   {
    "id": "wa7",
    "k": "perda",
    "nome": "Sem resposta",
    "texto": "",
    "x": 760,
    "y": 190
   }
  ],
  "setas": [
   {
    "de": "wa1",
    "para": "wa2",
    "rotulo": ""
   },
   {
    "de": "wa2",
    "para": "wa3",
    "rotulo": ""
   },
   {
    "de": "wa3",
    "para": "wa4",
    "rotulo": "qualificado"
   },
   {
    "de": "wa4",
    "para": "wa5",
    "rotulo": ""
   },
   {
    "de": "wa5",
    "para": "wa6",
    "rotulo": ""
   },
   {
    "de": "wa5",
    "para": "wa7",
    "rotulo": "não respondeu"
   }
  ]
 },
 {
  "id": "funil-desafio",
  "nome": "Desafio",
  "tipo": "Lançamento",
  "tags": [
   "Lançamento",
   "Infoproduto"
  ],
  "para": "Vender o acesso a um desafio curto (tipicamente 5 dias) em que o participante avança rumo a um resultado específico, provando valor antes do pitch final.",
  "quando": "Ticket baixo de entrada (o desafio) com upsell de ticket médio/alto no fim. Educação, fitness, negócios.",
  "metrica": "Taxa de conclusão do desafio e taxa de conversão na oferta do encontro final",
  "nos": [
   {
    "id": "ch1",
    "k": "meta",
    "nome": "Anúncio do desafio",
    "texto": "",
    "x": 15,
    "y": 23
   },
   {
    "id": "ch2",
    "k": "pagina",
    "nome": "Página de venda do desafio",
    "texto": "• Descreve a promessa e os dias do desafio",
    "x": 200,
    "y": 0
   },
   {
    "id": "ch3",
    "k": "checkout",
    "nome": "Checkout do desafio",
    "texto": "• Compra o acesso, geralmente baixo custo",
    "x": 400,
    "y": 0
   },
   {
    "id": "ch4",
    "k": "whatsapp",
    "nome": "Grupo do desafio",
    "texto": "• Entra num grupo de WhatsApp/Telegram com os outros participantes",
    "x": 615,
    "y": 23
   },
   {
    "id": "ch5",
    "k": "email",
    "nome": "Aulas diárias",
    "texto": "• Recebe uma aula/tarefa por dia durante o desafio",
    "x": 815,
    "y": 23
   },
   {
    "id": "ch6",
    "k": "webinar",
    "nome": "Encontro de fechamento",
    "texto": "• Aula ou live final que apresenta a oferta principal",
    "x": 1000,
    "y": 0
   },
   {
    "id": "ch7",
    "k": "checkout",
    "nome": "Checkout da oferta principal",
    "texto": "• Compra o produto/serviço de ticket mais alto",
    "x": 1200,
    "y": 0
   },
   {
    "id": "ch8",
    "k": "email",
    "nome": "Sequência pós-desafio",
    "texto": "• Reoferta por e-mail para quem não comprou no encontro final",
    "x": 1415,
    "y": 23
   }
  ],
  "setas": [
   {
    "de": "ch1",
    "para": "ch2",
    "rotulo": ""
   },
   {
    "de": "ch2",
    "para": "ch3",
    "rotulo": ""
   },
   {
    "de": "ch3",
    "para": "ch4",
    "rotulo": ""
   },
   {
    "de": "ch4",
    "para": "ch5",
    "rotulo": ""
   },
   {
    "de": "ch5",
    "para": "ch6",
    "rotulo": ""
   },
   {
    "de": "ch6",
    "para": "ch7",
    "rotulo": ""
   },
   {
    "de": "ch7",
    "para": "ch8",
    "rotulo": "não comprou"
   }
  ]
 },
 {
  "id": "funil-ecommerce-recuperacao-carrinho",
  "nome": "E-commerce com Recuperação de Carrinho",
  "tipo": "Venda direta",
  "tags": [
   "E-commerce",
   "Perpétuo"
  ],
  "para": "Recuperar clientes que adicionaram produtos ao carrinho mas não finalizaram a compra, com sequência automática de e-mail/SMS em vários intervalos.",
  "quando": "Ticket baixo a médio. Qualquer loja virtual (moda, beleza, produtos físicos).",
  "metrica": "Taxa de recuperação de carrinho (% de carrinhos abandonados que voltam a comprar)",
  "nos": [
   {
    "id": "ec1",
    "k": "instagram",
    "nome": "Visita à loja",
    "texto": "• Chega via anúncio, busca ou rede social",
    "x": 0,
    "y": 0
   },
   {
    "id": "ec2",
    "k": "pagina",
    "nome": "Navegação e produto",
    "texto": "• Explora produtos e adiciona ao carrinho",
    "x": 190,
    "y": 0
   },
   {
    "id": "ec3",
    "k": "checkout",
    "nome": "Checkout iniciado",
    "texto": "• Preenche dados, mas não finaliza o pagamento",
    "x": 380,
    "y": 0
   },
   {
    "id": "ec4",
    "k": "perda",
    "nome": "Abandono de carrinho",
    "texto": "• Sai sem concluir a compra",
    "x": 380,
    "y": 190
   },
   {
    "id": "ec5",
    "k": "email",
    "nome": "Recuperação em 4 intervalos",
    "texto": "• Mensagens automáticas em 30min, 2h, 24h e 48h após o abandono\n• E-mails personalizados têm taxa de abertura 46% maior",
    "x": 570,
    "y": 0
   },
   {
    "id": "ec6",
    "k": "checkout",
    "nome": "Retorno ao checkout",
    "texto": "• Volta pelo link da mensagem e finaliza",
    "x": 760,
    "y": 0
   },
   {
    "id": "ec7",
    "k": "obrigado",
    "nome": "Compra confirmada",
    "texto": "",
    "x": 950,
    "y": 0
   }
  ],
  "setas": [
   {
    "de": "ec1",
    "para": "ec2",
    "rotulo": ""
   },
   {
    "de": "ec2",
    "para": "ec3",
    "rotulo": ""
   },
   {
    "de": "ec3",
    "para": "ec5",
    "rotulo": ""
   },
   {
    "de": "ec5",
    "para": "ec6",
    "rotulo": ""
   },
   {
    "de": "ec6",
    "para": "ec7",
    "rotulo": ""
   },
   {
    "de": "ec4",
    "para": "ec5",
    "rotulo": "abandonou"
   },
   {
    "de": "ec5",
    "para": "ec7",
    "rotulo": "recuperado"
   }
  ]
 },
 {
  "id": "funil-hvco-godfather-offer",
  "nome": "HVCO → Oferta Godfather",
  "tipo": "Isca",
  "tags": [
   "Captação de leads",
   "Negócio local",
   "Alto ticket"
  ],
  "para": "Atrair com um anúncio estilo notícia (Halo), capturar o lead com uma isca de altíssimo valor (HVCO), nutrir com vídeos/e-mails (Lanterna Mágica) e só então apresentar a oferta paga irresistível (Godfather Offer).",
  "quando": "Ticket médio a alto, ciclo de venda mais longo. Serviços locais, agências.",
  "metrica": "Custo por lead do HVCO e taxa de conversão de lead nutrido em venda da oferta Godfather",
  "nos": [
   {
    "id": "go1",
    "k": "meta",
    "nome": "Anúncio estilo notícia (Halo)",
    "texto": "• Usa a linguagem e as dores específicas do nicho, sem vender de cara",
    "x": 15,
    "y": 23
   },
   {
    "id": "go2",
    "k": "pagina",
    "nome": "Página do HVCO",
    "texto": "• Oferece conteúdo de altíssimo valor: relatório, vídeo ou checklist",
    "x": 200,
    "y": 0
   },
   {
    "id": "go3",
    "k": "captura",
    "nome": "Captura de nome e e-mail",
    "texto": "• Troca de dados pelo HVCO",
    "x": 400,
    "y": 0
   },
   {
    "id": "go4",
    "k": "email",
    "nome": "Sequência Lanterna Mágica",
    "texto": "• 2-3 e-mails/vídeos que aproximam o lead do resultado, sem vender",
    "x": 615,
    "y": 23
   },
   {
    "id": "go5",
    "k": "pagina",
    "nome": "Apresentação da Oferta Godfather",
    "texto": "• Oferta paga, mais completa que o HVCO, com bônus e garantia",
    "x": 800,
    "y": 0
   },
   {
    "id": "go6",
    "k": "checkout",
    "nome": "Checkout da oferta Godfather",
    "texto": "",
    "x": 1000,
    "y": 0
   },
   {
    "id": "go7",
    "k": "email",
    "nome": "Reengajamento",
    "texto": "",
    "x": 1015,
    "y": 183
   }
  ],
  "setas": [
   {
    "de": "go1",
    "para": "go2",
    "rotulo": ""
   },
   {
    "de": "go2",
    "para": "go3",
    "rotulo": ""
   },
   {
    "de": "go3",
    "para": "go4",
    "rotulo": ""
   },
   {
    "de": "go4",
    "para": "go5",
    "rotulo": "engajou na nutrição"
   },
   {
    "de": "go5",
    "para": "go6",
    "rotulo": ""
   },
   {
    "de": "go5",
    "para": "go7",
    "rotulo": "não comprou"
   }
  ]
 },
 {
  "id": "funil-lancamento",
  "nome": "Lançamento",
  "tipo": "Lançamento",
  "tags": [
   "Lançamento",
   "Infoproduto"
  ],
  "para": "Aquecer uma audiência com conteúdos gratuitos em sequência (CPLs) antes de abrir e fechar o carrinho por um período limitado; roda com lista própria (lançamento interno) ou com tráfego pago captando lista nova (lançamento pago).",
  "quando": "Ticket médio a alto. Infoprodutos, cursos, mentorias e eventos.",
  "metrica": "Taxa de conversão de inscritos em compradores durante a janela de carrinho aberto",
  "nos": [
   {
    "id": "ln1",
    "k": "meta",
    "nome": "Captação (PPL)",
    "texto": "• Tráfego pago ou orgânico atrai atenção antes do cadastro\n• PPL = pré-pré-lançamento: ninguém precisa se inscrever ainda",
    "x": 0,
    "y": 0
   },
   {
    "id": "ln2",
    "k": "pagina",
    "nome": "Inscrição (Pré-Lançamento)",
    "texto": "• Visitante se cadastra para receber os conteúdos gratuitos",
    "x": 190,
    "y": 0
   },
   {
    "id": "ln3",
    "k": "captura",
    "nome": "Cadastro",
    "texto": "• Nome, e-mail e WhatsApp",
    "x": 380,
    "y": 0
   },
   {
    "id": "ln4",
    "k": "email",
    "nome": "CPL 1, 2 e 3",
    "texto": "• Três conteúdos gratuitos em sequência, geralmente ao longo de 7 dias\n• Cada um aprofunda a promessa do produto",
    "x": 570,
    "y": 0
   },
   {
    "id": "ln5",
    "k": "whatsapp",
    "nome": "Aquecimento via WhatsApp",
    "texto": "• Lembretes e bastidores entre os CPLs para manter engajamento",
    "x": 760,
    "y": 0
   },
   {
    "id": "ln6",
    "k": "pagina",
    "nome": "Abertura de carrinho",
    "texto": "• Página de vendas libera a compra por período limitado",
    "x": 950,
    "y": 0
   },
   {
    "id": "ln7",
    "k": "checkout",
    "nome": "Checkout",
    "texto": "• Compra durante a janela do carrinho aberto",
    "x": 1140,
    "y": 0
   },
   {
    "id": "ln8",
    "k": "email",
    "nome": "Fechamento de carrinho",
    "texto": "• Últimos lembretes de urgência/escassez até o carrinho fechar",
    "x": 950,
    "y": 190
   }
  ],
  "setas": [
   {
    "de": "ln1",
    "para": "ln2",
    "rotulo": ""
   },
   {
    "de": "ln2",
    "para": "ln3",
    "rotulo": ""
   },
   {
    "de": "ln3",
    "para": "ln4",
    "rotulo": ""
   },
   {
    "de": "ln4",
    "para": "ln5",
    "rotulo": ""
   },
   {
    "de": "ln5",
    "para": "ln6",
    "rotulo": ""
   },
   {
    "de": "ln6",
    "para": "ln7",
    "rotulo": ""
   },
   {
    "de": "ln6",
    "para": "ln8",
    "rotulo": "não comprou"
   }
  ]
 },
 {
  "id": "funil-livro-gratis-frete",
  "nome": "Livro Grátis + Frete",
  "tipo": "Low ticket",
  "tags": [
   "Low ticket",
   "Infoproduto"
  ],
  "para": "Entregar um livro físico \"de graça\" (cliente paga só o frete) para converter tráfego frio em cliente pagante rápido e abrir relação.",
  "quando": "Ticket de entrada muito baixo (frete, ~US$8-20). Autores, coaches e infoprodutos com produto físico de porta de entrada.",
  "metrica": "Custo por pedido (frete) versus valor puxado pelos upsells no mesmo checkout",
  "nos": [
   {
    "id": "lv1",
    "k": "meta",
    "nome": "Anúncio do livro grátis",
    "texto": "• Oferece o livro \"grátis\", só cobrando o frete",
    "x": 0,
    "y": 0
   },
   {
    "id": "lv2",
    "k": "pagina",
    "nome": "Página de oferta do livro",
    "texto": "• Mostra capa, prova social e valor percebido do conteúdo",
    "x": 190,
    "y": 0
   },
   {
    "id": "lv3",
    "k": "checkout",
    "nome": "Checkout do frete",
    "texto": "• Cliente informa endereço e cartão só para pagar o frete",
    "x": 380,
    "y": 0
   },
   {
    "id": "lv4",
    "k": "upsellpg",
    "nome": "Order bump / OTO 1",
    "texto": "• Oferece áudio-livro, curso complementar ou upgrade de embalagem",
    "x": 570,
    "y": 0
   },
   {
    "id": "lv5",
    "k": "upsellpg",
    "nome": "OTO 2 (upsell principal)",
    "texto": "• Oferece o produto ou software carro-chefe (ex.: assinatura de software)",
    "x": 760,
    "y": 0
   },
   {
    "id": "lv6",
    "k": "obrigado",
    "nome": "Confirmação de pedido",
    "texto": "• Confirma envio do livro e prazo",
    "x": 950,
    "y": 0
   },
   {
    "id": "lv7",
    "k": "email",
    "nome": "Sequência pós-venda",
    "texto": "• Prepara o cliente para o produto principal ou o webinário",
    "x": 1140,
    "y": 0
   }
  ],
  "setas": [
   {
    "de": "lv1",
    "para": "lv2",
    "rotulo": ""
   },
   {
    "de": "lv2",
    "para": "lv3",
    "rotulo": ""
   },
   {
    "de": "lv3",
    "para": "lv4",
    "rotulo": ""
   },
   {
    "de": "lv4",
    "para": "lv5",
    "rotulo": "aceitou o bump"
   },
   {
    "de": "lv5",
    "para": "lv6",
    "rotulo": ""
   },
   {
    "de": "lv6",
    "para": "lv7",
    "rotulo": ""
   }
  ]
 },
 {
  "id": "funil-perpetuo-baixo-ticket",
  "nome": "Perpétuo de Baixo Ticket",
  "tipo": "Perpétuo",
  "tags": [
   "Perpétuo",
   "Low ticket",
   "Infoproduto"
  ],
  "para": "Rodar tráfego pago continuamente (sem data de lançamento) para um produto de entrada muito barato que se autofinancia, empilhando order bump, upsell e downsell para elevar o ticket médio.",
  "quando": "Ticket de entrada muito baixo (R$27-R$97) com upsells maiores. Infoprodutos digitais vendidos em escala no Brasil.",
  "metrica": "AOV (ticket médio) precisa ficar acima do CPA (custo de aquisição)",
  "nos": [
   {
    "id": "pt1",
    "k": "meta",
    "nome": "Anúncio contínuo",
    "texto": "• Tráfego pago rodando todos os dias, sem data de início/fim",
    "x": 0,
    "y": 0
   },
   {
    "id": "pt2",
    "k": "pagina",
    "nome": "Página de vendas do produto de entrada",
    "texto": "• Oferta de R$27 a R$97",
    "x": 190,
    "y": 0
   },
   {
    "id": "pt3",
    "k": "checkout",
    "nome": "Checkout com order bump",
    "texto": "• Conversão típica do order bump: 20 a 40%",
    "x": 380,
    "y": 0
   },
   {
    "id": "pt4",
    "k": "upsellpg",
    "nome": "Upsell",
    "texto": "• Oferta maior imediatamente após a compra\n• Conversão típica: 10 a 20%",
    "x": 570,
    "y": 0
   },
   {
    "id": "pt5",
    "k": "downsell",
    "nome": "Downsell",
    "texto": "• Alternativa mais barata para quem recusa o upsell",
    "x": 570,
    "y": 190
   },
   {
    "id": "pt6",
    "k": "obrigado",
    "nome": "Confirmação e entrega",
    "texto": "",
    "x": 760,
    "y": 0
   },
   {
    "id": "pt7",
    "k": "whatsapp",
    "nome": "Recuperação de carrinho",
    "texto": "• E-mail/WhatsApp para quem abandonou o checkout",
    "x": 380,
    "y": 190
   }
  ],
  "setas": [
   {
    "de": "pt1",
    "para": "pt2",
    "rotulo": ""
   },
   {
    "de": "pt2",
    "para": "pt3",
    "rotulo": ""
   },
   {
    "de": "pt3",
    "para": "pt4",
    "rotulo": ""
   },
   {
    "de": "pt4",
    "para": "pt6",
    "rotulo": ""
   },
   {
    "de": "pt4",
    "para": "pt5",
    "rotulo": "recusou o upsell"
   },
   {
    "de": "pt3",
    "para": "pt7",
    "rotulo": "abandonou o checkout"
   },
   {
    "de": "pt5",
    "para": "pt6",
    "rotulo": ""
   }
  ]
 },
 {
  "id": "funil-squeeze-page",
  "nome": "Squeeze Page (Captura)",
  "tipo": "Isca",
  "tags": [
   "Captação de leads",
   "Perpétuo",
   "Infoproduto"
  ],
  "para": "Trocar uma isca digital gratuita pelo e-mail de um visitante frio, abrindo a porta da escada de valor.",
  "quando": "Ticket baixo a médio. Qualquer negócio que construa lista antes de vender: infoproduto, serviço, e-commerce com conteúdo.",
  "metrica": "Taxa de opt-in (% de visitantes que deixam o e-mail)",
  "nos": [
   {
    "id": "sq1",
    "k": "meta",
    "nome": "Anúncio para tráfego frio",
    "texto": "• Oferece a isca digital em troca do e-mail\n• Direciona só para a squeeze page, sem desvio",
    "x": 0,
    "y": 0
   },
   {
    "id": "sq2",
    "k": "pagina",
    "nome": "Squeeze page",
    "texto": "• Headline com o benefício único da isca\n• Sem menu nem links de saída: foco em uma ação",
    "x": 190,
    "y": 0
   },
   {
    "id": "sq3",
    "k": "captura",
    "nome": "Cadastro de e-mail",
    "texto": "• Visitante deixa nome e e-mail para receber o material",
    "x": 380,
    "y": 0
   },
   {
    "id": "sq4",
    "k": "obrigado",
    "nome": "Página de entrega",
    "texto": "• Confirma o cadastro\n• Libera o acesso à isca prometida",
    "x": 570,
    "y": 0
   },
   {
    "id": "sq5",
    "k": "email",
    "nome": "Sequência de nutrição",
    "texto": "• E-mails automáticos apresentam a marca\n• Empurram para a oferta paga (tripwire, webinário etc.)",
    "x": 760,
    "y": 0
   }
  ],
  "setas": [
   {
    "de": "sq1",
    "para": "sq2",
    "rotulo": ""
   },
   {
    "de": "sq2",
    "para": "sq3",
    "rotulo": ""
   },
   {
    "de": "sq3",
    "para": "sq4",
    "rotulo": ""
   },
   {
    "de": "sq4",
    "para": "sq5",
    "rotulo": ""
   },
   {
    "de": "sq2",
    "para": "sq1",
    "rotulo": "não cadastrou"
   }
  ]
 },
 {
  "id": "funil-summit",
  "nome": "Summit",
  "tipo": "Lançamento",
  "tags": [
   "Lançamento",
   "Captação de leads"
  ],
  "para": "Usar um evento virtual com vários especialistas convidados para captar uma lista grande, aproveitando a audiência de terceiros e construindo autoridade por associação.",
  "quando": "Ticket baixo na entrada (inscrição geralmente gratuita). Infoprodutos, comunidades, lançamento de marca nova.",
  "metrica": "Número de inscritos captados e taxa de conversão da oferta pós-evento (All-Access Pass)",
  "nos": [
   {
    "id": "su1",
    "k": "meta",
    "nome": "Anúncio do summit",
    "texto": "• Tráfego próprio e dos especialistas convidados",
    "x": 15,
    "y": 23
   },
   {
    "id": "su2",
    "k": "pagina",
    "nome": "Página de inscrição do summit",
    "texto": "• Lista os especialistas e temas das entrevistas",
    "x": 200,
    "y": 0
   },
   {
    "id": "su3",
    "k": "captura",
    "nome": "Cadastro gratuito",
    "texto": "• E-mail para acompanhar as sessões dentro da janela do evento",
    "x": 400,
    "y": 0
   },
   {
    "id": "su4",
    "k": "email",
    "nome": "Liberação das sessões",
    "texto": "• Entrevistas liberadas por dia/bloco durante o evento",
    "x": 615,
    "y": -57
   },
   {
    "id": "su5",
    "k": "upsellpg",
    "nome": "Oferta All-Access Pass",
    "texto": "• Venda de acesso vitalício às gravações e bônus",
    "x": 800,
    "y": 0
   },
   {
    "id": "su6",
    "k": "checkout",
    "nome": "Checkout do All-Access",
    "texto": "• Compra do pacote vitalício",
    "x": 1000,
    "y": 0
   },
   {
    "id": "su7",
    "k": "email",
    "nome": "Reforço para quem não assistiu",
    "texto": "",
    "x": 615,
    "y": 103
   }
  ],
  "setas": [
   {
    "de": "su1",
    "para": "su2",
    "rotulo": ""
   },
   {
    "de": "su2",
    "para": "su3",
    "rotulo": ""
   },
   {
    "de": "su3",
    "para": "su4",
    "rotulo": ""
   },
   {
    "de": "su4",
    "para": "su5",
    "rotulo": ""
   },
   {
    "de": "su5",
    "para": "su6",
    "rotulo": ""
   },
   {
    "de": "su3",
    "para": "su7",
    "rotulo": "não abriu as sessões"
   }
  ]
 },
 {
  "id": "funil-tripwire-slo",
  "nome": "Tripwire (Oferta Autoliquidável)",
  "tipo": "Low ticket",
  "tags": [
   "Low ticket",
   "Perpétuo",
   "Infoproduto",
   "E-commerce"
  ],
  "para": "Vender uma oferta de entrada muito barata que paga o próprio custo de anúncio, abrindo caminho para upsells que dão o lucro real.",
  "quando": "Ticket baixo na entrada (US$7-97), médio/alto no backend. Infoproduto, software ou e-commerce de nicho com tráfego frio pago.",
  "metrica": "CPA (custo por aquisição) precisa ficar abaixo do AOV (ticket médio do funil)",
  "nos": [
   {
    "id": "tw1",
    "k": "meta",
    "nome": "Anúncio de tráfego frio",
    "texto": "• Promove a oferta de entrada a quem não conhece a marca",
    "x": 15,
    "y": 23
   },
   {
    "id": "tw2",
    "k": "pagina",
    "nome": "Página de vendas da oferta",
    "texto": "• Produto \"splinter\" do carro-chefe, preço simbólico (US$7-97)",
    "x": 200,
    "y": 0
   },
   {
    "id": "tw3",
    "k": "checkout",
    "nome": "Checkout com order bump",
    "texto": "• Order bump converte em média 20-40% dos checkouts (dado SamCart, US$7B+ processados)",
    "x": 400,
    "y": 0
   },
   {
    "id": "tw4",
    "k": "upsellpg",
    "nome": "OTO (upsell)",
    "texto": "• Oferta única de maior valor logo após a compra",
    "x": 600,
    "y": 0
   },
   {
    "id": "tw5",
    "k": "downsell",
    "nome": "Downsell",
    "texto": "• Alternativa mais barata para quem recusa o upsell",
    "x": 800,
    "y": 160
   },
   {
    "id": "tw6",
    "k": "obrigado",
    "nome": "Página de agradecimento",
    "texto": "• Confirma a compra e entrega o produto",
    "x": 1000,
    "y": 0
   },
   {
    "id": "tw7",
    "k": "email",
    "nome": "Sequência pós-compra",
    "texto": "• Conduz o comprador para a oferta de continuidade ou o produto principal",
    "x": 615,
    "y": 183
   }
  ],
  "setas": [
   {
    "de": "tw1",
    "para": "tw2",
    "rotulo": ""
   },
   {
    "de": "tw2",
    "para": "tw3",
    "rotulo": ""
   },
   {
    "de": "tw3",
    "para": "tw4",
    "rotulo": ""
   },
   {
    "de": "tw4",
    "para": "tw6",
    "rotulo": ""
   },
   {
    "de": "tw4",
    "para": "tw5",
    "rotulo": "recusou o upsell"
   },
   {
    "de": "tw3",
    "para": "tw7",
    "rotulo": "recusou tudo"
   },
   {
    "de": "tw5",
    "para": "tw6",
    "rotulo": ""
   }
  ]
 },
 {
  "id": "funil-vsl",
  "nome": "VSL (Vídeo de Vendas)",
  "tipo": "Venda direta",
  "tags": [
   "Perpétuo",
   "Low ticket",
   "Infoproduto",
   "E-commerce"
  ],
  "para": "Substituir uma página de vendas escrita por um vídeo de venda direta (gancho, problema, solução, prova, chamada para ação) que leva direto ao carrinho.",
  "quando": "Ticket baixo a médio. Produtos digitais, suplementos, infoprodutos que precisam demonstrar algo sem exigir webinário ao vivo.",
  "metrica": "Taxa de conclusão do vídeo (watch-through) e conversão do vídeo em compra",
  "nos": [
   {
    "id": "vs1",
    "k": "meta",
    "nome": "Anúncio para a VSL",
    "texto": "",
    "x": 15,
    "y": 23
   },
   {
    "id": "vs2",
    "k": "webinar",
    "nome": "Página com o vídeo (VSL)",
    "texto": "• Roteiro: gancho → problema → solução → prova → oferta",
    "x": 200,
    "y": 0
   },
   {
    "id": "vs3",
    "k": "formulario",
    "nome": "Formulário de pedido",
    "texto": "• Aparece após o vídeo, junto com o botão de compra",
    "x": 400,
    "y": 0
   },
   {
    "id": "vs4",
    "k": "checkout",
    "nome": "Checkout",
    "texto": "• Finaliza a compra",
    "x": 600,
    "y": 0
   },
   {
    "id": "vs5",
    "k": "upsellpg",
    "nome": "OTO (upsell)",
    "texto": "• Oferta complementar de 1 clique",
    "x": 800,
    "y": 0
   },
   {
    "id": "vs6",
    "k": "downsell",
    "nome": "Downsell",
    "texto": "• Alternativa mais barata para quem recusa o upsell",
    "x": 1000,
    "y": 0
   },
   {
    "id": "vs7",
    "k": "obrigado",
    "nome": "Página de confirmação",
    "texto": "• Acesso ao produto e próximos passos",
    "x": 1200,
    "y": 0
   }
  ],
  "setas": [
   {
    "de": "vs1",
    "para": "vs2",
    "rotulo": ""
   },
   {
    "de": "vs2",
    "para": "vs3",
    "rotulo": ""
   },
   {
    "de": "vs3",
    "para": "vs4",
    "rotulo": ""
   },
   {
    "de": "vs4",
    "para": "vs5",
    "rotulo": ""
   },
   {
    "de": "vs5",
    "para": "vs7",
    "rotulo": ""
   },
   {
    "de": "vs5",
    "para": "vs6",
    "rotulo": "recusou o upsell"
   },
   {
    "de": "vs6",
    "para": "vs7",
    "rotulo": ""
   }
  ]
 },
 {
  "id": "funil-webinario-perfect-webinar",
  "nome": "Webinário",
  "tipo": "Lançamento",
  "tags": [
   "Lançamento",
   "Perpétuo",
   "Alto ticket",
   "Infoproduto"
  ],
  "para": "Ensinar algo de valor (ao vivo ou gravado) e fechar a venda de uma oferta de ticket médio/alto no final, com o script \"Stack and Close\".",
  "quando": "Ticket médio a alto (aprox. R$200-R$10.000+). Infoprodutos, consultoria, serviços de conhecimento.",
  "metrica": "Taxa de comparecimento no webinário e taxa de fechamento entre os presentes",
  "nos": [
   {
    "id": "wb1",
    "k": "meta",
    "nome": "Anúncio para o webinário",
    "texto": "• Tráfego pago ou orgânico convida para a inscrição",
    "x": 15,
    "y": 23
   },
   {
    "id": "wb2",
    "k": "pagina",
    "nome": "Página de inscrição",
    "texto": "• Mostra data/horário e a promessa do webinário",
    "x": 200,
    "y": 0
   },
   {
    "id": "wb3",
    "k": "captura",
    "nome": "Cadastro",
    "texto": "• Nome, e-mail e telefone liberam o link",
    "x": 400,
    "y": 0
   },
   {
    "id": "wb4",
    "k": "email",
    "nome": "Sequência de aquecimento",
    "texto": "• Lembretes até o horário do webinário",
    "x": 615,
    "y": 23
   },
   {
    "id": "wb5",
    "k": "webinar",
    "nome": "Webinário (Intro + Conteúdo + Stack)",
    "texto": "• Conteúdo educacional de 60-90 min\n• No final, monta a pilha de valor da oferta",
    "x": 800,
    "y": 0
   },
   {
    "id": "wb6",
    "k": "pagina",
    "nome": "Página de oferta (Stack & Close)",
    "texto": "• Apresenta preço, bônus e urgência",
    "x": 1000,
    "y": 0
   },
   {
    "id": "wb7",
    "k": "checkout",
    "nome": "Checkout",
    "texto": "• Compra durante a janela de urgência",
    "x": 1200,
    "y": 0
   },
   {
    "id": "wb8",
    "k": "email",
    "nome": "Sequência de replay",
    "texto": "• Reforça a oferta por alguns dias para quem não comprou ao vivo",
    "x": 1415,
    "y": 23
   }
  ],
  "setas": [
   {
    "de": "wb1",
    "para": "wb2",
    "rotulo": ""
   },
   {
    "de": "wb2",
    "para": "wb3",
    "rotulo": ""
   },
   {
    "de": "wb3",
    "para": "wb4",
    "rotulo": ""
   },
   {
    "de": "wb4",
    "para": "wb5",
    "rotulo": ""
   },
   {
    "de": "wb5",
    "para": "wb6",
    "rotulo": ""
   },
   {
    "de": "wb6",
    "para": "wb7",
    "rotulo": ""
   },
   {
    "de": "wb7",
    "para": "wb8",
    "rotulo": "não comprou ao vivo"
   }
  ]
 },
 {
  "id": "isca-baleia",
  "nome": "Isca de baleia",
  "tipo": "Isca",
  "tags": [
   "Alto ticket",
   "Captação de leads"
  ],
  "para": "Uma peça que só o dono do negócio consome: filtra sardinha e atrai baleia.",
  "quando": "",
  "metrica": "",
  "nos": [
   {
    "id": "nA",
    "k": "instagram",
    "nome": "Montar a peça",
    "texto": "montar a peca de altissimo valor que so o decisor quer (framework, planilha, checklist) — filtra sardinha, atrai baleia. A skill isca-baleia cria SO a peca; o funil e maior que a peca (os nos seguintes) — etapa de criacao, ainda sem indicador de funil",
    "x": 0,
    "y": 0
   },
   {
    "id": "nB",
    "k": "meta",
    "nome": "Distribuir a isca",
    "texto": "distribuir a peca pelo canal decidido na aresta de entrada (organica: mais volume, menos qualificacao / paga: menos volume, mais qualificacao) — sem skill dedicada de distribuicao no catalogo (gap: nao reusa isca-baleia de novo aqui, essa skill so cria a peca) — indicador: CPM->CTR (canal pago) ou alcance/engajamento (canal organico), regua secao 5",
    "x": 200,
    "y": 0
   },
   {
    "id": "nC",
    "k": "whatsapp",
    "nome": "Capturar contato",
    "texto": "capturar email ou WhatsApp do decisor atras da pagina de captura da peca — indicador: Lead (taxa de conversao), regua secao 5",
    "x": 400,
    "y": 0
   },
   {
    "id": "nD",
    "k": "crm",
    "nome": "Qualificar: é decisor?",
    "texto": "confirmar que quem capturou e decisor de fato e nao sardinha, com a mesma ANALISE de sinais publicos (Instagram, Ads Library, PageSpeed, funil) que a Alva ja faz — bloqueio ate prova de decisor real antes de encaminhar pro funil de fechamento — indicador: Lead -> Lead qualificado, com padrao mais alto que a media porque a peca ja pre-filtra (regua secao 5: referencia 20% a 50%)\n• GATE-DECISOR-CONFIRMADO\n• ANALISE Alva: filtra sardinha de baleia",
    "x": 600,
    "y": 0
   },
   {
    "id": "nE",
    "k": "cliente",
    "nome": "Encaminhar para o fechamento",
    "texto": "encaminhar o lead ultraqualificado pro funil de fechamento certo — Sessao Estrategica (sessao-estrategica-diagnostico.yaml) quando veio de canal organico/social selling, ou Aplicacao Direta (aplicacao-direta.yaml) quando veio de canal pago ja consciente — nao duplica os nos de call/fechamento aqui, so encaminha\n• Sessao Estrategica ou Aplicacao Direta",
    "x": 800,
    "y": 0
   },
   {
    "id": "nF",
    "k": "perda",
    "nome": "Escala para um humano",
    "texto": "",
    "x": 800,
    "y": 130
   }
  ],
  "setas": [
   {
    "de": "nA",
    "para": "nB",
    "rotulo": "organica: +volume -qualificacao"
   },
   {
    "de": "nA",
    "para": "nB",
    "rotulo": "paga: -volume +qualificacao"
   },
   {
    "de": "nB",
    "para": "nC",
    "rotulo": ""
   },
   {
    "de": "nC",
    "para": "nD",
    "rotulo": ""
   },
   {
    "de": "nD",
    "para": "nE",
    "rotulo": "decisor confirmado"
   },
   {
    "de": "nD",
    "para": "nF",
    "rotulo": "gate reprovado, contesta"
   }
  ]
 },
 {
  "id": "saque-o-dinheiro",
  "nome": "Saque o dinheiro",
  "tipo": "Upsell",
  "tags": [
   "Ascensão e recorrência"
  ],
  "para": "Oferecer à base atual o degrau de cima: pico de caixa rápido.",
  "quando": "",
  "metrica": "",
  "nos": [
   {
    "id": "nA",
    "k": "nota",
    "nome": "Há base que não subiu?",
    "texto": "checar se existe base de clientes/alunos que ainda nao subiu de camada (demanda reprimida) — Saque o Dinheiro so faz sentido com isso, sem demanda reprimida aborta. Para a Alva equivale a subir cliente de camada (Alvorecer -> Raiar)\n• GATE-DEMANDA-REPRIMIDA",
    "x": -43,
    "y": 28
   },
   {
    "id": "nESC",
    "k": "perda",
    "nome": "Escala para um humano",
    "texto": "",
    "x": 1015,
    "y": 23
   },
   {
    "id": "nB",
    "k": "crm",
    "nome": "Segmentar a base",
    "texto": "segmentar no CRM quem ja e cliente/aluno e ainda nao subiu de camada",
    "x": 215,
    "y": 183
   },
   {
    "id": "nC",
    "k": "proposta",
    "nome": "Ofertar o degrau de cima",
    "texto": "ofertar a subida de camada (Alvorecer -> Raiar) para a base segmentada — e o Saque o Dinheiro para a propria Alva\n• Alvorecer -> Raiar",
    "x": 400,
    "y": 160
   },
   {
    "id": "nD",
    "k": "cliente",
    "nome": "Fechamento rápido",
    "texto": "negociar e fechar rapido (pico de caixa, nao ciclo longo) — indicador: Reuniao realizada -> Venda (regua secao 5: referencia 20% a 30%)\n• Realizado->Venda (20-30%",
    "x": 615,
    "y": 183
   },
   {
    "id": "nE",
    "k": "crm",
    "nome": "Medir o pico de caixa",
    "texto": "medir o pico de caixa gerado pela ascensao contra o baseline do mes",
    "x": 815,
    "y": 183
   }
  ],
  "setas": [
   {
    "de": "nA",
    "para": "nB",
    "rotulo": "sim"
   },
   {
    "de": "nB",
    "para": "nC",
    "rotulo": ""
   },
   {
    "de": "nC",
    "para": "nD",
    "rotulo": ""
   },
   {
    "de": "nD",
    "para": "nE",
    "rotulo": ""
   },
   {
    "de": "nE",
    "para": "nESC",
    "rotulo": "pico nao aparece<br/>apesar do fechamento"
   },
   {
    "de": "nA",
    "para": "nESC",
    "rotulo": "não"
   }
  ]
 },
 {
  "id": "sessao-estrategica-diagnostico",
  "nome": "Sessão estratégica (diagnóstico)",
  "tipo": "Diagnóstico pago",
  "tags": [
   "Alto ticket"
  ],
  "para": "O carro-chefe da biblioteca: página, formulário qualificatório, agendamento, SDR e closer.",
  "quando": "",
  "metrica": "",
  "nos": [
   {
    "id": "nA",
    "k": "pagina",
    "nome": "Página de vendas",
    "texto": "publicar a pagina de vendas da Sessao Estrategica (o carro-chefe: prova a competencia antes de cobrar, o melhor funil pra vender servico high-ticket pra lead frio) — indicador: cadeia Impressao(CPM)->Clique(CTR)->Visualizacao de pagina/connect rate da regua (secao 5)\n• Se nao preenche: volta para este passo",
    "x": 0,
    "y": 0
   },
   {
    "id": "nB",
    "k": "formulario",
    "nome": "Formulário qualificatório",
    "texto": "coletar o formulario qualificatorio rodando a mesma ANALISE que a Alva ja faz em lead/prospect (Instagram, Ads Library, PageSpeed, funil, sinais publicos) pra decidir se qualifica pro diagnostico premium — indicador: Lead -> Lead qualificado (regua secao 5: referencia 20% a 50%)\n• PageSpeed, funil\n• ANALISE Alva: Instagram, Ads Library,",
    "x": 200,
    "y": 0
   },
   {
    "id": "nC",
    "k": "agenda",
    "nome": "Agendamento",
    "texto": "",
    "x": 400,
    "y": 0
   },
   {
    "id": "nD",
    "k": "pagina",
    "nome": "Página de confirmação",
    "texto": "servir a pagina de confirmacao com aquecimento (conteudo de valor pre-call) pra reduzir no-show — indicador: Reuniao agendada -> Reuniao realizada (regua secao 5: referencia 70% a 85%, no-show maximo ~30%)\n• Se no-show: volta para este passo",
    "x": 600,
    "y": 0
   },
   {
    "id": "nE",
    "k": "reuniao",
    "nome": "Call com SDR",
    "texto": "rodar a call com SDR/setter: triagem final antes do closer — sem skill dedicada de call de triagem inbound no catalogo (gap; o mais proximo, vendas-script-bdr, ja foi usado no agendamento e e outbound BUNCH, contexto diferente) — indicador: avanco pra SQL (qualificacao comercial), cadeia da regua secao 5",
    "x": 800,
    "y": 0
   },
   {
    "id": "nF",
    "k": "reuniao",
    "nome": "Call com closer",
    "texto": "conduzir a call com closer: e exatamente a ANALISE que a Alva ja faz (Instagram, Ads Library, PageSpeed, funil) apresentada ao vivo, com matriz de fit e resposta a objecao — indicador: Reuniao realizada -> Venda (regua secao 5: referencia 20% a 30%)",
    "x": 1000,
    "y": 0
   },
   {
    "id": "nG",
    "k": "cliente",
    "nome": "Fechamento",
    "texto": "fechar com contrato premium recorrente com PLAYBOOK e SLA obrigatorios — oferta sem playbook nao e vendida (mesmo GATE-PLAYBOOK-OBRIGATORIO de aquisicao-alva.yaml e diagnostico-funil.yaml, mesma regra de negocio dita de novo aqui) — indicador final da cadeia: Venda\n• GATE-PLAYBOOK-OBRIGATORIO\n• Se nao fechou: volta para este passo",
    "x": 1200,
    "y": 0
   },
   {
    "id": "nH",
    "k": "perda",
    "nome": "Escala para um humano",
    "texto": "",
    "x": 1400,
    "y": 130
   }
  ],
  "setas": [
   {
    "de": "nA",
    "para": "nB",
    "rotulo": "preenche"
   },
   {
    "de": "nB",
    "para": "nC",
    "rotulo": ""
   },
   {
    "de": "nC",
    "para": "nD",
    "rotulo": ""
   },
   {
    "de": "nD",
    "para": "nE",
    "rotulo": "compareceu"
   },
   {
    "de": "nE",
    "para": "nF",
    "rotulo": ""
   },
   {
    "de": "nF",
    "para": "nG",
    "rotulo": ""
   },
   {
    "de": "nG",
    "para": "nH",
    "rotulo": "contesta/dado conflitante"
   }
  ]
 },
 {
  "id": "social-selling",
  "nome": "Social selling",
  "tipo": "Isca",
  "tags": [
   "Alto ticket",
   "Captação de leads"
  ],
  "para": "Conteúdo, listas e visita sincera até a conversa virar reunião.",
  "quando": "",
  "metrica": "",
  "nos": [
   {
    "id": "nA",
    "k": "instagram",
    "nome": "Conteúdo",
    "texto": "produzir o conteudo que alimenta a escada (atrair, aquecer, vender), ajustado ao nivel de consciencia do publico, distribuido por formato — precisa ser isca de baleia: assertivo, filtra o publico certo, sempre teste (doutrina secao 7) — indicador: alcance/CTR de topo (regua secao 5)\n• Se sem interacao: volta para este passo",
    "x": 15,
    "y": 23
   },
   {
    "id": "nB",
    "k": "crm",
    "nome": "Listas",
    "texto": "montar as listas de quem interage: mensagens no direct, interacoes/curtidas em stories, comentarios no feed/lives, novos seguidores, visualizadores — sem skill dedicada de segmentacao de lista de Instagram no catalogo (gap)",
    "x": 215,
    "y": 23
   },
   {
    "id": "nC",
    "k": "crm",
    "nome": "Qualificação",
    "texto": "qualificar quem entrou na lista com a mesma ANALISE de sinais publicos (Instagram, site, contexto) que a Alva ja faz — indicador: Lead -> Lead qualificado (regua secao 5: referencia 20% a 50%)\n• ANALISE Alva",
    "x": 415,
    "y": 23
   },
   {
    "id": "nD",
    "k": "instagram",
    "nome": "Ativação: visita sincera",
    "texto": "acionar o fluxo de ativacao com script proprio por gatilho (Novos Seguidores: boas-vindas + oferta de ajuda / Visita Sincera: comentario genuino provando que olhou o perfil / Gatilho Social: resposta a quem reagiu enquete ou caixinha) — sem skill dedicada de script de ativacao por direct no catalogo (gap: vendas-script-bdr e outbound BUNCH, contexto diferente)\n• Novos Seguidores / Visita Sincera / Gatilho Social",
    "x": 615,
    "y": 23
   },
   {
    "id": "nE",
    "k": "instagram",
    "nome": "Condução da conversa",
    "texto": "conduzir a conversa extraindo a dor/desejo do lead — sem skill dedicada de condução de conversa em direct no catalogo (gap)",
    "x": 815,
    "y": 23
   },
   {
    "id": "nF",
    "k": "instagram",
    "nome": "Conversão",
    "texto": "oferecer ajuda nao invasiva (a partir da oferta ja produtizada) e capturar o contato — o social selling conclui seu papel aqui, dali o SDR assume (doutrina secao 7) — indicador: Lead qualificado -> Reuniao agendada (regua secao 5: referencia 25% a 60%, aplicada a etapa seguinte)",
    "x": 1015,
    "y": 23
   },
   {
    "id": "nG",
    "k": "agenda",
    "nome": "Agendamento",
    "texto": "agendar com o SDR, que assume a partir daqui — indicador: Lead qualificado -> Reuniao agendada (regua secao 5: referencia 25% a 60%)\n• SDR assume",
    "x": 1200,
    "y": 0
   },
   {
    "id": "nH",
    "k": "cliente",
    "nome": "Venda",
    "texto": "fechar via closer, atraves da Sessao Estrategica (sessao-estrategica-diagnostico.yaml, nos call-closer/fechamento) — doutrina secao 7: 'venda (closer via sessao estrategica)' — nao duplica os nos aqui, so referencia. Oferta sem playbook nao e vendida (mesmo GATE-PLAYBOOK-OBRIGATORIO) — indicador: Reuniao realizada -> Venda (regua secao 5: referencia 20% a 30%)\n• GATE-PLAYBOOK-OBRIGATORIO",
    "x": 1415,
    "y": 23
   },
   {
    "id": "nI",
    "k": "perda",
    "nome": "Escala para um humano",
    "texto": "",
    "x": 1615,
    "y": 23
   }
  ],
  "setas": [
   {
    "de": "nA",
    "para": "nB",
    "rotulo": ""
   },
   {
    "de": "nB",
    "para": "nC",
    "rotulo": ""
   },
   {
    "de": "nC",
    "para": "nD",
    "rotulo": ""
   },
   {
    "de": "nD",
    "para": "nE",
    "rotulo": ""
   },
   {
    "de": "nE",
    "para": "nF",
    "rotulo": ""
   },
   {
    "de": "nF",
    "para": "nG",
    "rotulo": ""
   },
   {
    "de": "nG",
    "para": "nH",
    "rotulo": ""
   },
   {
    "de": "nH",
    "para": "nI",
    "rotulo": "contesta/dado conflitante"
   }
  ]
 }
]);
