<?php

require_once __DIR__ . '/CheckoutNormalizer.php';

/**
 * Traduz o webhook de compra aprovada da Hotmart para o evento canonico.
 *
 * Mapeado a partir da documentacao do Webhook 2.0 da Hotmart. A Hotmart entrega
 * valores em unidade decimal (price.value) e datas em milissegundos.
 *
 * Os campos de origem — origin.sck, origin.src, origin.xcode e
 * tracking.source_sck — sao o unico canal de repasse disponivel: o checkout e
 * hospedado pela Hotmart e descarta parametros arbitrarios da URL.
 *
 * PRECISA DE VALIDACAO contra um webhook real antes de considerar concluido. A
 * documentacao descreve a estrutura em fragmentos e ha diferenca entre as
 * versoes 1.x e 2.0 do webhook; por isso cada campo aceita varios caminhos.
 */
class HotmartTranslator
{
    public const PLATFORM = 'hotmart';

    private const APPROVED_EVENTS = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'];
    private const APPROVED_STATUSES = ['APPROVED', 'COMPLETE', 'COMPLETED'];

    public static function translatePurchaseApproved(array $rawPayload): ?array
    {
        $event = strtoupper((string) CheckoutNormalizer::firstPath($rawPayload, [
            'event',
            'eventstring',
            'data.event',
        ]));

        $status = strtoupper((string) CheckoutNormalizer::firstPath($rawPayload, [
            'data.purchase.status',
            'purchase.status',
            'data.status',
            'status',
        ]));

        $eventApproved = in_array($event, self::APPROVED_EVENTS, true);
        $statusApproved = in_array($status, self::APPROVED_STATUSES, true);

        if (!$eventApproved && !$statusApproved) {
            return null;
        }

        $transactionId = CheckoutNormalizer::firstPath($rawPayload, [
            'data.purchase.transaction',
            'purchase.transaction',
            'data.transaction',
            'transaction',
        ]);

        if ($transactionId === null) {
            return null;
        }

        $passthrough = CheckoutNormalizer::resolvePassthrough([
            'sck' => CheckoutNormalizer::firstPath($rawPayload, [
                'data.purchase.origin.sck',
                'purchase.origin.sck',
                'data.purchase.tracking.source_sck',
                'purchase.tracking.source_sck',
            ]),
            'src' => CheckoutNormalizer::firstPath($rawPayload, [
                'data.purchase.origin.src',
                'purchase.origin.src',
                'data.purchase.tracking.source',
                'purchase.tracking.source',
            ]),
            'xcode' => CheckoutNormalizer::firstPath($rawPayload, [
                'data.purchase.origin.xcode',
                'purchase.origin.xcode',
                'data.purchase.origin.xcod',
            ]),
            'external_code' => CheckoutNormalizer::firstPath($rawPayload, [
                'data.purchase.tracking.external_code',
                'purchase.tracking.external_code',
            ]),
        ]);

        $propertyId = self::extractPropertyId($rawPayload, $passthrough);

        $fullName = CheckoutNormalizer::firstPath($rawPayload, [
            'data.buyer.name',
            'buyer.name',
            'data.buyer.first_name',
        ]);

        [$firstName, $lastName] = CheckoutNormalizer::splitName($fullName);

        $value = CheckoutNormalizer::decimalAmount(CheckoutNormalizer::firstPath($rawPayload, [
            'data.purchase.price.value',
            'purchase.price.value',
            'data.purchase.full_price.value',
        ]));

        $currency = CheckoutNormalizer::currency(CheckoutNormalizer::firstPath($rawPayload, [
            'data.purchase.price.currency_code',
            'purchase.price.currency_code',
            'data.purchase.price.currency_value',
        ]));

        $eventTime = CheckoutNormalizer::timestamp(CheckoutNormalizer::firstPath($rawPayload, [
            'data.purchase.approved_date',
            'purchase.approved_date',
            'data.purchase.order_date',
            'creation_date',
        ])) ?? time();

        $productName = CheckoutNormalizer::firstPath($rawPayload, [
            'data.product.name',
            'product.name',
        ]);

        $productId = CheckoutNormalizer::firstPath($rawPayload, [
            'data.product.id',
            'data.product.ucode',
            'product.id',
        ]);

        return [
            'property_id' => $propertyId,
            'event_id' => 'nvs_purchase_' . $transactionId,
            'event_name' => 'purchase',
            'meta_event_name' => 'Purchase',
            'event_time' => $eventTime,
            'source' => 'webhook',
            'source_platform' => self::PLATFORM,

            'context' => [
                'property_id' => $propertyId,
                'cookie_prefix' => $propertyId === 'default' ? 'nvs' : 'nvs_' . $propertyId,
                'nvs_uid' => $passthrough['nvs_uid'],
                'nvs_sid' => null,
                'page_url' => null,
                'landing_url' => null,
                'checkout_url' => null,
                'referrer' => null,
                'ip_address' => null,
                'user_agent' => null,
                'utm' => CheckoutNormalizer::normalizeUtm([]),
                'provider_ids' => CheckoutNormalizer::emptyProviderIds(),
                'checkout_session_id' => null,
                'captured_at' => null,
                'checkout_passthrough' => $passthrough['candidates'],
            ],

            'user' => [
                'customer_id' => CheckoutNormalizer::firstPath($rawPayload, [
                    'data.buyer.ucode',
                    'buyer.ucode',
                    'data.buyer.id',
                ]),
                'email' => CheckoutNormalizer::firstPath($rawPayload, [
                    'data.buyer.email',
                    'buyer.email',
                ]),
                'phone' => CheckoutNormalizer::phone(CheckoutNormalizer::firstPath($rawPayload, [
                    'data.buyer.checkout_phone',
                    'data.buyer.phone',
                    'buyer.checkout_phone',
                ])),
                'full_name' => $fullName,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'country' => CheckoutNormalizer::firstPath($rawPayload, [
                    'data.buyer.address.country_iso',
                    'data.buyer.address.country',
                    'buyer.address.country_iso',
                ]),
                'locale' => null,
            ],

            'params' => [
                'transaction_id' => $transactionId,
                'value' => $value,
                'currency' => $currency,
                'status' => $status !== '' ? $status : 'APPROVED',
                'payment_type' => CheckoutNormalizer::firstPath($rawPayload, [
                    'data.purchase.payment.type',
                    'purchase.payment.type',
                    'data.purchase.payment.method',
                ]),
                'installments' => CheckoutNormalizer::get($rawPayload, 'data.purchase.payment.installments_number'),
                'is_subscription' => (bool) CheckoutNormalizer::get($rawPayload, 'data.purchase.is_subscription'),
                'recurrency_number' => CheckoutNormalizer::get($rawPayload, 'data.purchase.recurrency_number'),
                'offer_code' => CheckoutNormalizer::firstPath($rawPayload, [
                    'data.purchase.offer.code',
                    'purchase.offer.code',
                ]),
                'item_count' => 1,
                'items' => $productId !== null || $productName !== null
                    ? [[
                        'item_id' => (string) ($productId ?? ''),
                        'item_name' => (string) ($productName ?? ''),
                        'price' => $value,
                        'quantity' => 1,
                        'currency' => $currency,
                    ]]
                    : [],
            ],

            '_source_raw' => $rawPayload,
        ];
    }

    /**
     * O property_id explicito da URL do webhook tem precedencia e e resolvido no
     * dispatch. Aqui apenas se aproveita o que o payload carrega.
     */
    private static function extractPropertyId(array $payload, array $passthrough): string
    {
        $direct = CheckoutNormalizer::firstPath($payload, [
            'nvs_property_id',
            'property_id',
            'data.purchase.origin.nvs_property_id',
        ]);

        if ($direct !== null) {
            return CheckoutNormalizer::cleanKey($direct, 'default');
        }

        // nvs_<projeto>_<hex>: o segmento do meio nomeia o projeto.
        if ($passthrough['nvs_uid'] !== null
            && preg_match('/^nvs_([a-z0-9_]+)_[a-f0-9]{8,}$/i', $passthrough['nvs_uid'], $matches)
        ) {
            $candidate = strtolower($matches[1]);

            if ($candidate !== '' && $candidate !== 'uid') {
                return CheckoutNormalizer::cleanKey($candidate, 'default');
            }
        }

        return 'default';
    }
}
