# Fase 10: Sincronizacion

- **Estado:** Pendiente
- **Indice:** [Cronograma](../README.md)
- **Precedida por:** [Fase 9B - Perfiles operativos](../fase-09b-perfiles/README.md), insertada por la [replanificacion del 2026-09-04](../replanificacion-fase-09b.md)

## Proposito

Permitir operacion offline-first entre terminales autonomas y el nodo coordinador mediante una cola persistente que sincroniza eventos, nunca tablas.

## Sub-fases

- [10.01 Sync queue](./10.01-sync-queue.md)
- [10.02 Protocolo de eventos](./10.02-protocolo-eventos.md)
- [10.03 Servidor receptor](./10.03-servidor-receptor.md)
- [10.04 Offline y reconexion](./10.04-offline-reconexion.md)

## Planificación preparatoria

El [plan de ejecución de 10.01](./plan-10.01-sync-queue.md), propuesto el 2026-09-05,
parte del outbox existente e incluye línea base, decisiones previas, secuencia outside-in
y criterios de recuperación. La implementación continúa pendiente hasta el cierre de 9B;
al recibir ese cierre se revalidan productores, consumidores y migraciones del árbol final.

## Criterio de salida

Una operacion local sobrevive cortes de red y sus eventos se entregan de forma idempotente.

La autoridad de escritura y los conflictos siguen `docs/architecture/12-sincronizacion-y-ownership.md`; la sincronizacion no introduce escrituras multi-master.
