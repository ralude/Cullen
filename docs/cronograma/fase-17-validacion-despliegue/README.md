# Fase 17: Validación integral y despliegue gradual

- **Estado:** Planificada y aprobada como alcance post-MVP; ejecución pendiente.
- **Aprobación:** 2026-09-06.
- **Índice:** [Cronograma maestro](../README.md).
- **Plan transversal:** [Evolución post-MVP](../evolucion-post-mvp.md).
- **Entrada:** Fase 16B cerrada; gates de piloto/producción aplicables antes de activar operación real.

## Propósito

Ensayar el sistema completo y habilitar su despliegue progresivo con evidencia y procedimientos de recuperación.

## Sub-fases

- [17.01 Objetivos y matriz de validación](./17.01-objetivos-y-matriz.md) — pendiente.
- [17.02 Ensayos integrales de operación y recuperación](./17.02-ensayos-integrales.md) — pendiente.
- [17.03 Despliegue gradual y operación](./17.03-despliegue-y-operacion.md) — pendiente.

## Disciplina de ejecución

Las sub-fases se ejecutan en el orden listado. Cada implementación parte de criterios
aprobados y pruebas observables según [ADR-0007](../../architecture/adr/0007-outside-in-tdd.md).
La planificación no declara tareas implementadas. Al cerrar cada sub-fase se registran
evidencias y se ejecutan `pnpm test` y `pnpm typecheck`, además de las pruebas específicas.

Las decisiones de datos y autoridad siguen
[ADR-0024](../../architecture/adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md).

## Criterio de salida

Los objetivos acordados se cumplen y el despliegue puede ampliarse con control y recuperación probada.

## Fuera de alcance

Adelantar certificación fiscal, ampliar reglas de inventario o convertir esta validación en una nueva capacidad de negocio.

