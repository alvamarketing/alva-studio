// Os destinos de conversão do Alva Tracking, portados do PHP que morava no runtime NVS.
//
// Cada destino sabe uma coisa só: como a plataforma dele quer receber um evento. Não
// decide quando disparar — isso é da fila — nem guarda credencial, que chega cifrada do
// cofre e é decifrada pelo chamador.
//
// A regra que atravessa todos: o `tracking_event_id` do Studio vai como identificador do
// evento na plataforma. É ele que deduplica contra o pixel do navegador, e por isso ele
// nasce uma vez e a retentativa reusa o mesmo. A documentação da Meta descarta o evento
// repetido dentro de 48 horas quando `event_id` e `event_name` coincidem; gerar um
// identificador novo a cada tentativa transforma retentativa em evento novo, que é como
// um pixel chega a disparar milhares de vezes o que aconteceu uma.
//
// A outra regra: daqui não sai contato em claro. O e-mail e o telefone já chegam
// hasheados em SHA-256 e é isso que as plataformas esperam.

import { nomeNaPlataforma } from './nomes-de-evento.mjs';

function recusa(motivo) {
  return Object.assign(new Error(motivo), { destino: true });
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function semVazios(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined && valor !== null && valor !== ''));
}

const meta = {
  chave: 'meta',
  // A Meta faz a própria correspondência: aceita o evento mesmo sem clique nem contato.
  podeAtribuir: () => true,
  corpo(evento) {
    return {
      data: [{
        event_name: nomeNaPlataforma('meta', evento.event_name),
        event_time: evento.event_time,
        event_id: evento.tracking_event_id,
        action_source: 'website',
        // Onde a conversão aconteceu. A Meta usa o endereço na atribuição e na qualidade
        // de correspondência; omiti-lo joga fora um sinal que o servidor já tem em mãos.
        ...(evento.source_url ? { event_source_url: evento.source_url } : {}),
        user_data: semVazios({
          em: evento.user?.email_sha256,
          ph: evento.user?.phone_sha256,
          fbc: evento.click_ids?.fbc,
          fbp: evento.click_ids?.fbp,
          // Endereço e navegador de quem converteu: dois dos sinais que mais pesam na
          // correspondência, e os únicos aqui que não são hash nem identificador de clique.
          client_ip_address: evento.client?.ip,
          client_user_agent: evento.client?.user_agent,
        }),
        custom_data: evento.params ?? {},
      }],
    };
  },
  requisicao(evento, credenciais = {}) {
    const pixel = texto(credenciais.pixel_id);
    const token = texto(credenciais.access_token);
    if (!pixel || !token) throw recusa('destination_not_configured');
    return {
      metodo: 'POST',
      url: `https://graph.facebook.com/v20.0/${encodeURIComponent(pixel)}/events`,
      cabecalhos: [`Authorization: Bearer ${token}`],
      corpo: meta.corpo(evento),
    };
  },
};

const tiktok = {
  chave: 'tiktok',
  podeAtribuir: () => true,
  corpo(evento, credenciais) {
    return {
      event_source: 'web',
      event_source_id: credenciais.pixel_code ?? null,
      data: [{
        event: nomeNaPlataforma('tiktok', evento.event_name),
        event_time: evento.event_time,
        event_id: evento.tracking_event_id,
        user: semVazios({
          email: evento.user?.email_sha256,
          phone: evento.user?.phone_sha256,
          ttclid: evento.click_ids?.ttclid,
        }),
        properties: evento.params ?? {},
      }],
    };
  },
  requisicao(evento, credenciais = {}) {
    if (!texto(credenciais.pixel_code) || !texto(credenciais.access_token)) throw recusa('destination_not_configured');
    return {
      metodo: 'POST',
      url: 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      cabecalhos: [`Access-Token: ${credenciais.access_token}`],
      corpo: tiktok.corpo(evento, credenciais),
    };
  },
};

const TEM_CLIQUE_DO_GOOGLE = (evento) => Boolean(evento.click_ids?.gclid || evento.click_ids?.gbraid || evento.click_ids?.wbraid);
const TEM_CONTATO = (evento) => Boolean(evento.user?.email_sha256 || evento.user?.phone_sha256);

