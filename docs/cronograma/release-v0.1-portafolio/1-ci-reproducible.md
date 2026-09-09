# V0.1.01: CI reproducible

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** Entregada el 2026-09-09; pendiente la primera ejecución remota verde.
- **Entrada:** ~~V0.1.00 cerrada~~.

## Objetivo

Hacer que un runner remoto reproduzca la validación del repositorio sin depender de la máquina
del autor ni de equipos fiscales.

## Tareas

- [x] Crear un workflow de GitHub Actions para `windows-latest`, plataforma objetivo del desktop.
- [x] Fijar Node.js 24 y pnpm 11, usar `pnpm install --frozen-lockfile` y conservar el store solo
  como caché, nunca como fuente de dependencias no declaradas.
- [x] Instalar o localizar OpenSSL en el runner y demostrar que
  `generate-lan-material.test.ts` ejecuta sus tres pruebas; no omitirlas por entorno.
- [x] Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build:artifacts` en cada pull
  request y cambio de `main`.
- [x] Publicar el resultado y los logs del workflow como checks de GitHub. No fijar un umbral de
  coverage arbitrario sin medir primero la línea base.
- [x] Documentar localmente las versiones necesarias para reproducir el mismo pipeline.
- [ ] Registrar aquí el enlace de la primera ejecución remota verde sobre `main`. El workflow
  se subió a `main` el 2026-09-09 y quedó disparado; falta confirmar su resultado y anotarlo.

## Criterio de salida

Un commit nuevo no puede presentarse como candidato `v0.1.0` si cualquiera de los cuatro checks
falla. Las pruebas de material LAN pasan con OpenSSL de software; no requieren impresoras ni una
red física.

## Lo entregado

[`.github/workflows/pipeline.yml`](../../../.github/workflows/pipeline.yml) corre sobre
`windows-latest` en cada `pull_request` contra `main`, cada `push` a `main` y a demanda con
`workflow_dispatch`. Cada etapa es un paso propio, de modo que el check de GitHub identifica cuál
falló sin leer el log completo:

1. `pnpm install --frozen-lockfile`, con el store de pnpm restaurado por el hash de
   `pnpm-lock.yaml` **solo como caché**: la instalación congelada impide que un store restaurado
   introduzca una dependencia que el lockfile no declare.
2. `pnpm lint`.
3. `pnpm typecheck`.
4. `pnpm exec vitest run apps/server/src/generate-lan-material.test.ts`, en un paso separado y
   previo a la suite, para que el log muestre las tres pruebas de emisión TLS como evidencia
   explícita.
5. `pnpm test`.
6. `pnpm build:artifacts`.

El paso «Asegurar OpenSSL en el PATH» localiza `openssl` —el de Git for Windows si no está ya
alcanzable—, imprime su versión y **falla la ejecución** si no aparece. Ninguna prueba se omite
por entorno: si el runner no puede emitir material TLS, el pipeline se detiene ahí.

Las versiones necesarias para reproducirlo quedaron en
[`docs/operacion/pipeline-de-verificacion.md`](../../operacion/pipeline-de-verificacion.md):
Node.js 24.18.0, pnpm 11.17.0, Windows y OpenSSL 3.x alcanzable en el `PATH`.

## Coverage

El pipeline no fija umbral. Elegir un número antes de medir la línea base produce una cifra que se
ajusta al resultado en vez de gobernarlo. Medirla y acordar el umbral sigue siendo tarea del
[gate de piloto en tienda](../gate-piloto-release.md), que ya la enumera.

## Verificación local previa al primer runner

Sobre el commit candidato, con OpenSSL 3.5.7 en el `PATH`: `pnpm lint`, `pnpm typecheck`,
`pnpm test` (1.212 pruebas en 191 archivos, verdes; las tres de `generate-lan-material.test.ts`
incluidas) y `pnpm build:artifacts`, todos aprobados. Esa ejecución local **no sustituye** al
check remoto: la etapa conserva abierta su última casilla hasta que exista un run verde en
GitHub Actions sobre `main`.

## Fuera de alcance

Construir el MSI con WiX, firmarlo o publicarlo. Esas tareas pertenecen a distribución binaria y
al gate de piloto; el release inicial publica el código fuente.
