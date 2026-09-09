# Plan de ejecución 11.03: transporte y sesión (hardening)

- Fecha: 2026-09-07.
- Estado: **completado el 2026-09-08; brecha empaquetada declarada en el corte 4**.
  D6 recoge el loopback obligatorio ya decidido en la
  [secuencia y decisiones de Fase 11](./plan-secuencia-y-decisiones.md).
- Especificación: [11.03 JWT y sesiones](./11.03-jwt-sesiones.md).
- Deuda de origen: [auditoría 2026-09-04](./auditoria-puntos-clave-2026-09-04.md), puntos 4 y 6.
- ADR aplicable: [0011](../../architecture/adr/0011-autenticacion-pin-y-sesiones-locales.md),
  aceptado; [0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) para
  el transporte LAN técnico ya existente.

## Objetivo y prerrequisitos

Que la API de operadores no pueda quedar expuesta por una variable de entorno, que la cookie de
sesión tenga una política definida y probada por cada transporte permitido, y que la frontera de
sesión sobreviva a un arranque empaquetado sin el proxy de Vite.

Leer antes de implementar: AGENTS.md y el `AGENTS.md` de `apps/server` y `apps/desktop`;
arquitectura 07 (IPC y HTTP) y 12 (ownership); ADR-0011 y ADR-0026; el registro de la auditoría.

No hay decisión pendiente sobre exposición: `apps/server/AGENTS.md` y ADR-0026 D1 exigen
loopback para operadores. El orden general conserva 11.03 después de 11.02, pero la validación
del host no depende de nuevos roles ni queda bloqueada por D6; las pruebas con perfiles distintos
pueden añadirse cuando 11.02 los habilite.

## Línea base comprobada

Verificada sobre el árbol del 2026-09-07.

- **La sesión ya cumple su política.** Token opaco de 256 bits guardado solo como hash,
  expiración idle de 30 minutos y absoluta de 8 horas, revocación por logout, desactivación,
  cambio de autorización y concesión vencida. Todo probado
  (`packages/drivers/db/src/authentication-store.ts`, `apps/server/src/auth.contract.test.ts`).
- **`terminalId` y `originNodeId` no vienen de HTTP.** `createExecutionContext`
  (`apps/server/src/app.ts:238`) los toma de `dependencies.nodeIdentity`, cargado una vez por el
  composition root desde el archivo local. Una petición no puede sobrescribirlos.
- **El host es libre.** `apps/server/src/index.ts:16` hace
  `process.env.SERVER_HOST ?? '127.0.0.1'` sin validar. El default loopback es la única razón
  por la que hoy no hay exposición; no hay nada que rechace `0.0.0.0`.
- **La cookie no declara `Secure`.** `apps/server/src/routes/auth.ts:42` emite
  `pos_session=…; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=28800`. Sobre loopback HTTP
  es correcto y ADR-0011 lo anticipa; sobre cualquier otro transporte no lo es.
- **El transporte LAN técnico ya está resuelto y es otro.** El listener de sincronización exige
  TLS con autenticación mutua y falla cerrado ante material incompleto
  (`apps/server/src/sync/lan-listener.ts`). No comparte puerto ni política con la API de
  operadores, y esta sub-fase no lo modifica.
- **El renderer instalado ya se sirve desde el nodo.** `registerRendererAssets`
  (`apps/server/src/app.ts:266`) publica el bundle bajo `/app` para que la interfaz comparta
  origen con su API; el comentario del archivo explica por qué una base URL absoluta exigiría
  CORS con credenciales y una cookie `SameSite=None; Secure`.
- **El arranque empaquetado no está probado.** El proceso principal de Electron sigue sin
  cobertura automatizada; 10.04 lo dejó declarado como abierto.

## Corte 1: la configuración de host falla cerrado

1. Prueba primero: arrancar con un `SERVER_HOST` no permitido debe abortar con un código estable
   y sin abrir el listener. No basta con registrar una advertencia.
2. Implementar la validación en el composition root, junto al resto de la lectura de entorno, no
   dentro de una ruta ni de un hook.
3. Imponer loopback sin excepción para la API de operadores, conforme a D6 y sus fuentes
   normativas. Tener TLS configurado para sincronización no permite exponer esa API en LAN.
   Reutilizar el patrón de fallo cerrado de la composición sin introducir un modo LAN operativo.
4. Un valor ausente conserva el default actual de loopback: la instalación existente no cambia
   de comportamiento por este corte.

## Corte 2: política de cookie por transporte

1. Derivar los atributos de la cookie del transporte efectivo, en un único lugar. Hoy la cadena
   está escrita a mano en dos puntos de `routes/auth.ts` (emisión y borrado): centralizarla
   para evitar que sus políticas diverjan.
2. `Secure` se activa cuando el transporte lo permite, y su ausencia sobre loopback HTTP queda
   declarada como decisión, no como olvido. `HttpOnly`, `SameSite=Strict` y `Path=/api/v1` se
   conservan: el renderer no puede leer el token y ADR-0011 lo exige.
3. Probar login y logout sobre el transporte local permitido, incluyendo la ausencia de `Secure`
   en loopback HTTP prevista por ADR-0011. Verificar que el borrado apunta a la misma cookie
   (nombre, dominio y ruta) y conserva la política de protección. El HTTPS técnico de sync no
   emite cookies de operador; estas pruebas no habilitan otro transporte operativo.
