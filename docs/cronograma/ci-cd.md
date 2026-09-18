# CI/CD Local

Mientras el repositorio no tenga una plataforma remota, la verificacion obligatoria se ejecuta mediante `pnpm pipeline`.

## Orden del pipeline

1. Lint (`pnpm lint`).
2. Typecheck (`pnpm typecheck`).
3. Tests (`pnpm test`, unit e integration juntas).

## Artefactos de distribución

`pnpm build:artifacts` compila el bundle del servidor (`apps/server/dist`, esbuild) y el
renderer/main de Electron (`apps/desktop/out`). El MSI de la estación se construye en un host
Windows con WiX Toolset a partir de esos artefactos; el procedimiento y la definición viven en
[`packaging/`](../../packaging/README.md) y en
[ADR-0030](../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md). El arranque del bundle
compilado —`/app`, `/api/v1`, cookie y recuperación tras reinicio— se verifica en
`apps/server/src/packaged-node-boot.integration.test.ts`, que corre dentro de `pnpm test`.

Etapas pendientes (requieren configuracion especifica que no corresponde a la Fase 1):

- Coverage (necesita `@vitest/coverage-v8` + umbrales).
- Firma de los ejecutables del MSI (certificado, cadena y sellado de tiempo); abierta en el
  [gate de piloto](./gate-piloto-release.md).
- Ejecución del `wix build` en CI sobre un runner Windows.

Cada etapa debe detener el pipeline si falla. No se considera terminado un cambio que no pase el pipeline completo.

## Lo que el pipeline remoto no cubre

Los tres escenarios del arnés de 12.01 que conducen la terminal real —`login-and-shell` dos veces
y `sale-from-shell`— se omiten cuando `CI` está definida, y `pnpm test` los corre completos en la
estación. Son la única exclusión del pipeline y tiene dos razones independientes.

La primera es que ahí no pueden correr: lanzan el binario de Electron, que `pnpm install` ya no
trae —Electron 44 dejó de declarar `postinstall`— y que `apps/desktop` instala antes de `dev` y
`start`, fuera de `build`, para no cargarle al pipeline una descarga de 100 MB. En un runner el
binario no existe y la serie aborta con `PERF_DESKTOP_START_FAILED`. Eso dejó el pipeline en rojo
desde el primer push posterior a esos escenarios, el 2026-09-17, hasta que se declaró la
exclusión: los runs del 2026-09-10 fueron los últimos verdes.

La segunda es que ahí no valdrían: el manifiesto de 12.01 exige medir sobre una estación aislada
y el arnés aborta con `PERF_STATION_BUSY` cuando no lo está. Un runner compartido no lo está
nunca. Vitest publica los tres casos como omitidos en cada corrida remota, de modo que la
exclusión se ve en el reporte y no se confunde con cobertura.

## Reglas

- El script debe ser reproducible en Windows y en el entorno de desarrollo documentado.
- Las pruebas de integracion usan SQLite real temporal y se ejecutan como parte de `pnpm test` (proyectos Vitest).
- El empaquetado Electron se habilita cuando exista el scaffold funcional de desktop.
- Un hook local pre-push puede ejecutar `pnpm pipeline`, pero no sustituye la ejecucion manual del pipeline.
- Si se agrega un remote, se podra trasladar el mismo orden a la plataforma elegida sin cambiar los comandos.
