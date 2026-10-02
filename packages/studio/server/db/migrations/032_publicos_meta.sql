-- Públicos personalizados de site que o Studio cria na conta de anúncios da Meta a partir dos
-- eventos do pixel. Duas tabelas, porque são duas coisas: a credencial (por projeto, cifrada)
-- e o que já foi criado a partir dela.
--
-- A credencial é um token com a permissão de gerenciar anúncios, que NÃO é o da Conversions
-- API (esse é atribuído ao pixel e não cria público). Fica cifrado com o mesmo cofre dos
-- destinos de rastreamento; o que sai do servidor é só o ID da conta, que não é segredo.
CREATE TABLE meta_audience_credentials (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  ad_account_id varchar(20) NOT NULL CHECK (ad_account_id ~ '^[0-9]{1,20}$'),
  encrypted_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, project_id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);

-- Um público por projeto e por chave do catálogo (server/meta-publicos.mjs). O id da Meta
-- fica guardado: é ele que impede criar o mesmo público duas vezes. `definition` guarda a
-- regra enviada (sem token), para saber depois o que existe na Meta sem perguntar a ela.
CREATE TABLE meta_audiences (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  audience_key varchar(40) NOT NULL CHECK (audience_key ~ '^[a-z0-9_]{1,40}$'),
  meta_audience_id varchar(40),
  status varchar(20) NOT NULL CHECK (status IN ('created', 'error')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, project_id, audience_key),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  CHECK ((status = 'created' AND meta_audience_id IS NOT NULL) OR status = 'error')
);
