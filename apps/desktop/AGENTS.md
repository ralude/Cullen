# Reglas de `apps/desktop`

## Responsabilidad

Esta zona contiene el proceso principal Electron, el preload mínimo y el renderer React. Presenta
estado y envía comandos a la API local; no implementa negocio ni persistencia.

## Dependencias permitidas

- `main` y `preload` pueden usar Electron/Node para capacidades nativas estrictamente necesarias.
- El renderer usa React y los contratos serializables/exportados por `@supermarket/shared`.
- `src/renderer/src/api-client.ts` es la frontera HTTP del renderer con Fastify local.

## Dependencias prohibidas

- El renderer no importa Node.js, Electron, `@supermarket/core`, drivers, Drizzle ni SQLite.
- No expongas Node, filesystem, DB, serial, tokens o secretos mediante `contextBridge`.
- Componentes, hooks y clientes HTTP no contienen reglas de negocio ni deciden autorización; solo
  derivan navegación/presentación de capacidades y respuestas del backend.
- IPC queda reservado para capacidades nativas locales; el negocio viaja por HTTP/Fastify.

Estas fronteras están reforzadas por [`../../eslint.config.js`](../../eslint.config.js) y
[`../../tests/eslint-boundaries.test.ts`](../../tests/eslint-boundaries.test.ts).

## Fuentes de verdad

Lee [`docs/architecture/07-ipc.md`](../../docs/architecture/07-ipc.md),
`docs/architecture/adr/0002-transporte-negocio-ipc.md` y los contratos HTTP en
`packages/shared/src/http/v1/`. Para permisos/navegación usa
`docs/architecture/adr/0015-permisos-efectivos-en-la-sesion.md`; para una pantalla de negocio, lee
su especificación y criterio de aceptación, no copies reglas desde el backend.

## Flujo habitual

- Añade o cambia primero el contrato compartido/backend; adapta `src/renderer/src/api-client.ts` y
  después la UI.
- Mantén `contextIsolation: true`, `nodeIntegration: false` y `sandbox: true` salvo ADR explícito.
- Traduce códigos de error estables a mensajes en español y representa estados pendientes,
  desconocidos o vencidos sin presentarlos como éxito.
- Prueba la salida observable. Los tests actuales renderizan estático; no afirmes interacción DOM si
  la infraestructura no existe.

## Validación

```bash
pnpm --filter @supermarket/desktop typecheck
pnpm --filter @supermarket/desktop test
pnpm test -- tests/eslint-boundaries.test.ts
```

Aplica además la validación global del root.

## Errores comunes

- Importar un caso de uso o driver para evitar una llamada HTTP.
- Confiar en ocultar un botón como control de permisos.
- Añadir una API amplia al preload cuando basta el contrato HTTP existente.
