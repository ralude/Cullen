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

## Reglas

- El script debe ser reproducible en Windows y en el entorno de desarrollo documentado.
- Las pruebas de integracion usan SQLite real temporal y se ejecutan como parte de `pnpm test` (proyectos Vitest).
- El empaquetado Electron se habilita cuando exista el scaffold funcional de desktop.
- Un hook local pre-push puede ejecutar `pnpm pipeline`, pero no sustituye la ejecucion manual del pipeline.
- Si se agrega un remote, se podra trasladar el mismo orden a la plataforma elegida sin cambiar los comandos.