4. Ningún atributo se vuelve configurable por entorno: se deriva del transporte, no se declara.

## Corte 3: suplantación y configuración insegura

1. Un cliente que envía `terminalId` u `originNodeId` en cabecera, cuerpo o cookie no cambia el
   contexto de ejecución. Ya es cierto por construcción; falta la prueba que lo fije como
   garantía y no como detalle de implementación.
2. Una cookie de sesión emitida en un nodo no vale en otro: probarlo con dos nodos de identidad
   distinta y bases separadas, como ya hacen las pruebas LAN de 10.04.
3. Una configuración insegura —host de operadores no loopback, aun con TLS; material incompleto
   cuando se habilita el listener técnico; identidad de nodo ilegible o corrupta— aborta el
   arranque con código estable. `loadNodeIdentity` ya falla con
   `NODE_IDENTITY_LOAD_FAILED`; el corte añade la cobertura y el resto de los casos.
4. Los mensajes públicos de estos fallos no revelan rutas de archivo, material ni configuración.

## Corte 4: frontera de sesión en el arranque empaquetado

Este corte verifica la frontera de sesión y transporte dentro del arranque instalado. **El
empaquetado pertenece a su fase propietaria** y esta sub-fase no lo implementa.

1. Escenario automatizado: Electron empaquetado inicia y supervisa su servidor local, la
   interfaz se carga desde `/app` —no desde `file://`—, un operador autentica, ejecuta una
   operación y la sesión sobrevive; tras reiniciar, la sesión expirada obliga a autenticar de
   nuevo y la operación anterior sigue persistida.
2. Sin proxy de Vite en ninguna parte del escenario. Un escenario que dependa del servidor de
   desarrollo no prueba esta frontera.
3. Si el empaquetado todavía no permite automatizarlo, se documenta el procedimiento manual
   reproducible y se declara la brecha **sin presentarla como cubierta**. No se marca el
   criterio cumplido por una prueba de renderer.

## Criterios de aceptación

Evidencia: `session-transport.test.ts` fija host y cookie; `node-boundary.contract.test.ts`
cubre suplantación, aislamiento entre nodos e identidad/configuración inválida. Al cerrar la
sub-fase el 2026-09-08, CA-11.03-09 se satisfizo por su alternativa explícita de declarar la
brecha, no por presentar el empaquetado como verificado.

Actualización del 2026-09-09: la brecha ya no está abierta. `packaged-node-boot.integration.test.ts`
arranca el bundle compilado como proceso real y verifica interfaz bajo `/app`, autenticación,
operación y recuperación tras reinicio, sin proxy de Vite. El modelo de runtime que ese escenario
prueba es el que decidió
[ADR-0030](../../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md) —servicio de Windows
supervisado, no un proceso hijo de Electron—, así que el corte 4 de abajo describe la intención
original y no el mecanismo entregado. El MSI sin firmar y su validación en una tienda siguen
abiertos en el [gate de piloto](../gate-piloto-release.md).

- [x] CA-11.03-01: la implementación respeta el loopback obligatorio de
  `apps/server/AGENTS.md` y ADR-0026 D1; no existe excepción LAN para operadores por disponer de
  TLS ni se trata D6 como aprobación pendiente.
- [x] CA-11.03-02: un `SERVER_HOST` que exponga la API de operadores fuera de lo permitido aborta
  el arranque con código estable y sin abrir el listener; hay prueba automatizada.
- [x] CA-11.03-03: un valor ausente conserva el comportamiento loopback actual, verificado por
  prueba.
- [x] CA-11.03-04: los atributos de la cookie se derivan del transporte en un único lugar y
  coinciden entre emisión y borrado.
- [x] CA-11.03-05: existe una prueba de contrato de la cookie por cada transporte permitido,
  incluida `Secure` cuando corresponda.
- [x] CA-11.03-06: terminal y nodo del contexto de ejecución no son influenciables desde HTTP, y la
  prueba lo demuestra con cabecera, cuerpo y cookie.
- [x] CA-11.03-07: una sesión de un nodo no es válida en otro, probado con dos nodos y bases
  independientes.
- [x] CA-11.03-08: una configuración insegura o una identidad de nodo ilegible abortan el arranque
  con código estable y mensaje público que no expone rutas ni material.
- [x] CA-11.03-09: el arranque empaquetado con servidor local queda verificado —autenticación,
  operación y recuperación tras reinicio, sin proxy de Vite— o la brecha queda declarada
  explícitamente como no cubierta.
- [x] CA-11.03-10: `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes; ADR-0011 y la especificación
  11.03 reflejan cualquier política que este trabajo haya concretado.

## Superficies y límites

Lectura y validación de entorno en el composition root de `apps/server`; política de cookie en
la ruta de autenticación, con una sola fuente; pruebas de contrato en `apps/server`; escenario
de arranque en `apps/desktop`.

Fuera de alcance: cambiar la política de sesión de ADR-0011 (duración, token opaco, revocación);
el transporte LAN de sincronización, que ya está cerrado en 10.03/10.04; el empaquetado
reproducible de la estación, que pertenece a su fase propietaria; el cifrado del material en
reposo, que es de 11.04; y la redacción de logs, que es de 11.05.
