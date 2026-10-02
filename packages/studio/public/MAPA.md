# public

- `index.html`: estrutura da aplicação.
- `app.js`: interações do painel (o editor abre em `editor.html`).
- `save-cycle.js`: esgotamento das alterações pendentes antes de sair.
- `styles.css`: aparência do painel.
- `vsl-player.js` e `vsl-ui.js`: runtime acessível do player público e tela de configuração de VSLs.
- `tracker.js`: tracker interno de primeira parte, sem cookie, sem PII e com allowlist de UTMs, click IDs e eventos estruturados. Mede também, por `data-alva-bloco`, entrada na tela, tempo à vista, cliques e rolagem (um lote por visita).
- `sinais-de-bloco-ui.js`: o relatório "Onde a página perde gente" na tela de Analytics, só com as listas que a tela já tem.

- `editor.html` + `../editor/*.jsx` (bundle em `build/editor.js`): editor de landing e quiz (Puck), no esquema do Alva.
- `page-schema.js`, `pagina-alva.js`, `puck-conversao.js`: o esquema `alva/1`, o documento publicado e a ponte com o Puck.
- `funil.html` + `../editor/funil.jsx` (bundle em `build/funil.js`), `funil.js`, `funis-etapas.js`, `funis-modelos.js`, `funis-view.js`: a aba Funis (canvas com React Flow, modelos e páginas por etapa).
- `owner.js` e `owner.css`: acesso do dono e configurações do aplicativo.
- `templates.js`, `catalogo-elementos.js` e `quiz-elements.js`: as folhas de estilo da página (`templateCss`, `formCss`, `runtimeCss`, `elementosCss`, `escolhaCss`), a fonte de ícones e os tipos que não pedem resposta (`TIPOS_SEM_RESPOSTA`, usado pela validação do servidor).
- `ui-preferences.js`: preferências locais de aparência e largura do menu.
- `leads-ui.js`: normalização de linhas, estados de carregamento/erro/vazio, rótulos de entrega e URL de exportação CSV por página e captura.
- `third-party-notices.txt`: fonte original versionada dos avisos de terceiros exibidos pelo Studio.
- `third-party-licenses.html`: apresentação documental derivada dos avisos legais, usando os tokens visuais existentes.
