# FS-009: consolidación cloud interrumpida o desactualizada

## Respaldo actual

**Brecha post-MVP; sin implementación ni pruebas SQLite/PostgreSQL.** El alcance y la
autoridad están aceptados en [ADR-0024](../architecture/adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md).
El protocolo detallado y la retención se cierran en Fase 15. Esta ficha describe aceptación
futura; no extiende las garantías ya probadas de FS-007/FS-008 al transporte cloud.

## Riesgo

La nube puede perder disponibilidad o restaurarse a un punto anterior mientras la sucursal
continúa operando. Una carga inicial sin corte consistente, una reentrega o una caché antigua
pueden producir saldos duplicados, incompletos o presentados como actuales.

## Estado inicial

Inventario autoritativo local confirmado; snapshot inicial o incrementos pendientes hacia
PostgreSQL; la web consulta una proyección central con punto de aplicación por sucursal.

## Trigger del fallo

Corte de Internet, caída antes/después del commit, ACK perdido, snapshot interrumpido,
dependencia de producto ausente, contrato incompatible o restauración de PostgreSQL.

## Comportamiento prohibido

- Confirmar entrega por un éxito HTTP sin evidencia durable del destino correcto.
- Descontar una venta y su movimiento de inventario como dos efectos.
- Mostrar carga parcial como completa, datos antiguos como actuales o ausencia de datos como cero.
- Corregir el saldo autoritativo SQLite usando una proyección central atrasada.
- Perder hechos ya confirmados al restaurar la nube sin procedimiento de replay/bootstrap.
- Compartir respuestas privadas entre usuarios o sucursales mediante cachés web.

## Comportamiento esperado

La operación local continúa según su política offline. La cola conserva las entregas
pendientes. El receptor distingue custodia durable de aplicación; deduplica antes de aplicar
y confirma marca/efecto en una transacción. La carga inicial publica su corte y los cambios
posteriores sin solapamientos. La web comunica frescura, cobertura y pendientes.

## Garantía requerida

Convergencia hasta un mismo corte de la fuente autoritativa, sin efectos duplicados por
reentrega. No se promete disponibilidad global instantánea ni exactly-once en la red.
**Requerida, todavía no probada:** depende de los contratos y pruebas de Fase 15.

## Retry

Reintentar fallos transitorios con identidad estable. Aislar incompatibilidades e identidades
en conflicto conservando evidencia. Límites, retención, backoff y reanudación son decisiones
de 15.01; no se importan automáticamente los valores del relay local.

## Recuperación

Reanudar el envío desde estado durable. Tras restaurar PostgreSQL, reproducir el rango
retenido necesario o completar una nueva carga con corte consistente. Si la retención no
cubre el hueco, no declarar la vista actualizada. La intervención queda autorizada y auditada.

## Observabilidad

Nodo y sucursal autenticados, correlación, puntos recibidos/aplicados, antigüedad de origen,
último contacto, carga incompleta y códigos seguros. No registrar secretos ni payloads con PII.

## Impacto operativo

La consulta web puede quedar desactualizada; la operación local no depende de la nube.
Las discrepancias requieren atención y no autorizan ajustes automáticos locales.

## Componentes afectados

Outbox cloud, API Fastify, inbox/proyección PostgreSQL, conciliación y estado de consulta
Next.js/TanStack Query. La caché de navegador no reemplaza una cola durable.

## Pruebas pendientes

- [ ] Snapshot más actividad concurrente con corte verificable.
- [ ] Commit receptor seguido de ACK perdido y reentrega.
- [ ] Duplicado idéntico frente a mismo ID con contenido distinto.
- [ ] Dependencia ausente y contrato incompatible sin pérdida de evidencia.
- [ ] Restauración central con hechos confirmados y retención suficiente/insuficiente.
- [ ] Aislamiento SSR/cliente y visualización correcta de frescura.
- [ ] Presión de almacenamiento y recuperación después de desconexión prolongada.

## Documentos relacionados

- [Fase 15](../cronograma/fase-15-sincronizacion-cloud/README.md).
- [Fase 17](../cronograma/fase-17-validacion-despliegue/README.md).
- [FS-007](./FS-007-entrega-outbox-ambigua.md) y [FS-008](./FS-008-contrato-sync-incompatible.md).
- [Errores](../architecture/11-errores.md); los códigos cloud se incorporan allí al especificarse.
