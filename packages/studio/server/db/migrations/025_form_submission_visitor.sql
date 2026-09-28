-- A mesma chave pseudônima de quem enviou que a 024 deu às capturas de página, agora
-- no formulário publicado: o mesmo envio repetido pela mesma pessoa é o mesmo lead.
ALTER TABLE form_submissions ADD COLUMN visitor_key text;
CREATE INDEX form_submissions_repeat ON form_submissions (form_id, visitor_key, submitted_at DESC)
  WHERE visitor_key IS NOT NULL;
