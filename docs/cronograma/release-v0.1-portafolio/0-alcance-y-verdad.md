# V0.1.00: Alcance y fuentes de verdad

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** ~~Completada el 2026-09-09~~.

## Objetivo

Hacer que cronograma, README y alcance describan una sola entrega: código abierto demostrable con
fiscalidad simulada, separado de cualquier piloto o despliegue comercial.

## Tareas

- [x] Actualizar el cronograma maestro para declarar `v0.1.0` como hito actual de publicación y
  Fase 12 como trabajo posterior al release.
- [x] Corregir referencias desactualizadas de Fase 11: trece hallazgos cerrados y evidencia real
  de la última ejecución del pipeline.
- [x] Actualizar el README raíz con fase, cantidad de pruebas, ADR, migraciones y demás métricas
  obtenidas del commit candidato; no copiar cifras históricas.
- [x] Declarar que `v0.1.0` distribuye código fuente. El MSI sin firma no se adjunta al release.
- [x] Revisar los textos visibles y la documentación fiscal para conservar `SIMULACION` y la
  ausencia de cualquier promesa legal o de compatibilidad de hardware.
- [x] Cambiar el nombre visible del gate existente a «piloto en tienda» y enlazarlo como un nivel
  posterior que no bloquea esta publicación.

## Criterio de salida

Una persona nueva distingue sin inferencias el release open source, una futura distribución
binaria firmada y un piloto real. Ninguna fuente de verdad dice que Fase 8 o el hardware fiscal
bloqueen `v0.1.0`.

## Evidencia

- [`gate-piloto-release.md`](../gate-piloto-release.md) se titula «Gate de piloto en tienda» y
  declara en su encabezado que **no bloquea** `v0.1.0`.
- [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md), punto 3, separa la
  evidencia de fabricante y hardware —que bloquea Fase 8 y los gates de piloto/producción— del
  release de portafolio, que distribuye código fuente y demuestra con `FiscalPrinterFake`.
- El [cronograma maestro](../README.md) declara `v0.1.0` como hito actual, Fase 12 y Fase 12B
  como trabajo posterior al release, y Fase 11 con sus trece hallazgos cerrados.
- El README raíz publica las métricas del commit candidato: 1.212 pruebas en 191 archivos,
  30 ADR y 44 migraciones forward-only; ninguna cifra histórica queda presentada como vigente.
- Verificación local del 2026-09-09 sobre el árbol de trabajo: `pnpm lint`, `pnpm typecheck`,
  `pnpm test` (1.212 pruebas en 191 archivos, verdes, incluidas las tres de
  `generate-lan-material.test.ts` con OpenSSL 3.5.7 en el `PATH`) y `pnpm build:artifacts`.
- `git diff --check` limpio y verificación de enlaces locales sobre los archivos Markdown
  versionados: ninguno roto dentro de `docs/`, `README.md` ni `packaging/`. El único enlace
  irresoluble pertenece a `.agents/skills/caveman/README.md`, material de terceros ajeno al
  alcance del release.

## Nota sobre la ejecución previa

El cronograma registraba dos pruebas que no completaban la emisión TLS «porque el host no tiene
OpenSSL». El diagnóstico real es más acotado: `generate-lan-material.ts` invoca el `openssl` del
sistema, y el intérprete que lanzó aquella ejecución no lo tenía en su `PATH`. Con OpenSSL
alcanzable, el archivo ejecuta sus tres pruebas y la suite queda completa. Fijar esa dependencia
en un runner limpio, y no en la máquina del autor, sigue perteneciendo a
[V0.1.01](./1-ci-reproducible.md).
