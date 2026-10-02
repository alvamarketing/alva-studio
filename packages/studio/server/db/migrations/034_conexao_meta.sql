-- Conectar com o Facebook (docs/specs/2026-10-02-conectar-com-facebook.md).
--
-- A conexão é da empresa (D1): uma pessoa autoriza e vale para todos os projetos. Por ora
-- uma por empresa — garantido por índice, não pela chave, para afrouxar depois sem trocar
-- o `id` que outras tabelas já apontam.
CREATE TABLE meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  meta_user_id varchar(40) NOT NULL CHECK (meta_user_id ~ '^[0-9]{1,40}$'),
  meta_user_name varchar(200) NOT NULL DEFAULT '',
  token_type varchar(20) NOT NULL CHECK (token_type IN ('user', 'system_user')),
  -- AES-256-GCM no mesmo cofre dos destinos, com escopo meta-connection:{empresa}:{usuário}.
  encrypted_token text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  client_business_id varchar(40) CHECK (client_business_id IS NULL OR client_business_id ~ '^[0-9]{1,40}$'),
  token_expires_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reconnect')),
  status_reason varchar(200),
  connected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX meta_connections_uma_por_empresa ON meta_connections (company_id);
CREATE INDEX meta_connections_por_usuario_da_meta ON meta_connections (meta_user_id);

-- O `state` de cada clique em "Conectar". A linha existe para o state valer uma vez só:
-- a conclusão o consome com um UPDATE condicional antes de falar com a Meta. Guarda o
-- hash do nonce e o da sessão, nunca os valores; e o redirect exato, que a troca do código
-- precisa repetir.
CREATE TABLE meta_oauth_states (
  nonce_hash char(64) PRIMARY KEY CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash char(64) NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  redirect_uri varchar(500) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id) ON DELETE CASCADE
);
CREATE INDEX meta_oauth_states_vencimento ON meta_oauth_states (expires_at);

-- Pedidos de exclusão de dados que a Meta encaminha (callback assinado, F3). A Meta só
-- identifica a pessoa pelo id do app; o código de confirmação é o que ela consulta depois.
CREATE TABLE meta_data_deletion_requests (
  confirmation_code varchar(64) PRIMARY KEY CHECK (confirmation_code ~ '^[A-Za-z0-9_-]{16,64}$'),
  meta_user_id varchar(40) NOT NULL CHECK (meta_user_id ~ '^[0-9]{1,40}$'),
  status varchar(20) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'completed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

-- A credencial dos públicos passa a ter origem (D2): `manual` é o token colado de hoje;
-- `connection` usa o token da conexão da empresa e não guarda token próprio. Nunca as duas.
-- Apagar a conexão não apaga a escolha do projeto (D10): o vínculo vira nulo e a conta de
-- anúncios escolhida continua, à espera de reconectar.
ALTER TABLE meta_audience_credentials
  ADD COLUMN source varchar(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'connection')),
  ADD COLUMN connection_id uuid,
  ALTER COLUMN encrypted_token DROP NOT NULL,
  ADD CONSTRAINT meta_audience_credentials_conexao_da_empresa
    FOREIGN KEY (company_id, connection_id) REFERENCES meta_connections (company_id, id) ON DELETE SET NULL (connection_id),
  ADD CONSTRAINT meta_audience_credentials_uma_origem CHECK (
    (source = 'manual' AND encrypted_token IS NOT NULL AND connection_id IS NULL)
    OR (source = 'connection' AND encrypted_token IS NULL)
  );
