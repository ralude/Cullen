# Fase 14: Plataforma central en la nube

- **Estado:** Planificada y aprobada como alcance post-MVP; ejecución pendiente.
- **Aprobación:** 2026-09-06.
- **Índice:** [Cronograma maestro](../README.md).
- **Plan transversal:** [Evolución post-MVP](../evolucion-post-mvp.md).
- **Entrada:** Fase 13 cerrada.

## Propósito

Preparar PostgreSQL y una API Fastify central con referencias confiables, acceso seguro y recuperación.

## Sub-fases

- [14.01 Identidad y decisiones de plataforma](./14.01-identidad-y-plataforma.md) — pendiente.
- [14.02 Persistencia PostgreSQL y API central](./14.02-postgresql-y-api.md) — pendiente.
- [14.03 Acceso cloud y recuperación](./14.03-acceso-y-recuperacion.md) — pendiente.

## Disciplina de ejecución

Las sub-fases se ejecutan en el orden listado. Cada implementación parte de criterios
aprobados y pruebas observables según [ADR-0007](../../architecture/adr/0007-outside-in-tdd.md).
La planificación no declara tareas implementadas. Al cerrar cada sub-fase se registran
evidencias y se ejecutan `pnpm test` y `pnpm typecheck`, además de las pruebas específicas.

Las decisiones de datos y autoridad siguen
[ADR-0024](../../architecture/adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md).

## Criterio de salida

La API autentica actores/nodos, filtra por sucursal y opera sobre un esquema PostgreSQL migrable y restaurable.

## Fuera de alcance

Sincronización operativa completa (Fase 15), UI web (Fase 16), gobierno central del catálogo y cambios de inventario remoto.

