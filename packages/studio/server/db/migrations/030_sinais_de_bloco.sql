-- Sinais de bloco (etapa 7): onde a página perde gente.
--
-- Ficam fora de `analytics_events` de propósito: o lote de sinais não é um acontecimento da
-- jornada. Misturá-lo ali somaria "ações" no resumo e poluiria o mapa de resultados, que lê
-- todo evento nomeado. Cada tabela guarda só o que o tracker envia: o id do nó, contagens e
-- segundos — nunca texto, valor de campo ou posição.

-- Uma linha por bloco e por lote. O lote leva só o que mudou desde o anterior, então somar as
-- linhas nunca conta a mesma entrada duas vezes: entradas = SUM(entered).
CREATE TABLE analytics_block_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  website_id uuid NOT NULL,
  url_path text NOT NULL,
  block_id varchar(80) NOT NULL CHECK (block_id ~ '^[A-Za-z0-9_-]+$'),
  entered smallint NOT NULL CHECK (entered IN (0, 1)),
  seconds_visible integer NOT NULL CHECK (seconds_visible BETWEEN 0 AND 3600),
  clicks integer NOT NULL CHECK (clicks BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, website_id) REFERENCES analytics_websites(company_id, project_id, id)
);
CREATE INDEX analytics_block_signals_project ON analytics_block_signals (company_id, project_id, created_at DESC);

-- Uma linha por marco de rolagem cruzado numa visita. Cada marco é enviado uma vez só, então
-- quem chegou a 75% aparece em 25, 50 e 75 — contar linhas por marco dá "quantos chegaram lá".
CREATE TABLE analytics_scroll_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  website_id uuid NOT NULL,
  url_path text NOT NULL,
  mark smallint NOT NULL CHECK (mark IN (25, 50, 75, 100)),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, website_id) REFERENCES analytics_websites(company_id, project_id, id)
);
CREATE INDEX analytics_scroll_marks_project ON analytics_scroll_marks (company_id, project_id, created_at DESC);
