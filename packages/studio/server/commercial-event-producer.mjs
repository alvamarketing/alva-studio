const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;

function fail(message) { return Object.assign(new Error(message), { status: 400, statusCode: 400 }); }
function financialParams({ transactionId, value, currency } = {}) {
  if (typeof transactionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,190}$/.test(transactionId)) throw fail('transaction_id inválido.');
  if (!Number.isFinite(value) || value < 0) throw fail('value inválido.');
  if (typeof currency !== 'string' || !CURRENCY.test(currency)) throw fail('currency inválido.');
  return { transaction_id: transactionId, value, currency };
}

// Ponto interno para a futura integração de checkout/pagamento. Não há rota HTTP:
// o registro de checkout/pagamento já persistido entrega o UUID estável ao produtor.
export class CommercialEventProducer {
  constructor({ database, outbox }) { this.database = database; this.outbox = outbox; }
  async emit(type, { companyId, projectId, environment, trackingEventId, transactionId, value, currency, at }) {
    if (!['initiate_checkout', 'purchase'].includes(type) || !UUID.test(String(trackingEventId))) throw fail('Evento financeiro inválido.');
    const params = financialParams({ transactionId, value, currency });
    return this.database.transaction((client) => this.outbox.enqueue(client, { companyId, projectId, environment, trackingEventId, eventName: type, params, at }));
  }
  initiateCheckout(record) { return this.emit('initiate_checkout', record); }
  purchase(record) { return this.emit('purchase', record); }
}
