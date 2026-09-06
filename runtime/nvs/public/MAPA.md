# Gateway público do NVS

- `index.php`: ponto de entrada do gateway; expõe somente as rotas internas autenticadas e as superfícies públicas preservadas do Core.
- `router.php`: roteia saúde, APIs internas e caminhos públicos autorizados.
- `health/`: endpoints internos de vida e prontidão do Core com MariaDB e schema aplicados.
- `lib/`: wrapper público seguro, sem telemetria bruta do script vendorado.
