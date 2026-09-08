# Plan de ejecución 11.02: roles, permisos y administración de identidad

- Fecha: 2026-09-07.
- Estado: **planificado, sin iniciar**. Bloqueado por D1–D5 de la
  [secuencia y decisiones de Fase 11](./plan-secuencia-y-decisiones.md).
- Especificación: [11.02 Roles y permisos](./11.02-roles-permisos.md).
- Deuda de origen: [auditoría 2026-09-04](./auditoria-puntos-clave-2026-09-04.md), puntos 3 y 7.
- ADR aplicables: [0012](../../architecture/adr/0012-permisos-catalogo-moneda-y-politicas-operativas.md)
  y [0015](../../architecture/adr/0015-permisos-efectivos-en-la-sesion.md), aceptados;
  [0011](../../architecture/adr/0011-autenticacion-pin-y-sesiones-locales.md) para credenciales;
  [0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) para
  concesiones. Falta el ADR de administración de identidad que resuelva D1–D5.
- Alcance recuperado de la [sub-fase 9B.09 retirada](../fase-09b-perfiles/9b.09-usuarios-y-roles.md).

## Objetivo y prerrequisitos

Que el administrador cree operadores, defina roles, asigne permisos y desactive a quien
corresponda desde la interfaz, y que ninguna interfaz pueda saltarse la autorización del caso de
uso ni dejar al sistema sin administración.

Leer antes de implementar: AGENTS.md y el `AGENTS.md` de `packages/core`, `packages/drivers/db`,
`apps/server` y `apps/desktop`; arquitectura 06 (casos de uso) y 12 (ownership); ADR-0011,
0012, 0015 y 0026; el ADR de identidad que cierre D1–D5.

Antes de escribir código: D1–D5 respondidas y registradas en su ADR. `pnpm typecheck` verde
—el punto 3 de la auditoría lo dejó como condición de cierre de sub-fase—.

## Línea base comprobada

Verificada sobre el árbol del 2026-09-07.

- **Modelado y persistido, sin casos de uso.** `packages/core/src/domain/identity/` implementa
  `User`, `Role` y `Permission` con `activate`/`deactivate`, `assignRole`/`removeRole`,
  `assignPermission`/`removePermission`, unicidad y el patrón de código estable
  (`ROLE_CODE_PATTERN`, `PERMISSION_CODE_PATTERN`). La migración `0013-identity-security.ts`
  creó `identity_users`, `identity_roles`, `identity_permissions`, `identity_user_roles`,
  `identity_role_permissions`, `identity_credentials`, `auth_lockouts` y `auth_sessions`.
- **Un único escritor de identidad.** `ProvisionInitialAdmin`
  (`packages/core/src/application/identity/authentication.ts:207`) llama
  `AuthenticationStore.provisionInitialAdmin`, que crea el rol `ADMIN` con las 50 constantes de
  `ADMIN_PERMISSIONS` (`apps/server/src/runtime.ts:81`) y se niega con
  `AUTH_ALREADY_PROVISIONED` si ya existe un operador. Se ejecuta solo por
  `apps/server/src/bootstrap-admin.ts`, que exige TTY interactivo.
- **Autorización aplicada, decisión no auditada.** `SqliteAuthorizationService`
  (`packages/drivers/db/src/authentication-store.ts:395`) resuelve por `hasPermission`. Cada
  caso de uso sensible autoriza antes de producir efectos, pero devuelve `FORBIDDEN` de
  inmediato sin escribir en `AuditWriter`: hoy no queda evidencia de un intento denegado.
- **Revocación por cambio de autorización disponible y sin disparador.**
  `verifyAndTouchSession` invalida la sesión si `auth_sessions.authorization_version` difiere de
  `identity_users.authorization_version` (`authentication-store.ts:190`). Ningún caso de uso
  incrementa esa columna porque ninguno cambia roles ni permisos.
- **Contrato de permisos vivo.** `apps/server/src/permission-contracts.test.ts` cruza el campo
  `permission` de cada contrato de `packages/shared/src/http/v1/` contra la constante que el
  caso de uso exige. Hoy los contratos declaran 69 entradas con permiso y 24 con `permission:
  null`; existen 50 códigos de permiso distintos.
- **Sin superficie de identidad.** No existe `packages/shared/src/http/v1/identity.contracts.ts`,
  ni `apps/server/src/routes/identity.ts`, ni pantalla en
  `apps/desktop/src/renderer/src/screens/`.

Consecuencia operativa: el único rol que existe es `ADMIN`, con los 50 permisos. ADR-0015 no
cambia hoy lo que ve ningún operador, y las pantallas de 9B no demuestran separación real de
responsabilidades. Eso no se corrige con más UI.

## Corte 1: la decisión de autorización deja evidencia

Independiente de D1–D5, así que puede ejecutarse mientras se resuelven. Cierra la tarea
«auditar decisiones de autorización» y la deuda de la auditoría sobre las cinco operaciones
sensibles.

