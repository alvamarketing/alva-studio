# NVS Track Core

- **Repositório:** https://github.com/alvamarketing/nvs-track-core (privado)
- **Forma:** submódulo Git em `nvs-core/`
- **Produto:** `nvs-track-core` — versão `0.3.10`, contrato `1`

O Core era um snapshot copiado para dentro deste repositório. Virou submódulo
para que atualizar a dependência seja um commit visível, e não uma cópia nova
cujo conteúdo ninguém consegue comparar com a origem.

## De onde veio

O histórico foi extraído de `taiancarvalho/nvstrack`, onde o Core vivia na
subpasta `core/` de um projeto maior. O `git subtree split` preservou os cinco
commits que tocam essa pasta, do estado herdado do handoff (04/08/2026) até o
`da109f4`, que é a versão 0.3.10.

O conteúdo de `da109f4` é idêntico ao snapshot que estava vendorizado aqui:
ambos somam o hash `911681d021c5c0b9126abeb3eea64decae8b4603eabb80801787f914c5669308`
pelo comando abaixo. Depois dele há um único commit novo, que acrescenta o
`.gitignore` com as exclusões de credenciais e estado de execução — regras que
antes vinham do `.gitignore` deste repositório e precisavam morar no Core.

## Como conferir o conteúdo

Rodando a partir de `nvs-core/`, o hash reproduzível ignora o manifesto gerado,
o `.env` e os diretórios de estado — caminhos que podem conter credenciais,
dados de execução, backups ou artefatos transitórios:

```sh
find . -type f -not -path './NVS_CORE_MANIFEST.json' -not -path './.env' -not -path './storage/logs/*' -not -path './storage/ratelimit/*' -not -path './storage/backups/*' -not -path './backups/*' -not -path './tmp/*' -not -path './temporary_files/*' -not -path './.git*' -not -path './.gitignore' -print | LC_ALL=C sort | while IFS= read -r file; do shasum -a 256 "$file"; done | shasum -a 256
```

## Ao clonar

O submódulo é privado e não vem junto num clone comum. Sem ele o diretório
fica vazio e a imagem do runtime sobe sem o Core:

```sh
git submodule update --init runtime/nvs/vendor/nvs-core
```

As alterações Alva vivem somente em `../alva/`; a imagem monta o gateway em
`../public/`. A reprodução do runtime aplica as migrações forward-only de
`../alva/bin/migrate.php`, sem modificar o Core.
