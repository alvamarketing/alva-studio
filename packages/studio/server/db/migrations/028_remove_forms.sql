-- O formulário antigo sai do Studio. Landing e quiz moram em `pages` (esquema alva/1), a
-- captura em page_versions.capture_schema e as respostas em page_submissions. O dono
-- confirmou em 28/09 que nenhum formulário da tabela `forms` tinha dado real.

-- A fila de webhook atendia os dois produtos; fica só a entrega de página. As colunas do
-- formulário levam junto as chaves estrangeiras para forms e form_submissions.
DELETE FROM webhook_delivery_attempts
 WHERE delivery_id IN (SELECT id FROM webhook_deliveries WHERE source_kind = 'form');
DELETE FROM webhook_deliveries WHERE source_kind = 'form';
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_source_check;
ALTER TABLE webhook_deliveries DROP COLUMN form_id;
ALTER TABLE webhook_deliveries DROP COLUMN submission_id;
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_source_kind_check;
ALTER TABLE webhook_deliveries ALTER COLUMN source_kind SET DEFAULT 'page';
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_source_kind_check CHECK (source_kind = 'page');
ALTER TABLE webhook_deliveries ALTER COLUMN page_id SET NOT NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN page_submission_id SET NOT NULL;

-- A trava do tipo da rota consultava `forms`; sem a tabela, a função passaria a falhar na
-- primeira troca de tipo. Só páginas prendem rota agora.
CREATE OR REPLACE FUNCTION prevent_linked_route_type_change() RETURNS trigger AS $$
BEGIN
  IF NEW.content_type IS DISTINCT FROM OLD.content_type
    AND EXISTS (SELECT 1 FROM pages WHERE route_id = OLD.id) THEN
    RAISE EXCEPTION 'O tipo de uma rota vinculada não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TABLE form_submissions;
DROP TABLE forms, form_versions;

-- A rota de um formulário ocupava o caminho no projeto (o índice de caminho ativo é
-- único). Sem o formulário, ela bloquearia para sempre uma página no mesmo endereço.
DELETE FROM project_routes WHERE content_type = 'form';
ALTER TABLE project_routes DROP CONSTRAINT project_routes_content_type_check;
ALTER TABLE project_routes ADD CONSTRAINT project_routes_content_type_check CHECK (content_type = 'page');