1. Prueba outside-in primero: un actor sin permiso intenta una venta, una devolución, un ajuste,
   un cambio de precio y un cierre de caja; cada intento falla sin efecto y deja una entrada de
   auditoría con actor, permiso exigido, resultado, terminal, nodo, UTC y correlation ID.
2. Introducir un único punto de decisión reutilizable en aplicación, no una copia en cada caso
   de uso. La forma mínima es envolver `AuthorizationService` con un decorador que registre la
   decisión; el caso de uso conserva su llamada actual y su `FORBIDDEN`.
3. La entrada de auditoría no puede contener el PIN, el token ni el hash de credencial. El
   campo `reason` nombra el permiso exigido, no el detalle interno de la consulta.
4. Registrar denegación **y** concesión de las operaciones sensibles, o solo denegación, es una
   decisión de volumen: elegirla explícitamente en el corte y justificarla. Una auditoría que
   crece sin límite por cada lectura autorizada no es observabilidad, es ruido; 11.05 no la
   puede filtrar después sin perder evidencia.
5. Escribir la denegación fuera de la transacción del efecto que no ocurrió: no hay agregado que
   modificar y no debe abrirse una transacción para registrar un rechazo.

Límite: este corte no cambia ningún permiso exigido ni relaja una regla existente. Si una prueba
descubre un caso de uso sensible que hoy no autoriza, se reporta y se corrige en su corte, no se
convierte en refactor oportunista.

## Corte 2: casos de uso de administración de identidad

Depende de D1–D5. Trabaja outside-in: prueba observable primero, implementación mínima después.

1. **Permisos nuevos.** Agregar `packages/core/src/application/identity/permissions.ts` con
   `identity.user.manage` e `identity.role.manage`, siguiendo exactamente el patrón de los diez
   catálogos existentes. Incorporarlos a `ADMIN_PERMISSIONS`.
2. **Casos de uso**, en verbo + sustantivo y con códigos de error estables:
   `CreateOperator`, `UpdateOperator`, `ChangeOperatorStatus`, `AssignOperatorRoles`,
   `CreateRole`, `UpdateRolePermissions`, `ChangeRoleStatus`. Cada uno autoriza antes de leer o
   persistir, exactamente como ADR-0012 fija para catálogo y moneda.
3. **Credenciales.** El PIN entra solo por el mecanismo existente: `PinHasher.hash` y la tabla
   `identity_credentials`. Nunca se devuelve, se registra ni viaja de vuelta al renderer. La
   validación de 6–12 dígitos reutiliza la política ya publicada en `AUTH_POLICY`, no una copia.
   El alcance concreto del restablecimiento lo fija D3.
4. **Atomicidad del cambio de autorización.** Toda modificación de roles, permisos o estado
   incrementa `identity_users.authorization_version` de los usuarios afectados dentro de la
   misma transacción, de modo que sus sesiones vivas queden invalidadas por el mecanismo que ya
   existe. Un cambio de permisos de un rol afecta a todos sus portadores: la transacción debe
   alcanzarlos a todos, no solo al usuario editado.
5. **Bloqueo de auto-exclusión.** Según D4, evaluado dentro de la transacción con
   `BEGIN IMMEDIATE`, como ya hace el resto del store de autenticación. Dos administradores que
   se retiran el permiso a la vez no pueden dejar el sistema sin administración: la prueba de
   concurrencia es parte del corte, no un extra.
6. **Auditoría de negocio.** Alta, cambio de rol, cambio de permisos de un rol y desactivación
   son operaciones sensibles: identifican actor, terminal, timestamp y motivo, con `before` y
   `after` sin credenciales.
7. **Ownership en LAN.** Según D5. Si la identidad pertenece al coordinador, el caso de uso no
   se compone en una terminal y el intento falla con un código estable, no con un error genérico.

## Corte 3: contratos HTTP y pantalla de administración

1. Publicar `identity.contracts.ts` en `packages/shared/src/http/v1/`, declarando el campo
   `permission` de cada comando. La prueba de contratos lo cruzará contra la constante real; ese
   cruce es parte del corte, no una verificación posterior.
2. Registrar `apps/server/src/routes/identity.ts`. La ruta autentica, valida y adapta; no decide
   autorización ni contiene regla de negocio. Los errores públicos usan códigos estables y no
   exponen si un `operatorCode` existe.
3. Pantalla en `apps/desktop/src/renderer/src/screens/`, derivando visibilidad de
   `permissionCodes` con `isPermissionGranted` y el contrato importado de `@supermarket/shared`,
   nunca con un permiso reescrito a mano. Sigue el patrón de las pantallas de 9B.
4. La pantalla se retira de la navegación cuando la sesión no tiene ninguno de los dos permisos
   de identidad, siguiendo el criterio de ADR-0015 para Reportes: todas sus acciones exigen
   permiso, ninguna es de solo sesión.
