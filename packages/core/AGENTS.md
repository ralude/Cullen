# Reglas de `packages/core`

## Responsabilidad

Esta zona contiene `domain` y `application`. El dominio modela entidades, agregados, value objects,
eventos e invariantes. Aplicación coordina casos de uso, autorización, DTOs y puertos.

## Dependencias permitidas

- `domain` puede depender de otras piezas de dominio y de primitivas de `@supermarket/shared`.
- `application` puede depender de dominio, de sus propios puertos y de `@supermarket/shared`.
- Los consumidores externos usan únicamente el export público de `@supermarket/core`.

## Dependencias prohibidas

- `domain` no importa `application`.
- Ninguna capa de `core` importa apps, drivers, Electron, Fastify, React, Drizzle, SQLite,
  transportes o hardware.
- Un caso de uso no implementa un adaptador concreto ni conoce SQL/HTTP/IPC.

Estas fronteras están reforzadas por [`../../eslint.config.js`](../../eslint.config.js).

## Fuentes de verdad

Empieza en [`docs/architecture/README.md`](../../docs/architecture/README.md). Según el cambio,
lee `docs/architecture/02-modulos.md`, `docs/architecture/03-eventos.md`,
`docs/architecture/04-entidades.md`, `docs/architecture/05-agregados.md`,
`docs/architecture/06-casos-de-uso.md` y `docs/architecture/11-errores.md`, además del ADR y plan de
fase aplicables. Para ownership o sync, lee `docs/architecture/12-sincronizacion-y-ownership.md`.

## Flujo habitual

- Escribe primero una prueba del caso de uso en su frontera y usa fakes de los puertos.
- Mantén invariantes y transiciones en agregados/value objects; aplicación carga, autoriza,
  coordina la unidad de trabajo y persiste mediante puertos.
- Aplica autorización en aplicación antes de efectos sensibles. No confíes en rutas o UI como
  única barrera.
- Usa `DomainError` para invariantes y `ApplicationError`/`Result` para fallos de coordinación;
  no filtres excepciones de infraestructura hacia el dominio.
- Los eventos son hechos pasados e inmutables; integra mediante contratos versionados y
  consumidores idempotentes.

## Validación

```bash
pnpm --filter @supermarket/core typecheck
pnpm --filter @supermarket/core test
```

Aplica además la validación global del root. Si cambias exports o límites de importación, ejecuta
lint y las pruebas arquitectónicas.

## Errores comunes

- Poner una regla de negocio en un caso de uso cuando pertenece al agregado.
- Añadir una interfaz sin un puerto externo real o leer estado de otro módulo por su repositorio.
- Rehidratar agregados desde el ledger: el estado relacional sigue siendo la fuente operativa.
