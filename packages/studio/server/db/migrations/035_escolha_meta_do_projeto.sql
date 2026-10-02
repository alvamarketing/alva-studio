-- Conectar com o Facebook, F2 (docs/specs/2026-10-02-conectar-com-facebook.md).
--
-- A conexão é da empresa; a escolha de conta de anúncios e pixel é do projeto (D1). A linha
-- guarda o que foi escolhido e o nome que a Meta mostrava na hora, para a tela dizer "conta
-- X, pixel Y" sem perguntar à Meta a cada abertura. Nunca guarda token: o envio usa o da
-- conexão da empresa, decifrado na hora.
--
-- Desconectar NÃO apaga a escolha (D6, D10): o vínculo com a conexão vira nulo e a escolha
-- fica como histórico — reconectar volta a usá-la sem escolher de novo. Projeto apagado leva
-- a escolha junto.
CREATE TABLE meta_project_selections (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  connection_id uuid,
  ad_account_id varchar(20) NOT NULL CHECK (ad_account_id ~ '^[0-9]{1,20}$'),
  ad_account_name varchar(200) NOT NULL DEFAULT '',
  pixel_id varchar(20) NOT NULL CHECK (pixel_id ~ '^[0-9]{1,20}$'),
  pixel_name varchar(200) NOT NULL DEFAULT '',
  -- true quando o Studio escolheu sozinho (só havia uma conta e um pixel).
  automatic boolean NOT NULL DEFAULT false,
  selected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, project_id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id) ON DELETE CASCADE,
  CONSTRAINT meta_project_selections_conexao_da_empresa
    FOREIGN KEY (company_id, connection_id) REFERENCES meta_connections (company_id, id) ON DELETE SET NULL (connection_id)
);
