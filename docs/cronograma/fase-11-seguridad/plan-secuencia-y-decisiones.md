# Fase 11: secuencia restante y decisiones de activación

- Fecha: 2026-09-07.
- Estado: **en ejecución**. El corte 0 de 11.05 se entregó el 2026-09-08; ninguna otra sub-fase
  pendiente ha iniciado implementación.
- Autoridad: [AGENTS.md](../../../AGENTS.md), [arquitectura](../../architecture/README.md) y
  ADR aceptados: [0006](../../architecture/adr/0006-errores-logs-auditoria.md),
  [0011](../../architecture/adr/0011-autenticacion-pin-y-sesiones-locales.md),
  [0012](../../architecture/adr/0012-permisos-catalogo-moneda-y-politicas-operativas.md),
  [0015](../../architecture/adr/0015-permisos-efectivos-en-la-sesion.md) y
  [0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md) y
  [0027](../../architecture/adr/0027-administracion-de-identidad.md).
- Deuda de origen: [auditoría focal 2026-09-04](./auditoria-puntos-clave-2026-09-04.md), puntos
  3, 4, 5, 6, 7 y 8. Los puntos 1, 2 y 9 conservan otra fase propietaria.
- Alcance: identidad, autorización, transporte, protección de datos y observabilidad segura del
  MVP de referencia no certificado
  ([ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md)). No certifica
  seguridad ni fiscalidad.

## Línea base comprobada

Línea base del 2026-09-07, corregida en la revisión del 2026-09-08 contra código y fuentes
normativas. Cada afirmación tiene su archivo.

**Lo que ya existe y no se rehace:**

- El dominio de identidad modela usuario, rol y permiso con activación, asignación y unicidad
  (`packages/core/src/domain/identity/`). Las ocho tablas viven desde la migración
  `0013-identity-security.ts`.
- La autenticación por PIN, el bloqueo por operador+nodo y las sesiones opacas revocables están
  implementadas y probadas (`packages/core/src/application/identity/authentication.ts`,
  `packages/drivers/db/src/authentication-store.ts`). El corte mínimo pre-UI de 11.01 y 11.03
  quedó cerrado por el [gate de seguridad](../gate-seguridad-pre-ui.md).
- La autorización se aplica dentro de aplicación antes de producir efectos, mediante
  `AuthorizationService` y las 50 constantes de permiso de
  `packages/core/src/application/*/permissions.ts`.
- La sesión publica sus permisos efectivos (ADR-0015) y
  `apps/server/src/permission-contracts.test.ts` cruza el permiso declarado por cada contrato
  contra la constante que exige su caso de uso.
- `verifyAndTouchSession` ya invalida una sesión cuando `auth_sessions.authorization_version`
  difiere de `identity_users.authorization_version`, cuando el usuario está inactivo, cuando la
  concesión del coordinador venció y cuando expiró el límite idle o absoluto
  (`packages/drivers/db/src/authentication-store.ts:190`).
- El transporte LAN técnico ya exige TLS con autenticación mutua y falla cerrado ante material
  incompleto (`apps/server/src/sync/lan-listener.ts`, `apps/server/src/sync/lan-client.ts`).
- El driver de base ofrece `migrateDatabase` con respaldo, validación de integridad y
  restauración (`packages/drivers/db/src/migrations.ts:359`).
- `GetSyncStatus` ya deriva los cinco estados de sincronización, la antigüedad de referencias y
  las discrepancias abiertas (cerrado en 10.04).
- `CompleteSale` ya compone la salida de inventario para standalone y ventas propias del
  coordinador; los eventos de terminales se aplican en el coordinador mediante
  `InventoryAuthorityConsumer` (`apps/server/src/runtime.ts`).
  [FS-005](../../failure-scenarios/FS-005-venta-concurrente-ultima-unidad.md) conserva la garantía
  local y el rechazo auditable; 11.05 cubre su presentación y el atraso de aplicación remota.

**Lo que falta y esta fase debe cerrar:**

- **No existe ningún camino para crear un operador.** El único escritor de identidad es
  `ProvisionInitialAdmin`, que se niega a ejecutarse si ya hay un operador
  (`AUTH_ALREADY_PROVISIONED`) y solo corre por CLI interactivo local
  (`apps/server/src/bootstrap-admin.ts`). No hay contrato `identity`, ni ruta, ni pantalla.
