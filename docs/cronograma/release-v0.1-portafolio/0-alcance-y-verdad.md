# V0.1.00: Alcance y fuentes de verdad

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** Pendiente.

## Objetivo

Hacer que cronograma, README y alcance describan una sola entrega: código abierto demostrable con
fiscalidad simulada, separado de cualquier piloto o despliegue comercial.

## Tareas

- [ ] Actualizar el cronograma maestro para declarar `v0.1.0` como hito actual de publicación y
  Fase 12 como trabajo posterior al release.
- [ ] Corregir referencias desactualizadas de Fase 11: trece hallazgos cerrados y evidencia real
  de la última ejecución del pipeline.
- [ ] Actualizar el README raíz con fase, cantidad de pruebas, ADR, migraciones y demás métricas
  obtenidas del commit candidato; no copiar cifras históricas.
- [ ] Declarar que `v0.1.0` distribuye código fuente. El MSI sin firma no se adjunta al release.
- [ ] Revisar los textos visibles y la documentación fiscal para conservar `SIMULACION` y la
  ausencia de cualquier promesa legal o de compatibilidad de hardware.
- [ ] Cambiar el nombre visible del gate existente a «piloto en tienda» y enlazarlo como un nivel
  posterior que no bloquea esta publicación.

## Criterio de salida

Una persona nueva distingue sin inferencias el release open source, una futura distribución
binaria firmada y un piloto real. Ninguna fuente de verdad dice que Fase 8 o el hardware fiscal
bloqueen `v0.1.0`.

## Evidencia requerida

Diff documental acotado, enlaces locales válidos, `git diff --check` y revisión cruzada de
README, cronograma, ADR-0021 y alcance por nivel de entrega.
