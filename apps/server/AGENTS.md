# Reglas de `apps/server`

## Responsabilidad

Este paquete es el composition root local: ensambla casos de uso y drivers, expone Fastify para la
API de operadores y el transporte técnico LAN, y administra el lifecycle del nodo.

## Dependencias permitidas

- Usa exports públicos de `@supermarket/core`, `@supermarket/shared` y los drivers instalados.
- Fastify y APIs Node pertenecen a esta frontera de presentación/composición.

## Dependencias prohibidas

- No importes Drizzle ni `better-sqlite3`; compón el driver DB por su API pública.
- Rutas, hooks y handlers no contienen negocio, SQL ni autorización inventada: validan/adaptan y
  delegan en aplicación.
- No expongas endpoints de operadores en LAN ni secretos de transporte al cliente.

## Fuentes de verdad

Lee [`docs/architecture/06-casos-de-uso.md`](../../docs/architecture/06-casos-de-uso.md),
`docs/architecture/07-ipc.md`, `docs/architecture/10-logs.md` y
`docs/architecture/11-errores.md`. Para sync/LAN añade
`docs/architecture/12-sincronizacion-y-ownership.md`,
`docs/architecture/adr/0008-topologia-offline-por-nodo.md`,
`docs/architecture/adr/0023-protocolo-de-eventos-entre-nodos.md`,
`docs/architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md` y la subfase vigente.

## Flujo habitual

- Declara dependencias en `ServerDependencies`; `src/runtime.ts` construye adaptadores/casos de uso
  y `src/app.ts` registra rutas. Evita singletons ocultos y composición dentro de handlers.
- HTTP devuelve contratos de `@supermarket/shared`; traduce `AppError` a respuestas seguras sin
  stack. La identidad/autorización viene de aplicación y del contexto autenticado.
- Mantén un único proceso propietario de cada SQLite y cierre ordenado de servidor, workers,
  listeners y DB. No mantengas transacciones abiertas durante red.
- El listener LAN falla cerrado si falta confianza/configuración; la API de operadores permanece en
  loopback. Un ACK confirma custodia contractual, no aplicación comercial.
- Usa el logger estructurado de Fastify/driver; nunca `console.log` ni secretos/PII en logs.

## Validación

```bash
pnpm --filter @supermarket/server typecheck
pnpm --filter @supermarket/server test
```

Aplica además la validación global del root. Para rutas, ejecuta el contract test afectado. Para
sync real, ejecuta los E2E/integration tests del listener, transporte o lifecycle correspondiente.

## Errores comunes

- Convertir `src/runtime.ts` en dominio o acceder a SQLite desde una ruta.
- Confundir conectividad, entrega, custodia y aplicación.
- Abrir un listener LAN sin mTLS/registro confiable o degradar a HTTP.