- **Nada incrementa `authorization_version`.** El mecanismo de revocación por cambio de
  autorización existe en la lectura, pero ningún caso de uso lo dispara porque ningún caso de
  uso cambia roles ni permisos todavía.
- **La base ya provisionada necesita una transición de permisos.** Agregar constantes a
  `ADMIN_PERMISSIONS` no actualiza los roles persistidos. El ADR de identidad debe definir
  destinatarios y mecanismo autorizado para habilitar los permisos nuevos sin repetir el
  bootstrap; el corte 2 de 11.02 debe implementarlo y probarlo sobre una base anterior.
- **Una denegación no deja rastro auditable.** Los `FORBIDDEN` de
  `packages/core/src/application/**` devuelven el error de inmediato, antes de tocar
  `AuditWriter`. La auditoría conserva lo que se hizo, no lo que se intentó sin permiso.
- **`SERVER_HOST` acepta cualquier valor** (`apps/server/src/index.ts:16`) y la cookie de sesión
  se emite sin `Secure` (`apps/server/src/routes/auth.ts:42`). El default loopback es lo único
  que impide hoy exponer la API de operadores.
- **El arranque real no usa la ruta segura de migración:** `apps/server/src/runtime.ts:153`
  llama `applyMigrations` directamente y omite respaldo, validación y restauración.
- **No hay clasificación de datos sensibles ni política de retención** para SQLite, respaldos,
  identidad de nodo, material TLS, credenciales y artefactos de diagnóstico.
- ~~**`packages/drivers/logging/src/index.ts` es `export {}`.**~~ Cerrado por el corte 0 el
  2026-09-08: el driver exporta la redacción reutilizable, la censura actúa por nombre de campo
  sobre cuerpos y cadenas de `cause`, y el manejador global registra el error descrito.

## Secuencia aprobada de trabajo

El orden responde a dependencias reales, no a la numeración:

1. **11.05, corte 0 — redacción, adelantado. Entregado el 2026-09-08.** 11.02 introduce los
   primeros endpoints que transportan un PIN en un cuerpo distinto al de login. La redacción y
   la prueba que la sostiene deben existir antes, no después. Es un corte pequeño y aislado; no
   adelanta el resto de 11.05.
2. **11.02 — roles, permisos y administración de identidad.** Es la dependencia de todo lo
   demás: hasta que existan roles distintos de `ADMIN`, ninguna prueba de separación de
   responsabilidades demuestra nada y ADR-0015 no cambia lo que ve ningún operador.
3. **11.03 — transporte y sesión.** Cierra host, cookie y suplantación. Va después de 11.02
   porque la prueba de configuración insegura gana valor cuando existen operadores con permisos
   distintos, y antes de 11.04 porque la protección en reposo no compensa un transporte
   abierto.
4. **11.04 — protección de datos en reposo.** Clasifica lo que 11.02 y 11.03 acaban de fijar
   como sensible, conecta el arranque real a la migración con respaldo y decide claves.
5. **11.05, cortes 1–4 — observabilidad segura.** Va al final porque correlaciona lo que las
   tres anteriores producen y porque su criterio incluye hacer visible el atraso de entrega,
   cuya corrección pertenece a las Fases 4, 5 y 6.

Son cortes internos, no sub-fases nuevas. No se renumera nada ni se declara implementado
trabajo futuro. La Fase 12 conserva la optimización medida y la Fase 8 sigue suspendida.

## Decisiones y restricciones antes de implementar

D1–D5 quedaron respondidas el 2026-09-08 en
[ADR-0027](../../architecture/adr/0027-administracion-de-identidad.md), aceptado: 11.02 ya no
está bloqueada por ellas. D7–D9 quedaron respondidas el mismo día en
[ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md), aceptado: 11.04 ya no
está bloqueada por decisiones, solo por implementación.
D6 conserva su identificador por trazabilidad, pero es una restricción ya
fijada por fuentes superiores y no bloquea 11.03. Los cortes independientes conservan los
prerrequisitos de sus planes.