const google = {
  chave: 'google',
  // Sem o clique dele e sem contato hasheado, o Google não tem a quem atribuir. A fila faz
  // esta mesma pergunta antes de endereçar: um lead de Facebook não vira entrega morta
  // para o Google.
  podeAtribuir: (evento) => TEM_CLIQUE_DO_GOOGLE(evento) || TEM_CONTATO(evento),
  corpo(evento, credenciais) {
    const identificadoresDeAnuncio = semVazios({
      gclid: evento.click_ids?.gclid,
      gbraid: evento.click_ids?.gbraid,
      wbraid: evento.click_ids?.wbraid,
    });
    const identificadoresDePessoa = [
      evento.user?.email_sha256 ? { emailAddress: evento.user.email_sha256 } : null,
      evento.user?.phone_sha256 ? { phoneNumber: evento.user.phone_sha256 } : null,
    ].filter(Boolean);
    if (!google.podeAtribuir(evento)) throw recusa('destination_identifier_required');

    const consentiu = (evento.consent_state ?? 'pending') === 'granted' ? 'GRANTED' : 'DENIED';
    const conversao = {
      transactionId: evento.params?.transaction_id ?? evento.tracking_event_id,
      eventTimestamp: new Date(Number(evento.event_time) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      eventSource: 'WEB',
      eventName: evento.event_name,
      consent: { adUserData: consentiu, adPersonalization: consentiu, adStorage: consentiu, analyticsStorage: consentiu },
    };
    if (Object.keys(identificadoresDeAnuncio).length) conversao.adIdentifiers = identificadoresDeAnuncio;
    if (identificadoresDePessoa.length) conversao.userData = { userIdentifiers: identificadoresDePessoa };
    if (evento.params?.value !== undefined) conversao.conversionValue = Number(evento.params.value);
    if (evento.params?.currency !== undefined) conversao.currency = evento.params.currency;

    return {
      destinations: [{
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: credenciais.operating_account_id },
        productDestinationId: credenciais.conversion_action_id,
      }],
      events: [conversao],
      encoding: 'HEX',
    };
  },
  requisicao(evento, credenciais = {}) {
    for (const chave of ['operating_account_id', 'conversion_action_id']) {
      if (!/^[0-9]{1,20}$/.test(texto(credenciais[chave]))) throw recusa('destination_not_configured');
    }
    if (!texto(credenciais.oauth_access_token)) throw recusa('destination_not_configured');
    return {
      metodo: 'POST',
      url: 'https://datamanager.googleapis.com/v1/events:ingest',
      cabecalhos: [`Authorization: Bearer ${credenciais.oauth_access_token}`],
      corpo: google.corpo(evento, credenciais),
    };
  },
};

const linkedin = {
  chave: 'linkedin',
  podeAtribuir: (evento) => Boolean(evento.user?.email_sha256 || evento.click_ids?.linkedin_tracking_uuid),
  corpo(evento, credenciais) {
    const identificadores = [
      evento.user?.email_sha256 ? { idType: 'SHA256_EMAIL', idValue: evento.user.email_sha256 } : null,
      evento.click_ids?.linkedin_tracking_uuid
        ? { idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: evento.click_ids.linkedin_tracking_uuid }
        : null,
    ].filter(Boolean);
    if (!linkedin.podeAtribuir(evento)) throw recusa('destination_identifier_required');

    const corpo = {
      conversion: credenciais.conversion_urn,
      // O LinkedIn conta em milissegundos; mandar segundos coloca a conversão em 1970.
      conversionHappenedAt: Number(evento.event_time) * 1000,
      user: { userIds: identificadores },
      eventId: evento.tracking_event_id,
    };
    if (evento.params?.value !== undefined && evento.params?.currency !== undefined) {
      corpo.conversionValue = { currencyCode: evento.params.currency, amount: String(evento.params.value) };
    }
    return corpo;
  },
  requisicao(evento, credenciais = {}) {
    if (!/^urn:lla:llaPartnerConversion:[0-9]{1,20}$/.test(texto(credenciais.conversion_urn)) || !texto(credenciais.access_token))
      throw recusa('destination_not_configured');
    const versao = texto(credenciais.linkedin_version) || '202608';
    if (!/^[0-9]{6}$/.test(versao)) throw recusa('destination_not_configured');
    return {
      metodo: 'POST',
      url: 'https://api.linkedin.com/rest/conversionEvents',
      cabecalhos: [
        `Authorization: Bearer ${credenciais.access_token}`,
        `Linkedin-Version: ${versao}`,
        'X-Restli-Protocol-Version: 2.0.0',
      ],
      corpo: linkedin.corpo(evento, credenciais),
    };
  },
};

const CLIQUE_DA_TABOOLA = /^[A-Za-z0-9._~-]{1,200}$/;

const taboola = {
  chave: 'taboola',
  podeAtribuir: (evento) => CLIQUE_DA_TABOOLA.test(texto(evento.click_ids?.taboola_click_id)),
  // A Taboola não recebe corpo: o evento inteiro cabe na URL do GET.
  requisicao(evento) {
    if (!taboola.podeAtribuir(evento)) throw recusa('destination_identifier_required');
    const clique = texto(evento.click_ids?.taboola_click_id);
    return {
      metodo: 'GET',
      url: `https://trc.taboola.com/actions-handler/log/3/s2s-action?click-id=${encodeURIComponent(clique)}&name=${encodeURIComponent(evento.event_name)}`,
      cabecalhos: [],
      corpo: null,
    };
  },
};

export const DESTINOS = Object.freeze({ meta, tiktok, google, linkedin, taboola });

export function destinoPara(chave) {
  const destino = DESTINOS[String(chave ?? '')];
  if (!destino) throw recusa(`destino desconhecido: ${chave}`);
  return destino;
}
