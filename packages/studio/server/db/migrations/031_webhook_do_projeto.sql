-- Para onde vai a cópia de cada lead, definido UMA vez por projeto. Até aqui o destino só
-- existia por página (project_integrations, provider 'studio-page-settings'), e o dono
-- tinha de repeti-lo em cada landing e cada quiz.
--
-- Tabela própria, e não uma linha nova de project_integrations, por três razões: (1) lá
-- cada linha é por ambiente (preview/production), e o destino dos leads não muda conforme
-- o ambiente — o lead é sempre do projeto; (2) aqui o banco garante o que o código promete
-- (uma linha por projeto, só https, tamanho limitado), em vez de confiar num jsonb sem
-- forma; (3) a leitura no envio do lead é um acesso por chave primária, sem filtrar
-- provider e ambiente.
--
-- O webhook da PÁGINA continua valendo e sobrescreve este: quem decide é o envio do lead
-- (content-repository), que lê esta linha na hora do envio — assim, configurar o projeto
-- vale também para o que já está publicado, sem republicar.
CREATE TABLE project_lead_webhooks (
  project_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