### Cerradas para 11.02 por ADR-0027 el 2026-09-08

Las cinco decisiones tienen respuesta normativa en
[ADR-0027](../../architecture/adr/0027-administracion-de-identidad.md). Se resumen aquí para
trazabilidad; la fuente es el ADR.

- **D1 — siembra de roles.** Se siembran `CASHIER`, `SUPERVISOR`, `INVENTORY` y `MANAGER` con
  un conjunto sugerido y editable de permisos, sin asignarlos a ningún usuario. La siembra es
  punto de partida, no regla fija, conforme ADR-0012.
- **D2 — ciclo de vida del operador.** La desactivación es reversible, no existe eliminación,
  `operatorCode` nunca queda libre ni se reutiliza, y `actorId` es inmutable: la auditoría
  conserva la historia del operador desactivado. Desactivar incrementa `authorization_version`.
- **D3 — restablecimiento de PIN.** Dos caminos separados por permiso: caducar la credencial
  vigente con `identity.user.manage` y fijar un PIN temporal de un solo uso con
  `identity.credential.reset`, con motivo y auditoría. Todo operador cambia su propio PIN
  presentando el actual. Una credencial marcada para cambio produce una sesión restringida que
  solo puede cambiar el PIN o cerrar sesión (`AUTH_PIN_CHANGE_REQUIRED`).
- **D4 — último administrador y transición.** Administrador es el usuario activo cuyos permisos
  efectivos incluyen `identity.user.manage`; el bloqueo se evalúa dentro de la transacción del
  cambio con `BEGIN IMMEDIATE` y rechaza con `IDENTITY_LAST_ADMINISTRATOR`. Una base ya
  provisionada recibe los tres permisos de identidad por migración forward-only de datos sobre
  el rol `ADMIN`, idempotente, con incremento de `authorization_version` y sin tocar
  credenciales.
- **D5 — dueño de la identidad en LAN.** El coordinador es el nodo dueño; una instalación
  standalone es su propio coordinador. Una terminal con coordinador no compone los casos de uso
  de administración y falla con `IDENTITY_NOT_OWNED_BY_NODE`. Los cambios llegan por concesión,
  que no transporta credenciales.

La brecha de enrolamiento que ADR-0027 declaró quedó cerrada el 2026-09-08 por
[ADR-0028](../../architecture/adr/0028-enrolamiento-local-de-credenciales.md): la credencial
se materializa en el nodo donde se usa, mediante una autorización local de un solo uso, y
ningún secreto viaja entre nodos. ADR-0028 reemplaza además el PIN temporal que ADR-0027 D3
había previsto.

### Restricción vigente de 11.03

- **D6 — loopback obligatorio; no es una decisión pendiente.**
  [apps/server/AGENTS.md](../../../apps/server/AGENTS.md) y ADR-0026 D1 establecen que solo el
  listener técnico de sincronización se expone en LAN. La API de operadores conserva loopback;
  11.03 debe rechazar `SERVER_HOST` no loopback, incluso si existe material TLS. Una apertura
  futura requeriría cambiar las fuentes normativas aplicables, no solo ampliar ADR-0011 desde
  este plan. La falta de validación en código no reabre la decisión de arquitectura.

### Cerradas para 11.04 por ADR-0029 el 2026-09-08

Las tres decisiones tienen respuesta normativa en
[ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md). Se resumen aquí para
trazabilidad; la fuente es el ADR.

- **D7 — cifrado en reposo.** No se cifra el archivo SQLite operativo ni se adopta SQLCipher: en
  un servicio desatendido la clave estaría al alcance del mismo atacante que hoy puede leer el
  archivo, así que compraría una promesa y no una protección. La protección real es la ACL del
  directorio de datos verificada en arranque —fail closed— más cifrado AES-256-GCM de respaldos
  y secretos de configuración, con la clave custodiada por el almacén del sistema operativo y
  nunca junto al ciphertext. El ADR declara explícitamente lo que no protege.
- **D8 — retención.** Cinco respaldos de migración, 30 días de logs técnicos, 7 días de
  artefactos de diagnóstico, 30 días para sesiones cerradas y tickets de enrolamiento
  consumidos. `audit_log` no se purga: es evidencia. El acceso se limita a la cuenta de servicio
  y a los administradores locales.
