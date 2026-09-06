<?php

declare(strict_types=1);

return [
    '20260906_01_core_safe_boundary' => [
        'statements' => [
            'CREATE TABLE IF NOT EXISTS nvs_schema_migrations (version VARCHAR(100) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            'CREATE TABLE IF NOT EXISTS nvs_properties (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, property_id VARCHAR(100) NOT NULL, name VARCHAR(190) NOT NULL, cookie_prefix VARCHAR(100) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_property_id (property_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            'CREATE TABLE IF NOT EXISTS nvs_events (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, property_id VARCHAR(100) NOT NULL, event_id VARCHAR(190) NOT NULL, event_name VARCHAR(120) NOT NULL, source VARCHAR(40) NOT NULL, event_time BIGINT NOT NULL, event_json LONGTEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_property_event (property_id, event_id), KEY idx_property_event (property_id, event_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            'CREATE TABLE IF NOT EXISTS nvs_internal_nonces (nonce_hash CHAR(64) NOT NULL PRIMARY KEY, expires_at DATETIME NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_expires_at (expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            'CREATE TABLE IF NOT EXISTS nvs_property_secrets (property_id VARCHAR(100) NOT NULL, destination VARCHAR(40) NOT NULL, secret_ciphertext LONGTEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (property_id, destination)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            'CREATE TABLE IF NOT EXISTS nvs_outbox (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, property_id VARCHAR(100) NOT NULL, tracking_event_id VARCHAR(190) NOT NULL, destination VARCHAR(40) NOT NULL, payload_json LONGTEXT NOT NULL, state VARCHAR(20) NOT NULL DEFAULT "queued", attempts INT UNSIGNED NOT NULL DEFAULT 0, available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, last_error VARCHAR(80) NULL, delivered_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_outbox_delivery (property_id, tracking_event_id, destination), KEY idx_outbox_ready (state, available_at), KEY idx_outbox_property (property_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        ],
    ],
];
