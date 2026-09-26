-- O nome NVS sai do banco. Era o produto de terceiro que entregava as conversões; o
-- Studio passou a entregá-las sozinho, e o que a tabela guarda são conversões a caminho
-- dos destinos de anúncio — não um detalhe de quem entrega.
--
-- Renomear preserva a tabela, os índices e o histórico; recriar jogaria tudo fora. Renomear
-- a tabela, porém, não renomeia índices nem constraints: sem as linhas abaixo o nome antigo
-- continuaria aparecendo em toda mensagem de erro do banco.
ALTER TABLE nvs_commercial_outbox RENAME TO conversions_outbox;
ALTER INDEX nvs_commercial_outbox_due RENAME TO conversions_outbox_due;
ALTER INDEX nvs_commercial_outbox_project RENAME TO conversions_outbox_project;
ALTER INDEX nvs_commercial_outbox_pkey RENAME TO conversions_outbox_pkey;
ALTER INDEX nvs_commercial_outbox_company_id_project_id_property_id_tra_key RENAME TO conversions_outbox_identity_key;
-- O resto pende da tabela com o nome antigo no próprio nome: checks, chave estrangeira e,
-- no Postgres 17, também os NOT NULL. Em laço porque a lista depende da versão do servidor,
-- e um ALTER escrito à mão para cada um falharia onde a constraint não existe.
DO $$
DECLARE atual text;
BEGIN
  FOR atual IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'conversions_outbox'::regclass AND conname LIKE 'nvs\_commercial\_outbox%'
  LOOP
    EXECUTE format('ALTER TABLE conversions_outbox RENAME CONSTRAINT %I TO %I', atual,
                   'conversions_outbox' || substr(atual, length('nvs_commercial_outbox') + 1));
  END LOOP;
END $$;

-- `destination` dizia quem levava o evento, e a resposta era sempre a mesma: o gateway.
-- Agora ela diz para onde o evento vai — a plataforma de anúncio — e existe uma linha por
-- destino, para que Meta falhando não faça o TikTok receber de novo.
--
-- As linhas endereçadas ao gateway não têm mais destino que exista: o serviço que as
-- consumia foi removido. Elas são trabalho de uma fila, não registro de negócio (o evento
-- em si vive nas tabelas de analytics), então saem daqui em vez de bloquearem a restrição.
DELETE FROM conversions_outbox WHERE destination = 'nvs';
ALTER TABLE conversions_outbox DROP CONSTRAINT conversions_outbox_destination_check;
ALTER TABLE conversions_outbox ALTER COLUMN destination DROP DEFAULT;
ALTER TABLE conversions_outbox ADD CONSTRAINT conversions_outbox_destination_check
  CHECK (destination IN ('meta', 'tiktok', 'google', 'linkedin', 'taboola'));

-- O motor de rastreamento deixou de ser uma escolha entre produtos externos. Sobrou um:
-- o envio de conversões do próprio Studio.
ALTER TABLE tracking_bindings DROP CONSTRAINT tracking_bindings_engine_check;
UPDATE tracking_bindings SET engine = 'conversions' WHERE engine = 'nvs';

-- Bindings do Umami não têm mais para onde apontar: o analytics passou a ser nativo e
-- não depende de provisionar nada. Sair daqui evita que o provisionamento tente
-- prepará-los para sempre, e que a publicação os exija como motor obrigatório.
DELETE FROM tracking_provision_jobs WHERE binding_id IN (SELECT id FROM tracking_bindings WHERE engine = 'umami');
DELETE FROM tracking_destinations WHERE binding_id IN (SELECT id FROM tracking_bindings WHERE engine = 'umami');
DELETE FROM tracking_bindings WHERE engine = 'umami';
ALTER TABLE tracking_bindings ADD CONSTRAINT tracking_bindings_engine_check CHECK (engine IN ('conversions'));

-- A referência remota é cifrada com o escopo do binding como dado autenticado, e o escopo
-- cita o motor. Renomear o motor sem mexer no ciphertext deixaria um segredo que ninguém
-- consegue abrir — e o erro apareceria só na primeira conversão, como "falha ao ler".
-- Provisionar agora é local e sem custo: zerar a referência e voltar ao início do
-- provisionamento sela o segredo de novo, com o escopo certo.
UPDATE tracking_bindings
   SET encrypted_remote_reference = NULL, status = 'pending', provision_attempt_count = 0,
       last_error = NULL, updated_at = now()
 WHERE engine = 'conversions';
UPDATE tracking_provision_jobs job
   SET status = 'queued', next_attempt_at = now(), attempt_count = 0, last_error = NULL,
       claim_token = NULL, lease_expires_at = NULL, updated_at = now()
 WHERE EXISTS (SELECT 1 FROM tracking_bindings binding WHERE binding.id = job.binding_id);

-- A função que prepara um projeto novo ainda criava um binding para cada produto externo.
-- Sem trocá-la aqui, todo projeto criado a partir de agora nasceria pedindo motores que
-- não existem mais, e o provisionamento tentaria prepará-los para sempre.
CREATE OR REPLACE FUNCTION enqueue_tracking_provisioning_for_project(project_company_id uuid, target_project_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tracking_bindings (company_id, project_id, environment, engine)
  SELECT project_company_id, target_project_id, environment, engine
    FROM (VALUES ('preview'::varchar, 'conversions'::varchar), ('production', 'conversions')) AS required(environment, engine)
  ON CONFLICT (company_id, project_id, environment, engine) DO NOTHING;

  INSERT INTO tracking_provision_jobs (company_id, project_id, binding_id)
  SELECT binding.company_id, binding.project_id, binding.id
    FROM tracking_bindings binding
   WHERE binding.company_id = project_company_id AND binding.project_id = target_project_id
  ON CONFLICT (binding_id) DO NOTHING;
END;
$$;
