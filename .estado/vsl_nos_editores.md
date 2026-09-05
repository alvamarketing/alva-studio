---
no: vsl_nos_editores
status: feito
---

# VSL nos editores

Concluído em 2026-09-05.

- Landing pages e formulários reutilizam VSLs publicadas por `publicId`, sem copiar configuração sensível ou estado interno do player.
- Os dois editores oferecem catálogo, seleção acessível, remoção e prévia pelo embed público da VSL.
- A publicação resolve a versão publicada dentro da mesma empresa e projeto e falha de forma acionável quando a referência está ausente, divergente ou sem versão publicada.
- O CTA permanece encapsulado no player público incorporado, usando a configuração imutável da versão publicada.
- Verificação focada: 51 testes aprovados e 0 falhas em editores, formulário, snapshot de publicação e player público.
- Nenhuma conta externa ou ambiente de produção foi alterado.