5. El campo de PIN nunca se rellena con un valor recuperado, no se muestra y no se conserva en
   el estado del renderer más allá del envío.
6. Cobertura de interacción sobre `jsdom` con el arnés de
   `apps/desktop/src/renderer/src/testing/dom.ts`, como el resto de las pantallas ya cubiertas.

## Corte 4: pruebas de separación real

Cierra las tres tareas de deuda de la auditoría. No es un corte de retoque: es el que demuestra
que la fase sirvió para algo.

1. **Una prueba de contrato por permiso publicado por las pantallas de 9B.** Un actor con el
   permiso pasa; el mismo actor sin él recibe `FORBIDDEN` sin efecto. La visibilidad del
   renderer nunca cuenta como autorización.
2. **Los cinco flujos sensibles de la auditoría** —venta, devolución, ajuste, cambio de precio y
   cierre de caja— con permisos efectivos aplicados antes de cualquier efecto y con decisión
   auditable, sobre SQLite real y no con dobles.
3. **Perfiles reales.** Crear un cajero con un rol sin permisos de catálogo y comprobar que la
   sesión recibe exactamente sus permisos, que la navegación derivada cambia y que el servidor
   sigue rechazando lo que la UI oculta.
4. **Revocación en vivo.** Con una sesión abierta, cambiar el rol del operador y comprobar que
   la siguiente petición falla con `UNAUTHORIZED` por versión de autorización, no por
   expiración.
5. **Bloqueo de auto-exclusión bajo concurrencia**, con SQLite real y dos escrituras
   simultáneas.
6. **Ningún PIN en ninguna salida:** respuesta HTTP, log técnico, entrada de auditoría ni
   estado del renderer. Prueba automatizada, no revisión manual.

## Criterios de aceptación

- [ ] CA-11.02-01: D1–D5 están respondidas y registradas en un ADR aceptado antes de la primera
  línea de implementación del corte 2.
- [ ] CA-11.02-02: una denegación de autorización deja evidencia auditable con actor, permiso,
  terminal, nodo, UTC y correlation ID, sin credenciales, y no produce ningún efecto.
- [ ] CA-11.02-03: existen `identity.user.manage` e `identity.role.manage` como constantes de
  aplicación, incorporadas a `ADMIN_PERMISSIONS` y declaradas por sus contratos.
- [ ] CA-11.02-04: el administrador da de alta un operador, crea un rol, le asigna permisos, cambia
  el rol de un operador y lo desactiva, todo desde la interfaz y sin CLI.
- [ ] CA-11.02-05: cada cambio de autorización incrementa `authorization_version` de **todos** los
  usuarios afectados en la misma transacción, y las sesiones vivas correspondientes quedan
  invalidadas en la siguiente petición.
- [ ] CA-11.02-06: ningún cambio puede dejar el sistema sin administración; el bloqueo se evalúa
  dentro de la transacción y resiste dos intentos concurrentes.
- [ ] CA-11.02-07: el PIN entra solo por el mecanismo de credenciales existente y no aparece en
  respuestas, logs, auditoría ni estado del renderer; hay prueba automatizada de ello.
- [ ] CA-11.02-08: alta, cambio de rol, cambio de permisos y desactivación quedan auditados con
  actor, terminal, timestamp, motivo, `before` y `after`.
- [ ] CA-11.02-09: existe una prueba de contrato por cada permiso que publican las pantallas de 9B,
  con caso permitido y denegado.
- [ ] CA-11.02-10: venta, devolución, ajuste, cambio de precio y cierre de caja aplican permisos
  efectivos antes de producir efectos, sobre SQLite real, y dejan la decisión auditable.
- [ ] CA-11.02-11: un cajero con permisos parciales ve una navegación derivada distinta y el
  servidor rechaza igual lo que la interfaz oculta.
- [ ] CA-11.02-12: `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes; las pruebas arquitectónicas
  de fronteras pasan; la especificación 11.02 y el cronograma reflejan lo entregado.

## Superficies y límites

Permisos y casos de uso en `packages/core/src/application/identity/`; invariantes de rol y
usuario en `packages/core/src/domain/identity/`, que ya existen y se reutilizan; persistencia en
`packages/drivers/db/src/authentication-store.ts` con migración forward-only nueva si D1–D4 la
exigen; contratos en `packages/shared/src/http/v1/`; ruta en `apps/server/src/routes/`; pantalla
en `apps/desktop/src/renderer/src/screens/`.

Fuera de alcance: cambiar la política de autenticación de ADR-0011; sustituir sesiones opacas;
tocar la cookie o el host, que son de 11.03; cifrado en reposo, que es de 11.04; el formato de
los logs técnicos, que es de 11.05; y las capacidades de 9B.12, que esta sub-fase solo prueba
desde la autorización. No se reutiliza el número 9B.09 ni se renumera ninguna sub-fase.
