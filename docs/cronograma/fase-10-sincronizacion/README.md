# Fase 10: Sincronizacion

- **Estado:** En progreso — 10.01, 10.02 y 10.03 cerradas; 10.04 solo espera la verificación
  manual de interfaz de CA-04-11
- **Indice:** [Cronograma](../README.md)
- **Precedida por:** [Fase 9B - Perfiles operativos](../fase-09b-perfiles/README.md), insertada por la [replanificacion del 2026-09-04](../replanificacion-fase-09b.md)
- **Siguiente:** [Fase 11 - Seguridad](../fase-11-seguridad/README.md), bloqueada hasta cerrar
  10.04

## Proposito

Permitir operacion offline-first entre terminales autonomas y el nodo coordinador mediante una cola persistente que sincroniza eventos, nunca tablas.

## Sub-fases

- [~~10.01 Sync queue~~](./10.01-sync-queue.md) — **completada 2026-09-05**
- [~~10.02 Protocolo de eventos~~](./10.02-protocolo-eventos.md) — **completada 2026-09-06**
- [~~10.03 Servidor receptor~~](./10.03-servidor-receptor.md) — **completada 2026-09-07**
- [10.04 Offline y reconexion](./10.04-offline-reconexion.md) — **en progreso**: falta la
  verificación manual de interfaz de CA-04-11

## Ejecución

El [plan de ejecución de 10.01](./plan-10.01-sync-queue.md) se completó el 2026-09-05 sobre
el outbox existente. ADR-0022 fija orden por agregado, generación de claim y recuperación
al menos una vez.

El [plan de 10.02](./plan-10.02-protocolo-eventos.md) se ejecutó el 2026-09-06 y sus decisiones
quedaron aceptadas en [ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md):
versionado, catálogo cerrado de contratos, ownership verificado, deduplicación por `eventId`,
clasificación de confirmaciones y aislamiento durable `BLOCKED` de la salida local.

La [secuencia 10.03 → 10.04](./plan-secuencia-y-decisiones.md) se planificó el 2026-09-06 con
las decisiones D1–D8 registradas en
[ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md), y se
ejecutó entre el 2026-09-06 y el 2026-09-07 según los planes de
[10.03](./plan-10.03-servidor-receptor.md), su
[corte 0 de referencias](./plan-10.03-corte-0-referencias.md) y
[10.04](./plan-10.04-offline-reconexion.md).

## Lo que la fase entrega

- **Confianza y transporte.** Registro confiable de nodos con alta y revocación auditadas;
  HTTPS con autenticación mutua y TLS 1.3 en un listener técnico separado, dentro del proceso
  dueño de SQLite. La API de operadores conserva loopback y sus sesiones.
- **Custodia durable.** Deduplicación por `eventId`, autoridad de agregado verificada antes de
  responder incluso a un duplicado, cuarentena de entradas incompatibles y ACK solo después
  del commit.
- **Aplicación recuperable.** Tres consumidores compuestos —inventario autoritativo,
  referencias y consolidación comercial—, con efecto y progreso en la misma transacción,
  dependencias realmente aplicadas y discrepancia única por evento y consumidor.
- **Referencias operativas.** Conjunto cerrado completo: catálogo con precios e impuestos,
  categorías, unidades, métodos de pago, políticas operativas, tasas confirmadas, concesiones
  de operador y disponibilidad informativa, cada una con contrato, productor transaccional,
  consumidor y corte inicial reanudable.
- **Infraestructura de operación distribuida de stock.** Compras completadas, conteos aprobados
  y devoluciones registran su intención antes del primer efecto y exigen enlace con el
  coordinador; sin evidencia de todos sus pasos quedan pendientes de conciliación y visibles.
- **Costo conocido al vender.** Se congela junto al precio y al impuesto y viaja en
  `SaleCompleted.v2` con su procedencia; una compra posterior del coordinador no lo revaloriza.
- **Operación offline.** Concesiones de ocho horas, retry con pausa durable y reanudación
  autorizada, y estado visible con la antigüedad real de cada referencia.

## Lo que falta para cerrar la fase

No se presenta como disponible:

- La **compensación explícita** de un rechazo definitivo con efectos previos ya comprometidos:
  la operación queda `NEEDS_REVIEW` con la evidencia de cada paso.
- La **administración de usuarios y roles**, que pertenece a 11.02. Las concesiones distribuyen
  la autorización existente; no la editan.
- La **incorporación de tiendas con historia**, que necesita su plan de migración y
  conciliación.
- El **piloto o la producción**: el hardware fiscal sigue siendo fake y toda representación
  fiscal conserva `SIMULACION`.

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
