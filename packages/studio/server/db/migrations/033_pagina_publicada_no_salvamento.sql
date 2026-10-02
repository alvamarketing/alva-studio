-- Em qual salvamento a página foi publicada. Com isso o Studio sabe dizer "existem alterações
-- que ainda não foram publicadas": o HTML que está no ar é o que foi gerado quando a página
-- foi salva e publicada, então salvar de novo não muda nada para quem visita até publicar.
-- É o mesmo desenho que os vídeos já têm (videos.published_lock_version).
ALTER TABLE pages ADD COLUMN published_lock_version integer;

-- As páginas que já estão no ar começam em dia: não há como saber, depois do fato, se o que
-- está salvo difere do que subiu, e acender o aviso em todas de uma vez seria ruído.
UPDATE pages SET published_lock_version = lock_version WHERE published_version_id IS NOT NULL;
