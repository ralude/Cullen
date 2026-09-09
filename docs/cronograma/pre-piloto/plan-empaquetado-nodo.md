# Plan de ejecución: empaquetado del nodo

- Fecha: 2026-09-09.
- Estado: **entregado el 2026-09-09**; el MSI se construye pero no se firma ni se ha validado en
  hardware de tienda.
- Decisión: [ADR-0030](../../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md).
- Deuda de origen: [auditoría 2026-09-04](../fase-11-seguridad/auditoria-puntos-clave-2026-09-04.md)
  punto 4, y CA-11.03-09 de [11.03](../fase-11-seguridad/11.03-jwt-sesiones.md).

## Línea base verificada

Antes de este trabajo: el servidor sólo corría con `tsx` sobre el árbol de fuentes; nadie lo
arrancaba en una estación instalada —el proceso principal de Electron carga la interfaz desde el
nodo pero no lo lanza—; no había instalador, ni servicio, ni forma de aplicar la ACL que
`assertProtectedDirectory` verifica en cada arranque. El nodo ya sabía servir la interfaz bajo
`/app/` desde `RENDERER_DIST_PATH`.

## Cortes

1. **Decisión (ADR-0030).** Servicio de Windows independiente frente a proceso hijo de Electron;
   bundle con runtime embebido; MSI de WiX responsable del perímetro; firma diferida.
2. **Bundle del servidor.** `pnpm --filter @supermarket/server build` con esbuild produce
   `dist/`: `index.js` del servicio y los CLI de arranque, respaldo y material LAN.
   `better-sqlite3` queda externo y pasa a dependencia directa de `apps/server` para que el
   bundle lo resuelva y el instalador lo copie.
3. **Definición del instalable.** `packaging/winsw/CullenNode.xml` y `packaging/wix/Cullen.wxs`:
   servicio supervisado, ACL por `icacls` idéntica a la que el nodo exige, cuenta de servicio
   virtual, plantilla de topología.
4. **Prueba del arranque empaquetado.** Cierra CA-11.03-09.

## Criterios de aceptación

Evidencia: `apps/server/src/packaged-node-boot.integration.test.ts` compila el bundle, lo
arranca como proceso real sobre un perímetro con la ACL del instalador y opera contra él por
HTTP, sin proxy de `electron-vite` en ninguna parte.

- [x] CA-PP-01: el nodo se distribuye como artefacto compilado, sin `tsx` ni el árbol de fuentes.
- [x] CA-PP-02: el artefacto arranca como proceso independiente y sirve la interfaz bajo `/app/`,
  con los assets resolviendo bajo ese prefijo y `/app` redirigiendo.
- [x] CA-PP-03: un operador autentica contra el artefacto con cookie `HttpOnly` y
  `SameSite=Strict`, ejecuta una operación y la operación sobrevive al reinicio del proceso.
- [x] CA-PP-04: `SERVER_HOST` fuera de loopback y un perímetro legible por cualquier cuenta
  abortan el arranque del artefacto, con prueba.
- [x] CA-PP-05: existe una definición de instalador que registra el servicio y aplica la ACL que
  `assertProtectedDirectory` acepta, con su procedimiento de construcción documentado.
- [x] CA-PP-06: existe un runbook reproducible de instalación, actualización y desinstalación
  ([instalación de una estación](../../operacion/instalacion-estacion.md)).
- [ ] CA-PP-07: el MSI queda firmado con un certificado válido. **Abierto**: no hay certificado
  disponible; sigue declarado en el gate de piloto.
- [ ] CA-PP-08: el MSI se instala y verifica en una estación de tienda real. **Abierto**: exige
  hardware de despliegue.
- [x] CA-PP-09: `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes.

## Fuera de alcance

La firma, la validación en tienda, los chaos tests de energía/LAN/Electron y la ejecución de
`wix build` en CI sobre un runner Windows. El MSI no se construye ni se valida dentro de
`pnpm test`: lo que la suite cubre es el arranque del artefacto compilado, que es la frontera que
11.03 dejó declarada.
