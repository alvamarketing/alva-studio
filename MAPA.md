# Alva Studio — mapa

- `AGENTS.md`: regra master de execução com subagentes e seleção dinâmica de modelo.

- `packages/studio/`: aplicação Alva Studio, editor e publicação.
- `docs/`: referências de projeto do Alva Studio.
  - `wireframes/`: protótipos navegáveis usados como referência visual.
  - `specs/`: decisões de arquitetura aprovadas.
  - `plans/`: planos executáveis derivados das especificações.
- `runtime/`: composição Docker/Coolify do Studio e runbooks operacionais, com bancos e motores internos isolados.
  - `nvs/vendor/nvs-core/`: submódulo do NVS Track Core; um clone comum o deixa vazio.
- `produto/`: especificação e sequência de desenvolvimento do Alva Studio.
- `.estado/`: registros curtos dos gates de validação das fundações do produto.

Documentos novos são originais; dependências e arquivos compilados são derivados.

`README.md` é uma referência por symlink relativo ao guia do Studio.

O repositório nasceu como fork do GrapesJS; o editor, o núcleo (`packages/core`), as ferramentas (`packages/cli`) e a documentação dele saíram em 28/09/2026, quando landing e quiz passaram para o editor novo (Puck). O `LICENSE` na raiz é o do GrapesJS e ficou até o dono decidir.
