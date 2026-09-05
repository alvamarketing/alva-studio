# VSL no Alva Studio — corte comercial

Referência funcional: [guia de player VSL](https://vturb-guia.vercel.app/). A interface é inspiração; o prompt de dois HTMLs não é base de produção.

A VSL pertence a um projeto e reutiliza uma URL HTTPS de MP4 ou um serviço de streaming pronto. O Studio armazena nome, origem, poster, cores, autoplay mutado, retomada, CTA e marcos de medição. A configuração publicada é uma versão imutável; editar o rascunho não altera campanhas no ar.

O player público usa `/v/<publicId>` e o embed usa `/embed/v/<publicId>`. Configurações são carregadas pelo identificador público, sem tokens ou parâmetros sensíveis na URL. O bloco Vídeo dos editores escolhe uma VSL do projeto e snapshots rejeitam referência ausente, de outro projeto ou sem versão publicada.

O primeiro corte inclui autoplay mutado compatível com o navegador, progresso real, teclado, retomada no mesmo dispositivo, CTA temporizado e embed responsivo. Não promete impedir download nem força progresso enganoso. Eventos internos: início, 25%, 50%, 75%, conclusão e clique no CTA. O Analytics do projeto encaminha esses eventos depois, sem pixel paralelo dentro do player.

Upload, transcodificação e CDN próprios ficam fora deste corte. Entram apenas quando URLs ou streaming terceirizado se provarem insuficientes.
