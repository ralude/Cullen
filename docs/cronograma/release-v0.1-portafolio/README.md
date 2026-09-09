# Release v0.1 de portafolio

- **Estado:** En ejecución desde el 2026-09-09. V0.1.00 y V0.1.01 cerradas; V0.1.02 bloqueada
  por el recorrido interactivo; V0.1.03 adelantada en lo que no depende de las capturas; V0.1.04
  sin iniciar.
- **Tipo:** hito transversal de publicación, no una fase funcional nueva.
- **Distribución inicial:** código fuente mediante GitHub y tag `v0.1.0`; no se publica un MSI
  sin firma.
- **Decisión normativa:**
  [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md).
- **Índice:** [Cronograma maestro](../README.md).

## Objetivo

Publicar Cullen como proyecto open source de portafolio, instalable desde el código y demostrable
de punta a punta con `FiscalPrinterFake`, sin exigir impresoras fiscales, protocolo de fabricante,
registro de integrador ni laboratorio HIL.

`SIMULACION` es una capacidad explícita del alcance, no un sustituto silencioso de cumplimiento
fiscal. Fase 8 y el [gate de piloto en tienda](../gate-piloto-release.md) permanecen abiertos y
siguen siendo obligatorios antes de operar en un comercio real.

## Etapas obligatorias

1. ~~[V0.1.00 — Alcance y fuentes de verdad](./0-alcance-y-verdad.md)~~ — cerrada el 2026-09-09.
2. ~~[V0.1.01 — CI reproducible](./1-ci-reproducible.md)~~ — cerrada el 2026-09-09 con su primer run remoto verde.
3. [V0.1.02 — Demo en entorno limpio](./2-demo-en-entorno-limpio.md) — tramo automatizable verificado; el recorrido interactivo sigue el [guion](./guion-demo-entorno-limpio.md).
4. [V0.1.03 — Documentación de portafolio](./3-documentacion-portafolio.md) — entregada salvo las capturas; sus [notas de versión](./notas-v0.1.0.md) están en borrador.
5. [V0.1.04 — Publicación](./4-publicacion.md).

No se inicia una etapa mientras la anterior conserve tareas abiertas. Un documento de
planificación no marca trabajo como completado; cada cierre exige su evidencia.

## Gate de salida de v0.1.0

- CI remoto verde en el commit etiquetado: instalación congelada, lint, typecheck, pruebas y
  compilación de artefactos.
- Demo reproducida desde un clon limpio sobre Windows, sin hardware fiscal y con `SIMULACION`
  visible durante todo el recorrido.
- README, métricas, estado de fases, limitaciones y comandos coinciden con el tag.
- Licencia y pautas mínimas de contribución y reporte de seguridad están publicadas.
- Release notes y tag `v0.1.0` apuntan al mismo commit verificable.
- Ningún texto o artefacto afirma certificación fiscal, compatibilidad con una impresora real,
  aptitud para producción o cierre del gate de piloto.

## Fuera de alcance

- Publicar instaladores o ejecutables sin firma.
- Integrar o calificar hardware fiscal real.
- Validar una tienda, DCTD, PKI corporativa o regulación aplicable.
- Terminar Fase 12: sus mediciones y refactors comienzan después de `v0.1.0` y preparan una
  versión posterior.
- Ejecutar las Fases 13–17.

## Secuencia posterior

Después de publicar `v0.1.0`, el trabajo funcional retoma
[Fase 12](../fase-12-optimizacion/README.md): 12.01–12.03 y 12.05 con medición antes/después;
12.04 sigue suspendida hasta que Fase 8 entregue una integración real. Fase 13 no comienza hasta
cerrar la entrada técnica que el cronograma exige.
