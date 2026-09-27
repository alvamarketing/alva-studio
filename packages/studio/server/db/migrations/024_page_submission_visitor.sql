-- Quem enviou a captura, em forma que não identifica ninguém: um hash do cookie de
-- consentimento da pessoa ou, sem ele, do IP e do navegador. Serve a uma pergunta só —
-- "este envio é a mesma pessoa mandando de novo o mesmo formulário?" —, que é o que
-- acontece quando ela recarrega a página de obrigado e o navegador reenvia o POST.
-- Sem a resposta, cada recarga virava um lead a mais no servidor e na plataforma.
ALTER TABLE page_submissions ADD COLUMN visitor_key text;
CREATE INDEX page_submissions_repeat ON page_submissions (capture_id, visitor_key, submitted_at DESC)
  WHERE visitor_key IS NOT NULL;
