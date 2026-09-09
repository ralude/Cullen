# Arquitectura del Sistema

## Propósito

Este directorio contiene las decisiones arquitectónicas para el sistema de supermercados orientado al mercado empresarial venezolano.

La arquitectura prioriza:

- operación confiable con conectividad intermitente;
- ejecución standalone y evolución a una red LAN multi-terminal;
- trazabilidad de operaciones comerciales y fiscales;
- dinero y tasas de cambio sin errores de precisión;
- integración intercambiable con hardware fiscal;
- separación estricta entre dominio, aplicación, infraestructura y presentación.

## Alcance de la Fase 0

Esta fase define contratos, límites y decisiones. No implementa ventas, inventario, caja, facturación ni integración real con hardware. El scaffold y las dependencias de infraestructura pertenecen a la Fase 1 del [cronograma del proyecto](../cronograma/README.md).

Incluye:

- documentación arquitectónica separada por tema;
- registros de decisiones arquitectónicas (ADR);
- contratos y límites que guían las fases posteriores.

## Documentos

| Orden | Documento | Contenido |
|---:|---|---|
| 00 | [Contexto y alcance](./00-contexto-y-alcance.md) | Objetivos, restricciones y principios |
| 01 | [Capas](./01-capas.md) | Clean Architecture y reglas de dependencia |
| 02 | [Módulos](./02-modulos.md) | Bounded contexts y límites iniciales |
| 03 | [Eventos](./03-eventos.md) | Eventos de dominio, integración y outbox |
| 04 | [Entidades](./04-entidades.md) | Entidades y value objects previstos |
| 05 | [Agregados](./05-agregados.md) | Fronteras de consistencia e invariantes |
| 06 | [Casos de uso](./06-casos-de-uso.md) | Contratos de aplicación y catálogo del MVP |
| 07 | [IPC](./07-ipc.md) | Comunicación Electron, Fastify y hardware |
| 08 | [Base de datos](./08-base-de-datos.md) | SQLite, Drizzle y convenciones de persistencia |
| 09 | [Estados fiscales](./09-estados-fiscales.md) | Máquinas de estado y recuperación ante fallos |
| 10 | [Logs](./10-logs.md) | Logs técnicos, auditoría y redacción |
| 11 | [Errores](./11-errores.md) | Errores tipados, códigos y fronteras de transporte |
| 12 | [Sincronización y ownership](./12-sincronizacion-y-ownership.md) | Nodos autónomos, autoridad de escritura y conflictos |

## ADRs

