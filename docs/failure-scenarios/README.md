# Failure scenarios end-to-end

## Propósito

Este directorio describe cómo atraviesa el sistema completo un fallo crítico:
desde el trigger técnico hasta el estado durable, la recuperación y el impacto
operativo. No redefine códigos de error, máquinas de estado ni decisiones
arquitectónicas. Esas fuentes siguen siendo
[`11-errores.md`](../architecture/11-errores.md), los ADR y las especificaciones
de cada dominio.

Los escenarios solo afirman garantías respaldadas por una decisión aceptada,
código existente o pruebas. Una expectativa aún no implementada se marca como
brecha y no debe interpretarse como comportamiento vigente.

## Cómo leer el respaldo

- **Implementado y probado:** existe comportamiento observable y cobertura
  directa en el repositorio.
- **Implementado con cobertura parcial:** existe una base ejecutable, pero falta
  una prueba directa de alguna frontera end-to-end.
- **Decidido, pendiente de integración:** la política está aprobada, pero una
  fase abierta todavía debe componerla o validarla con infraestructura real.

## Escenarios iniciales

1. [FS-001: timeout fiscal con delivery `UNKNOWN`](./FS-001-timeout-fiscal-delivery-unknown.md)
   — implementado y probado contra el fake y SQLite; reconciliación de hardware
   real y barrido automático de arranque pendientes en Fase 8.
2. [FS-002: CRC error durante emisión](./FS-002-crc-error-durante-emision.md)
   — implementado y probado en dominio, aplicación y fake para evidencia
   ambigua; falta validación end-to-end por perfil real y por etapa.
3. [FS-003: impresora desconectada durante un documento](./FS-003-impresora-desconectada-durante-documento.md)
   — contrato y comportamiento fail-closed definidos; fake disponible, pero
   desconexión física por etapa y coordinación única siguen pendientes.
4. [FS-004: SQLite busy o conflicto de concurrencia](./FS-004-sqlite-busy-concurrency-conflict.md)
   — transacción, rollback, códigos estables y versiones implementados; el
   backoff del llamador no está implementado como política común.
5. [FS-005: venta concurrente de la última unidad](./FS-005-venta-concurrente-ultima-unidad.md)
   — stock no negativo e inventario append-only implementados en el nodo autoritativo; la
   concurrencia multi-terminal offline no ofrece garantía global y se resuelve con una
   discrepancia única auditable, probada con dos terminales; la presentación en UI y la
   política definitiva anterior al piloto siguen pendientes.
6. [FS-006: devolución y nota de crédito simulada](./FS-006-devolucion-nota-credito-simulada.md)
   — devolución total atómica e idempotente implementada con estado fiscal
   recuperable; parcialidad, pagos mixtos y hardware real siguen fuera de alcance.
7. [FS-007: entrega outbox ambigua o interrumpida](./FS-007-entrega-outbox-ambigua.md)
   — orden por agregado, retry, generación de claim, entrega por destino y recuperación
   tras reinicio implementados y probados con SQLite y transporte HTTPS autenticado entre
   un coordinador y dos terminales; agotamiento y reanudación autorizada incluidos.
8. [FS-008: contrato de sincronización incompatible u ownership no autorizado](./FS-008-contrato-sync-incompatible.md)
   — contratos, validación, ownership, deduplicación, aislamiento durable, recepción
   durable, autenticación mutua entre nodos, cuarentena y alta delegada de agregados
   implementados y probados; el fallo del propio registro de confianza sigue sin prueba.

## Escenario LAN planificado

La planificación LAN agrega [FS-011: operación comercial LAN interrumpida](./FS-011-operacion-lan-interrumpida.md)
— decidido por ADR-0026 y **todavía sin implementar**: la coordinación de compras, conteos y
devoluciones no forma parte de la base LAN entregada el 2026-09-06.
Compras, conteos y devoluciones coordinados conservan intención pendiente de conciliación;
no se promete atomicidad entre dos SQLite. El número continúa el catálogo sin renumerar
FS-009/FS-010, que siguen siendo post-MVP.

## Escenarios post-MVP pendientes

- [FS-009: consolidación cloud interrumpida](./FS-009-consolidacion-cloud-interrumpida.md)
  — brecha; protocolo detallado, implementación y pruebas SQLite/PostgreSQL en Fase 15.
- [FS-010: transferencia interna interrumpida](./FS-010-transferencia-interna-interrumpida.md)
  — brecha; ciclo operativo pendiente de decisión en 13.01 e implementación en 13.04.

Estas fichas contienen criterios futuros y no amplían las garantías implementadas del MVP.

## Regla de mantenimiento

Actualiza una ficha cuando cambie cualquiera de estas superficies: estado
durable, clasificación de evidencia, código estable, retry, idempotencia,
ownership, reconciliación, bloqueo operativo, auditoría o prueba que sustenta la
garantía. Si el cambio crea una decisión nueva, primero actualiza la
especificación o ADR correspondiente y enlázalo desde el escenario.

Cada ficha conserva las secciones obligatorias: riesgo, estado inicial, trigger,
comportamiento prohibido, comportamiento esperado, garantía, retry,
recuperación, observabilidad, impacto, componentes, pruebas y documentos
relacionados.
