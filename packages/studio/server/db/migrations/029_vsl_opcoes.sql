-- As opções do player vindas do que o VTurb faz e serve ao nosso objetivo (som inteligente,
-- cor e subtexto do CTA, pergunta ao retomar, pausa fora da aba, trava de avanço, tempo
-- oculto). Um objeto só: public/vsl-opcoes.js é quem valida e dá os padrões, e cada opção
-- nova não pede uma coluna nova. A versão publicada guarda a sua cópia, como o resto.
ALTER TABLE videos ADD COLUMN opcoes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE video_versions ADD COLUMN opcoes jsonb NOT NULL DEFAULT '{}'::jsonb;