- [ADR-0001: DDD táctico y arquitectura hexagonal](./adr/0001-ddd-arquitectura-hexagonal.md)
- [ADR-0002: Transporte de negocio e IPC](./adr/0002-transporte-negocio-ipc.md)
- [ADR-0003: SQLite, dinero e identificadores](./adr/0003-sqlite-dinero-identificadores.md)
- [ADR-0004: Estados fiscales persistidos](./adr/0004-estados-fiscales-persistidos.md)
- [ADR-0005: Eventos y outbox](./adr/0005-eventos-outbox.md)
- [ADR-0006: Errores, logs y auditoría](./adr/0006-errores-logs-auditoria.md)
- [ADR-0007: Outside-In TDD para funcionalidades](./adr/0007-outside-in-tdd.md)
- [ADR-0008: Topología offline por nodo](./adr/0008-topologia-offline-por-nodo.md)
- [ADR-0009: Estado relacional, ledger y outbox](./adr/0009-estado-relacional-ledger-outbox.md)
- [ADR-0010: Transporte serial común e integraciones fiscales por proveedor](./adr/0010-transporte-serial-y-protocolos-fiscales.md)
- [ADR-0011: Autenticación por PIN y sesiones locales revocables](./adr/0011-autenticacion-pin-y-sesiones-locales.md)
- [ADR-0012: Permisos de catálogo/moneda y políticas operativas versionadas](./adr/0012-permisos-catalogo-moneda-y-politicas-operativas.md)
- [ADR-0013: Reportes operativos de lectura, permisos y exportación](./adr/0013-reportes-operativos-de-lectura.md)
- [ADR-0014: Tasas de cambio — histórico, sugerencia externa y confirmación humana](./adr/0014-tasas-de-cambio-sugerencia-y-confirmacion.md)
- [ADR-0015: Permisos efectivos en la sesión y navegación derivada en el renderer](./adr/0015-permisos-efectivos-en-la-sesion.md)
- [ADR-0016: Método de costeo de inventario y cálculo del margen](./adr/0016-metodo-de-costeo-y-margen.md) — **aceptado para MVP no certificado**, default reemplazable
- [ADR-0017: Política de devolución y nota de crédito simulada](./adr/0017-politica-de-devolucion.md) — **aceptado para MVP no certificado**, alcance mínimo
- [ADR-0018: Identificación del cliente en la venta](./adr/0018-datos-obligatorios-del-cliente.md) — **aceptado para MVP no certificado**, snapshot opcional
- [ADR-0019: Proveedores y evidencia de recepciones de compra](./adr/0019-proveedores-y-recepciones-de-compra.md)
- [ADR-0020: Modelo de almacenes y transferencias de existencia](./adr/0020-modelo-de-almacenes-y-transferencias.md) — **aceptado**, un almacén implícito por nodo; transferencias diferidas
- [ADR-0021: MVP de referencia no certificado y defaults reemplazables](./adr/0021-mvp-referencia-no-certificado.md) — **aceptado**, política de alcance
- [ADR-0022: Entrega outbox ordenada y recuperable](./adr/0022-entrega-outbox-ordenada-y-recuperable.md) — **aceptado**, generación de claim, orden y recuperación
- [ADR-0023: Protocolo de eventos entre nodos](./adr/0023-protocolo-de-eventos-entre-nodos.md) — **aceptado**, sobre versionado, ownership verificado, deduplicación y aislamiento local
- [ADR-0024: Inventario multi-almacén y consolidación cloud](./adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md) — **aceptado para post-MVP**, implementación y especificaciones de detalle pendientes
- [ADR-0025: Web interna Next.js y sistema de diseño de Cullen](./adr/0025-web-nextjs-y-sistema-de-diseno.md) — **aceptado para Fases 16 y 16B**, sin implementación
- [ADR-0026: LAN operativa y recuperación entre nodos](./adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) — **aceptado e implementado parcialmente en Fase 10**; confianza, referencias, costo conocido, retry e infraestructura de conciliación listos; efectos remotos de compra/conteo/devolución y compensación explícita pendientes
- [ADR-0027: Administración de identidad — siembra de roles, ciclo de vida, PIN y ownership](./adr/0027-administracion-de-identidad.md) — **aceptado**, resuelve D1–D5 de la Fase 11 y declara pendiente el enrolamiento de credenciales entre nodos
- [ADR-0028: Enrolamiento local de credenciales entre nodos](./adr/0028-enrolamiento-local-de-credenciales.md) — **aceptado**, cierra la brecha declarada por ADR-0027 sin transportar secretos entre nodos
- [ADR-0029: Protección de datos en reposo](./adr/0029-proteccion-de-datos-en-reposo.md) — **aceptado**, resuelve D7–D9 de la Fase 11: sin cifrado de la base, ACL verificada, respaldos y secretos cifrados con custodia en el almacén del sistema, retención y rotación declaradas
- [ADR-0030: Empaquetado del nodo y runtime como servicio de Windows](./adr/0030-empaquetado-y-runtime-del-nodo.md) — **aceptado**, servicio de Windows supervisado por WinSW, instalador MSI de WiX responsable de la ACL del directorio de datos, bundle del servidor con runtime Node embebido; firma de ejecutables diferida

## Alcance del producto

Los niveles MVP técnico, piloto, producción soportada y plataforma empresarial se distinguen en [Alcance por nivel de entrega](../producto/alcance-entregas.md).

La [evolución post-MVP](../cronograma/evolucion-post-mvp.md) incorpora almacenes por sucursal,
PostgreSQL central, sincronización cloud, Web App Next.js y sistema de diseño propio basado
en shadcn/ui. Es arquitectura futura aprobada, no una descripción de paquetes ya existentes.

## Estado

El estado de ejecución no se duplica aquí. Consulta el [cronograma maestro](../cronograma/README.md), que contiene la fase y sub-fase actual.

## Mapeo del monorepo

| Ruta | Responsabilidad |
|---|---|
| `apps/desktop` | Electron, React, preload y supervisión del servidor local de la estación |
| `apps/server` | Fastify, HTTP, WebSocket y composición tanto de terminales como del coordinador |
| `packages/shared` | primitivas y contratos transversales sin lógica de negocio |
| `packages/core/src/domain` | dominio puro: entidades, agregados, eventos e invariantes |
| `packages/core/src/application` | casos de uso, DTOs, autorización y puertos |
| `packages/drivers/db` | SQLite por nodo, Drizzle, repositorios, migraciones, ledger y outbox |
| `packages/drivers/fiscal` | adaptadores de impresoras fiscales |
| `packages/drivers/hardware` | periféricos y hardware local |
| `packages/drivers/logging` | logs técnicos y auditoría |

La estructura interna de `core` permite extraer `domain` y `application` a paquetes separados si el crecimiento lo justifica. Los drivers están separados por integración para aislar dependencias nativas y permitir reemplazos independientes.

La [Fase 12.05](../cronograma/fase-12-optimizacion/12.05-mantenibilidad-estructural.md)
planifica mejoras de localidad de cambio con una baseline de tareas y consumidores reales.
Sus propuestas de estructura no describen código ya implementado ni sustituyen las reglas
de capas y módulos; el diagnóstico y el estado se mantienen en el cronograma.

Las obligaciones fiscales concretas deben validarse con fabricante o
representante, evidencia vigente del modelo y asesoría tributaria antes de
producción. La arquitectura no sustituye esa verificación ni la interpretación
legal.
