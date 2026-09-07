# Fase 13: Almacenes e inventario por ubicación

- **Estado:** Planificada y aprobada como alcance post-MVP; ejecución pendiente.
- **Aprobación:** 2026-09-06.
- **Índice:** [Cronograma maestro](../README.md).
- **Plan transversal:** [Evolución post-MVP](../evolucion-post-mvp.md).
- **Entrada:** MVP técnico cerrado según alcance de entregas; especificación de 13.01 aprobada antes de implementar.

## Propósito

Separar existencias por almacén dentro de cada sucursal, conservando la historia y la autoridad local.

## Sub-fases

- [13.01 Modelo operativo y decisiones](./13.01-modelo-y-decisiones.md) — pendiente.
- [13.02 Migración e identidad de existencias](./13.02-migracion-e-identidad.md) — pendiente.
- [13.03 Operación local por almacén](./13.03-operacion-por-almacen.md) — pendiente.
- [13.04 Transferencias internas recuperables](./13.04-transferencias-internas.md) — pendiente.

## Disciplina de ejecución

Las sub-fases se ejecutan en el orden listado. Cada implementación parte de criterios
aprobados y pruebas observables según [ADR-0007](../../architecture/adr/0007-outside-in-tdd.md).
La planificación no declara tareas implementadas. Al cerrar cada sub-fase se registran
evidencias y se ejecutan `pnpm test` y `pnpm typecheck`, además de las pruebas específicas.

Las decisiones de datos y autoridad siguen
[ADR-0024](../../architecture/adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md).

## Criterio de salida

Dos almacenes pueden mantener el mismo producto con saldos independientes; migración y transferencias conservan cantidades e historia.

## Fuera de alcance

Transferencias entre sucursales o dueños distintos, almacén central independiente y cambios de stock desde la nube.