- **D9 — rotación.** Rotan la clave de cifrado —anual o ante sospecha, conservando la anterior
  hasta que caduque el último respaldo que cifró— y el material TLS de LAN al vencer. La
  identidad de nodo no rota, porque es trazabilidad y no secreto; el PIN no caduca por tiempo y
  se caduca por decisión auditada. La rotación se ejecuta en la máquina y no se expone por HTTP.

### Redacción original de las preguntas D7–D9

- **D7 — cifrado en reposo.** ¿Se cifra el archivo SQLite —lo que implica una dependencia nueva
  del tipo SQLCipher y su justificación documentada—, o la protección se apoya en ACL del
  sistema de archivos más cifrado de respaldos y de secretos de configuración? AGENTS.md
  prohíbe agregar dependencias sin necesidad concreta y documentada.
- **D8 — retención.** Cuánto se conservan respaldos, logs técnicos y artefactos de diagnóstico,
  y quién puede leerlos. Hoy `createBackup` retiene cinco copias por defecto y nadie lo declaró
  como política.
- **D9 — rotación.** Qué material rota (identidad de nodo, material TLS de LAN, clave de
  respaldos), con qué periodicidad y bajo qué permiso. La tarea de probar rotación y
  recuperación de claves no es ejecutable sin esta respuesta.

### Registro normativo

D1–D5 quedaron registradas el 2026-09-08 en
[ADR-0027](../../architecture/adr/0027-administracion-de-identidad.md), aceptado, incluida la
transición de bases ya provisionadas; el enrolamiento de credenciales que aquel declaró
pendiente lo cierra
[ADR-0028](../../architecture/adr/0028-enrolamiento-local-de-credenciales.md), aceptado el
2026-09-08. D6 aplica AGENTS.md y ADR-0026 sin un ADR nuevo. D7–D9 quedaron registradas el
2026-09-08 en [ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md),
aceptado; escribirlo no completa 11.04, que sigue pendiente de implementación.
Primero el ADR, después la implementación: no se mantienen dos especificaciones independientes.

## Gates de ejecución que permanecen

Trabajo planificado, no preguntas pendientes:

- **Antes de habilitar cualquier alta de identidad:** el bloqueo de auto-exclusión, el
  incremento de `authorization_version` y la revocación de sesiones deben ser atómicos con el
  cambio que los provoca, probados bajo concurrencia sobre SQLite real.
- **Antes de cerrar 11.02:** una prueba de contrato por cada permiso que publican las pantallas
  de 9B. La visibilidad del renderer no es autorización, y ADR-0015 lo dice explícitamente.
  La deuda genérica de «venta» debe aclarar si pretende un permiso adicional para `CompleteSale`,
  cuyo contrato actual declara `permission: null`; probar `VoidSale` no resuelve esa ambigüedad.
- **Antes de cerrar cualquier sub-fase:** `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes. El
  punto 3 de la auditoría dejó `pnpm pipeline` como criterio de cierre de sub-fase.
- **Antes de declarar la fase cerrada:** el criterio de salida es que toda operación sensible
  exija identidad, permiso, auditoría y redacción de secretos. Un permiso aplicado sin decisión
  auditable no cumple ese criterio.

## Fuera de alcance de la Fase 11

La Fase 11 no absorbe reglas de caja, inventario, costeo ni sincronización. En concreto:

- La composición existente del consumidor de inventario para `SaleCompleted` pertenece a la
  Fase 6 y a ADR-0026. 11.05 hace visibles rechazos locales, atrasos y discrepancias de
  aplicación remota; no reimplementa el consumidor ni modifica sus reglas.
- El redondeo de costo al agotar existencia (punto 2) pertenece a 9B.04 y ADR-0016.
- El empaquetado reproducible de la estación (punto 4) pertenece a su fase propietaria. 11.03
  solo verifica la frontera de sesión y transporte dentro de ese arranque.
- La política de reconciliación de inventario offline (punto 8) pertenece a la Fase 10.
- El benchmark de crecimiento de la historia de inventario (punto 9) pertenece a la Fase 12.
