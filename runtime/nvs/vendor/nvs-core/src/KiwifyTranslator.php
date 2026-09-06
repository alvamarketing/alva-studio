<?php

require_once __DIR__ . '/CheckoutNormalizer.php';

/**
 * Traduz o webhook de compra aprovada da Kiwify para o evento canonico.
 *
 * ATENCAO AO VALOR: a Kiwify entrega valores em CENTAVOS (charge_amount: 12048
 * para R$ 120,48), ao contrario da Hotmart, que entrega decimal. Tratar as duas
 * do mesmo jeito erra por 100x sem gerar erro nenhum — uma venda de R$ 120
 * chegaria a Meta como R$ 12.048 e envenenaria a otimizacao da campanha.
 *
 * A Kiwify oferece mais slots de repasse que a Hotmart: sck, src e s1..s3.
 *
 * PRECISA DE VALIDACAO contra um webhook real antes de considerar concluido.
 */
class KiwifyTranslator
{
    public const PLATFORM = 'kiwify';

    private const APPROVED_STATUSES = ['PAID', 'APPROVED', 'COMPLETED'];

    public static function translatePurchaseApproved(array $rawPayload): ?array
    {
        $status = strtoupper((string) CheckoutNormalizer::firstPath($rawPayload, [
            'order_status',
            'data.order_status',
            'data.status',
            'status',
        ]));

        $eventType = strtoupper((string) CheckoutNormalizer::firstPath($rawPayload, [
            'webhook_event_type',
            'type',
            'event',
        ]));

        $statusApproved = in_array($status, self::APPROVED_STATUSES, true);
        $eventApproved = strpos($eventType, 'APPROVED') !== false
            || strpos($eventType, 'PAID') !== false;

        if (!$statusApproved && !$eventApproved) {
            return null;
        }

        $transactionId = CheckoutNormalizer::firstPath($rawPayload, [
            'order_id',
            'data.order_id',
            'data.id',
            'id',
        ]);

        if ($transactionId === null) {
            return null;
        }

        $passthrough = CheckoutNormalizer::resolvePassthrough([
            'sck' => CheckoutNormalizer::firstPath($rawPayload, [
                'TrackingParameters.sck',
                'tracking.sck',
                'data.tracking.sck',
            ]),
            'src' => CheckoutNormalizer::firstPath($rawPayload, [
                'TrackingParameters.src',
                'tracking.src',
                'data.tracking.src',
            ]),
            's1' => CheckoutNormalizer::firstPath($rawPayload, ['TrackingParameters.s1', 'tracking.s1']),
            's2' => CheckoutNormalizer::firstPath($rawPayload, ['TrackingParameters.s2', 'tracking.s2']),
            's3' => CheckoutNormalizer::firstPath($rawPayload, ['TrackingParameters.s3', 'tracking.s3']),
        ]);

        $propertyId = self::extractPropertyId($rawPayload, $passthrough);

        $fullName = CheckoutNormalizer::firstPath($rawPayload, [
            'Customer.full_name',
            'Customer.name',
            'customer.name',
            'data.Customer.name',
        ]);

        [$firstName, $lastName] = CheckoutNormalizer::splitName($fullName);

        // Centavos. Ver o aviso no topo da classe.
        $value = CheckoutNormalizer::centsAmount(CheckoutNormalizer::firstPath($rawPayload, [
            'Commissions.charge_amount',
            'commissions.charge_amount',
            'data.Commissions.charge_amount',
            'CommissionedStores.charge_amount',
        ]));

        $currency = CheckoutNormalizer::currency(CheckoutNormalizer::firstPath($rawPayload, [
            'Commissions.currency',
            'commissions.currency',
            'currency',
        ]));

        $eventTime = CheckoutNormalizer::timestamp(CheckoutNormalizer::firstPath($rawPayload, [
            'approved_date',
            'paid_at',
            'created_at',
            'data.created_at',
        ])) ?? time();

        $productId = CheckoutNormalizer::firstPath($rawPayload, [
            'Product.product_id',
            'Product.id',
            'product.id',
        ]);

        $productName = CheckoutNormalizer::firstPath($rawPayload, [
            'Product.product_name',
            'Product.name',
            'product.name',
        ]);

        $trackingSource = CheckoutNormalizer::get($rawPayload, 'TrackingParameters')
            ?? CheckoutNormalizer::get($rawPayload, 'tracking')
            ?? [];

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
                'utm' => CheckoutNormalizer::normalizeUtm(is_array($trackingSource) ? $trackingSource : []),
                'provider_ids' => CheckoutNormalizer::emptyProviderIds(),
                'checkout_session_id' => null,
                'captured_at' => null,
                'checkout_passthrough' => $passthrough['candidates'],
            ],

            'user' => [
                'customer_id' => CheckoutNormalizer::firstPath($rawPayload, [
                    'Customer.id',
                    'Customer.customer_id',
                    'customer.id',
                ]),
                'email' => CheckoutNormalizer::firstPath($rawPayload, [
                    'Customer.email',
                    'customer.email',
                ]),
                'phone' => CheckoutNormalizer::phone(CheckoutNormalizer::firstPath($rawPayload, [
                    'Customer.mobile',
                    'Customer.phone',
                    'customer.mobile',
                ])),
                'full_name' => $fullName,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'country' => CheckoutNormalizer::firstPath($rawPayload, [
                    'Customer.country',
                    'customer.country',
                ]),
                'locale' => null,
            ],

            'params' => [
                'transaction_id' => $transactionId,
                'value' => $value,
                'currency' => $currency,
                'status' => $status !== '' ? $status : 'PAID',
                'payment_type' => CheckoutNormalizer::firstPath($rawPayload, [
                    'payment_method',
                    'Charge.payment_method',
                    'data.payment_method',
                ]),
                'cpf' => CheckoutNormalizer::firstPath($rawPayload, ['Customer.cpf', 'customer.cpf']),
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

    private static function extractPropertyId(array $payload, array $passthrough): string
    {
        $direct = CheckoutNormalizer::firstPath($payload, [
            'nvs_property_id',
            'property_id',
            'TrackingParameters.nvs_property_id',
        ]);

        if ($direct !== null) {
            return CheckoutNormalizer::cleanKey($direct, 'default');
        }

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
