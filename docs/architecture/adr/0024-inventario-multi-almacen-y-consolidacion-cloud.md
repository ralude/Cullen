# ADR-0024: Inventario multi-almacén y consolidación cloud

- **Estado:** Aceptado para evolución post-MVP; implementación pendiente.
- **Fecha:** 2026-09-06.
- **Complementa:** ADR-0001, ADR-0003, ADR-0005, ADR-0008, ADR-0009 y ADR-0023.
- **Precisa el alcance futuro de:** ADR-0020.
- **Plan:** [Evolución post-MVP](../../cronograma/evolucion-post-mvp.md).

## Contexto

El MVP conserva un almacén implícito por nodo y unicidad local por producto. La necesidad
aprobada es distinguir varios almacenes dentro de cada sucursal y consultar su inventario
desde Internet. La nube no debe convertirse en una dependencia para confirmar operación local.

## Decisión de arquitectura futura

1. La Fase 13 introduce almacenes explícitos bajo el coordinador de la sucursal y existencia
   por producto/almacén. Los IDs persistidos y su historia se conservan. El esquema y el
   alcance exacto de unicidad se aprueban con la migración antes de modificar `StockItem`.
2. La autoridad operativa del inventario permanece en el coordinador local con SQLite.
   Cada archivo conserva un único proceso servidor propietario. Los POS siguen siendo
   autónomos conforme ADR-0008; no pasan a compartir un archivo SQLite en red.
3. PostgreSQL central mantiene referencias y proyecciones de consulta por sucursal/almacén.
   No acepta escrituras de negocio que compitan con los saldos locales ni reconstruye
   automáticamente SQLite desde su proyección.
4. Fastify central expone consultas y recepción de integración mediante casos de uso y puertos.
   El adaptador PostgreSQL queda separado del adaptador SQLite; no introduce SQL ni tipos
   del ORM en dominio o aplicación. La representación de cantidades y agregaciones centrales
   mantiene precisión exacta, incluso al exceder la suma el rango seguro del JSON numérico.
5. La publicación hacia nube parte de inventario confirmado por el coordinador. No se
   descuentan en paralelo ventas crudas y movimientos derivados, ni se suman proyecciones
   de los POS al inventario autoritativo de su sucursal.
6. La Fase 15 define contratos versionados, carga inicial con corte consistente, entrega
   durable, deduplicación, aplicación ordenada y conciliación. El destino de nube conserva
   estado de entrega independiente del destino local; un ACK de tienda no confirma nube.
7. ADR-0023 no permite reenviar eventos de otro origen sin una decisión adicional. Antes
   de implementar el salto a nube se especificará si el coordinador emite hechos propios
   derivados o utiliza un contrato de intermediación con procedencia verificable. No se
   cambia `originNodeId` de un hecho recibido para hacerlo pasar por propio.
8. La vista web es eventualmente consistente. Expone el punto aplicado por sucursal y su
   antigüedad, no una promesa de stock global instantáneo ni de disponibilidad reservada.
9. Las transferencias de Fase 13 solo ocurren entre almacenes del mismo dueño local.
   Se aprueban su máquina de estados, límites transaccionales, tránsito, recuperación y
   permisos antes de implementarlas. Dos ajustes independientes no representan un traslado.

## Disposición de ADR-0020 y 9B.08

El almacén implícito sigue siendo la regla del MVP. El caso multi-almacén queda aceptado para
Fase 13, manteniendo 9B.08 diferida e histórica. Su aprobación de alcance no resuelve por sí
sola las decisiones operativas de 13.01 ni autoriza cambios anticipados de esquema.

La atribución anterior de transferencias entre sucursales/nodos a Fase 10 queda reemplazada,
solo respecto a ese alcance, por **evolución futura sin fase asignada**. Las fases 10.01–10.04
conservan sincronización terminal/coordinador, y 13–17 no incluyen transferencias entre
dueños distintos ni almacén central independiente.

## Gates antes de implementación

Consultar el [registro de decisiones](../../cronograma/evolucion-post-mvp.md#decisiones-abiertas-con-dueño):
topología confiable, almacén inicial, despacho/devoluciones, tránsito y costo; correspondencia
de productos entre sucursales; retención, bootstrap y protocolo cloud. No se modifica el
origen inmutable de agregados existentes para resolver una asignación administrativa.

## Consecuencias y validación

Se agregan capacidades después del MVP sin alterar su operación vigente. La mayor frontera
de datos exige pruebas de migración, invariantes de traslado, idempotencia, aislamiento por
sucursal y restauración. Los escenarios futuros se registran como brechas en
[FS-009](../../failure-scenarios/FS-009-consolidacion-cloud-interrumpida.md) y
[FS-010](../../failure-scenarios/FS-010-transferencia-interna-interrumpida.md).
No existe aún una garantía implementada de sincronización SQLite/PostgreSQL.

