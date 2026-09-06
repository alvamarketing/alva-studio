# NVS Track Core vendorado

- **Origem canônica:** `/Users/taiancarvalho/Documents/Vibing/Projetos/nvstrack/core`
- **Produto:** `nvs-track-core`
- **Versão:** `0.3.10`
- **Versão de contrato:** `1`
- **Commit imutável de origem:** `dd8a6fdf5f3d65d26d381f5a002d2ed8ac13b7f7`
- **Snapshot:** cópia literal, sem patches no diretório `nvs-core/`.

O snapshot exclui `.env`, `storage/logs/`, `storage/ratelimit/`,
`storage/backups/`, `backups/`, `tmp/` e `temporary_files/`. O
metadado gerado `NVS_CORE_MANIFEST.json` permanece no snapshot, mas é excluído
do hash para que a autoridade de conteúdo reflita somente a exportação do Core.
Esses caminhos podem conter credenciais, dados de execução, backups ou artefatos transitórios.

O clone de origem tinha alterações locais; por isso o hash reproduzível do
snapshot é a autoridade para o conteúdo efetivamente exportado, depois das
exclusões acima. Seu valor é
`911681d021c5c0b9126abeb3eea64decae8b4603eabb80801787f914c5669308`.
Para verificá-lo na origem ou neste snapshot, execute a partir da raiz
correspondente:

```sh
find . -type f -not -path './NVS_CORE_MANIFEST.json' -not -path './.env' -not -path './storage/logs/*' -not -path './storage/ratelimit/*' -not -path './storage/backups/*' -not -path './backups/*' -not -path './tmp/*' -not -path './temporary_files/*' -print | LC_ALL=C sort | while IFS= read -r file; do shasum -a 256 "$file"; done | shasum -a 256
```

As alterações Alva vivem somente em `../alva/`; a imagem monta o gateway em
`../public/`. A reprodução do runtime aplica as migrações forward-only de
`../alva/bin/migrate.php`, sem modificar o vendor.
