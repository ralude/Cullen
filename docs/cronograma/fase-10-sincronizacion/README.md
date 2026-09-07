# Fase 10: Sincronizacion

- **Estado:** En progreso — 10.01 y 10.02 completadas; 10.03 y 10.04 con implementación parcial desde el 2026-09-06
- **Indice:** [Cronograma](../README.md)
- **Precedida por:** [Fase 9B - Perfiles operativos](../fase-09b-perfiles/README.md), insertada por la [replanificacion del 2026-09-04](../replanificacion-fase-09b.md)

## Proposito

Permitir operacion offline-first entre terminales autonomas y el nodo coordinador mediante una cola persistente que sincroniza eventos, nunca tablas.

## Sub-fases

- [~~10.01 Sync queue~~](./10.01-sync-queue.md) — **completada 2026-09-05**
- [~~10.02 Protocolo de eventos~~](./10.02-protocolo-eventos.md) — **completada 2026-09-06**
- [10.03 Servidor receptor](./10.03-servidor-receptor.md) — **en progreso**: recepción durable,
  transporte autenticado, aplicación de inventario con discrepancias, entrega por destino y el
  vertical de catálogo, métodos de pago, políticas y tasas con su corte inicial implementados;
  concesiones y disponibilidad siguen abiertas
- [10.04 Offline y reconexion](./10.04-offline-reconexion.md) — **en progreso**: cliente,
  worker, retry/pausa/reanudación y lectura de estado implementados; antigüedad de
  referencias, UI y parte de los escenarios de corte abiertos

## Ejecución

El [plan de ejecución de 10.01](./plan-10.01-sync-queue.md) se completó el 2026-09-05 sobre
el outbox existente. ADR-0022 fija orden por agregado, generación de claim y recuperación
al menos una vez.

El [plan de 10.02](./plan-10.02-protocolo-eventos.md) se ejecutó el 2026-09-06 y sus decisiones
quedaron aceptadas en [ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md):
sobre versionado, catálogo cerrado de los once contratos existentes, ownership verificado,
deduplicación por `eventId`, clasificación de confirmaciones y aislamiento durable `BLOCKED` de
la salida local. Todo se probó con fixtures de productores reales, estado receptor fake y SQLite
real; no se abrieron conexiones ni se aplicaron efectos comerciales remotos. La siguiente
sub-fase es 10.03, servidor receptor.

### Planificación restante, 2026-09-06

La secuencia es **10.03 → 10.04**, con criterios de aceptación y cortes fuera de implementación:

- [Decisiones y gates de activación](./plan-secuencia-y-decisiones.md).
- [Plan 10.03: receptor y base operativa LAN](./plan-10.03-servidor-receptor.md).
- [Plan 10.04: operación offline y reconexión](./plan-10.04-offline-reconexion.md).

El usuario confirmó LAN operativa completa, nodos nuevos de prueba y alta manual auditable
de confianza. Se incorporan explícitamente contratos/productores faltantes, consumidores,
bootstrap y entrega independiente por terminal; la migración de tiendas existentes queda
como gate separado. Las preguntas de negocio quedaron resueltas y registradas en
[ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md): operaciones
de stock conectadas y recuperables, concesiones de ocho horas, costo conocido al vender y
pausa con reanudación manual tras diez intentos. El corte 0 desarrolla sus contratos de detalle.
No se adelanta Fase 11.

### Implementación del 2026-09-06

Se ejecutaron los cortes 1–4 de 10.03 —recepción durable, transporte autenticado, aplicación
de inventario con discrepancias, entrega por destino y el vertical completo de catálogo con su
corte inicial, métodos de pago, políticas operativas y tasas confirmadas— y los cortes 1–2 de
10.04 con parte de
los cortes 3–4.
Migraciones 0028–0035,
transporte HTTPS con autenticación mutua real en pruebas, coordinador y dos terminales con
SQLite independiente y listener propio.

Sigue **abierto** y no debe presentarse como listo para operar:

- contratos, productores y consumidores de las referencias que faltan —concesiones y
  disponibilidad—; catálogo, categorías, unidades, métodos de pago, políticas operativas y
  tasas confirmadas ya se distribuyen con corte inicial reanudable;
- consumidores de caja, fiscalidad y ventas del coordinador;
- coordinación LAN de compras, aprobaciones de conteo y devoluciones;
- concesiones offline de ocho horas y sus restricciones en backend;
- `SaleCompleted` con snapshot de costo: los v1 recibidos conservan costo desconocido en
  lugar de tomar el promedio del coordinador;
- presentación de estado y antigüedad en `apps/desktop`;
- cinco de los once escenarios de corte del plan de 10.04.

## Criterio de salida

Una operacion local sobrevive cortes de red y sus eventos se entregan de forma idempotente.

La autoridad de escritura y los conflictos siguen `docs/architecture/12-sincronizacion-y-ownership.md`; la sincronizacion no introduce escrituras multi-master.

## Frontera con la evolución post-MVP

La [planificación aprobada](../evolucion-post-mvp.md) conserva 10.01–10.04 y su estado.
La consolidación en PostgreSQL pertenece a Fases 14–15, los almacenes explícitos y sus
transferencias internas a Fase 13, y las consultas web a Fases 16–16B.
[ADR-0024](../../architecture/adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md)
retira la atribución histórica de transferencias entre sucursales/nodos a Fase 10: quedan
fuera de esta fase y de las fases post-MVP aprobadas, pendientes de un alcance independiente.
