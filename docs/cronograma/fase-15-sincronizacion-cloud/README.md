# Fase 15: Sincronización SQLite–PostgreSQL

- **Estado:** Planificada y aprobada como alcance post-MVP; ejecución pendiente.
- **Aprobación:** 2026-09-06.
- **Índice:** [Cronograma maestro](../README.md).
- **Plan transversal:** [Evolución post-MVP](../evolucion-post-mvp.md).
- **Entrada:** Fase 14 cerrada; productores y garantías locales de Fase 10 verificados.

## Propósito

Construir una proyección central de inventario confirmado por los coordinadores locales.

## Sub-fases

- [15.01 Contratos y procedencia](./15.01-contratos-y-procedencia.md) — pendiente.
- [15.02 Carga inicial consistente](./15.02-carga-inicial.md) — pendiente.
- [15.03 Entrega durable y proyección](./15.03-entrega-y-proyeccion.md) — pendiente.
- [15.04 Conciliación y recuperación](./15.04-conciliacion-y-observabilidad.md) — pendiente.

## Disciplina de ejecución

Las sub-fases se ejecutan en el orden listado. Cada implementación parte de criterios
aprobados y pruebas observables según [ADR-0007](../../architecture/adr/0007-outside-in-tdd.md).
La planificación no declara tareas implementadas. Al cerrar cada sub-fase se registran
evidencias y se ejecutan `pnpm test` y `pnpm typecheck`, además de las pruebas específicas.

Las decisiones de datos y autoridad siguen
[ADR-0024](../../architecture/adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md).

## Criterio de salida

Carga inicial e incrementos convergen sin duplicar movimientos; los atrasos y discrepancias permanecen visibles y recuperables.

## Fuera de alcance

Replicación de tablas, multi-master, reconstrucción automática de SQLite desde PostgreSQL y comandos cloud sobre stock.

