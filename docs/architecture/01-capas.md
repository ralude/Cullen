# 01. Capas

## Modelo

Se adopta una combinación de DDD táctico y arquitectura hexagonal/Clean Architecture. Las dependencias apuntan hacia el dominio.

```text
Presentación
  Fastify routes / WebSocket / Electron IPC / React
            |
Aplicación
  Casos de uso / DTOs / autorización / puertos
            |
Dominio
  Entidades / agregados / value objects / eventos / invariantes
            ^
Infraestructura
  Drizzle / SQLite / impresoras / hardware / Pino
```

La infraestructura implementa puertos definidos por aplicación o dominio; no modifica las reglas del dominio.

## Capas y responsabilidades

### Dominio

Contiene el lenguaje del negocio y sus invariantes. No puede importar Electron, Fastify, React, Drizzle, SQLite ni librerías de transporte.

Incluye entidades, agregados, value objects, eventos de dominio, servicios de dominio y máquinas de estado.

### Aplicación

Coordina un caso de uso: valida entrada, autoriza, carga agregados, abre una transacción, invoca el dominio, persiste y publica eventos.

Incluye DTOs, puertos de repositorio, unidad de trabajo, reloj, generador de IDs, autorización y publicación de eventos.

### Infraestructura

Implementa adaptadores concretos: repositorios Drizzle, conexión SQLite, outbox, Pino, puertos seriales, impresoras fiscales, scanner, báscula y almacenamiento seguro.

### Presentación

Expone interfaces externas. Fastify convierte HTTP en comandos de aplicación; Electron IPC expone capacidades nativas limitadas; React presenta estados y recoge acciones del usuario.

## Regla de dependencia

- El dominio no depende de ninguna capa externa.
- Aplicación depende de dominio.
- Infraestructura depende de aplicación y dominio para implementar puertos.
- Presentación depende de aplicación y de contratos compartidos.
- Las rutas y handlers no contienen reglas de negocio.

## Estructura prevista por paquete

```text
packages/core/src/domain/<modulo>/
  entities/
  aggregates/
  value-objects/
  events/
packages/core/src/application/<modulo>/
  use-cases/
  ports/
  dto/
packages/drivers/db/src/
packages/drivers/fiscal/src/
packages/drivers/hardware/src/
packages/drivers/logging/src/
apps/server/src/
  routes/
  plugins/
apps/desktop/src/
  main/
  preload/
  renderer/
```

Esta estructura es un contrato inicial. La implementación puede organizarse por slices verticales cuando un módulo crezca, siempre que conserve las reglas de dependencia.

## Extensión post-MVP aprobada

[ADR-0024](./adr/0024-inventario-multi-almacen-y-consolidacion-cloud.md) prevé un adaptador
PostgreSQL y composición Fastify central para consultar inventario consolidado, conservando
SQLite y su autoridad local. [ADR-0025](./adr/0025-web-nextjs-y-sistema-de-diseno.md) prevé
`apps/web` con Next.js en presentación y `packages/ui` para el sistema de diseño propio.
Esos paquetes se crean en sus fases futuras; no existen por efecto de esta planificación.

Next.js, incluidos Server Components y Route Handlers, delega negocio por HTTP en Fastify.
La UI no importa drivers ni implementa SQL. La biblioteca visual expone componentes y tokens
sin consultas, permisos de negocio ni persistencia. Se conservan los exports públicos y la
dirección de dependencias; el adaptador PostgreSQL no sustituye al driver SQLite.
