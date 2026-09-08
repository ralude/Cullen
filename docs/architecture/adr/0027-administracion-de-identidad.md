# ADR-0027: Administración de identidad — siembra de roles, ciclo de vida, PIN y ownership

- Estado: Aceptado
- Fecha: 2026-09-08
- Actualizado por [ADR-0028](./0028-enrolamiento-local-de-credenciales.md) el 2026-09-08: el
  camino de PIN temporal de D3 queda reemplazado por el enrolamiento local de credenciales.

## Contexto

La Fase 11 llegó a 11.02 con identidad modelada y persistida pero sin ningún camino para
administrarla. `ProvisionInitialAdmin` es el único escritor: crea el rol `ADMIN` con las 50
constantes de permiso y se niega con `AUTH_ALREADY_PROVISIONED` si ya existe un operador. No
hay contrato, ruta ni pantalla de identidad; nada incrementa
`identity_users.authorization_version`, así que el mecanismo de revocación por cambio de
autorización existe sin disparador. El único rol que existe es `ADMIN`, de modo que ADR-0015 no
cambia hoy lo que ve ningún operador y las pantallas de la Fase 9B no demuestran separación real
de responsabilidades.

El [plan de la Fase 11](../../cronograma/fase-11-seguridad/plan-secuencia-y-decisiones.md) dejó
cinco decisiones abiertas (D1–D5) que bloquean 11.02 y que no pueden inventarse durante la
implementación. Este ADR las responde. No amplía ADR-0011 —autenticación por PIN y sesiones
locales—, ADR-0012 —permisos configurables por rol— ni ADR-0026 —el coordinador como autoridad
de las concesiones de operador—: se apoya en los tres.

Aplica al MVP de referencia no certificado
([ADR-0021](./0021-mvp-referencia-no-certificado.md)). No certifica seguridad: fija reglas de
negocio de identidad y sus invariantes.

## Decisión

### D1. Siembra de roles operativos

El sistema siembra cuatro roles además de `ADMIN`: `CASHIER`, `SUPERVISOR`, `INVENTORY` y
`MANAGER`, cada uno con un conjunto sugerido de permisos. La siembra es un **punto de partida
editable**, no una regla fija: ADR-0012 declara las asignaciones configurables, así que un
administrador puede añadir permisos, quitarlos o desactivar cualquiera de estos roles. El
conjunto sugerido es:

| Rol | Permisos sembrados |
|---|---|
| `CASHIER` | `cash.shift.open`, `cash.shift.close`, `cash.shift.read`, `cash.movement.income`, `fiscal.document.issue`, `sale.history.read` |
| `SUPERVISOR` | los de `CASHIER` más `sale.apply_discount`, `sale.void`, `sale.return`, `cash.movement.withdrawal`, `cash.shift.close.difference`, `cash.shift.read.any`, `fiscal.report.x`, `fiscal.report.z`, `reports.cash.read`, `reports.sales.read` |
| `INVENTORY` | `inventory.purchase.receive`, `inventory.waste.register`, `inventory.adjust`, `inventory.count.perform`, `inventory.count.read`, `inventory.kardex.read`, `purchase_receipt.read`, `purchase_receipt.start`, `purchase_receipt.complete`, `supplier.read`, `reports.inventory.read` |
| `MANAGER` | `catalog.product.create`, `catalog.product.update`, `catalog.price.update`, `currency.rate.update`, `inventory.count.approve`, `purchase_receipt.reverse`, `supplier.create`, `supplier.update`, `fiscal.reconcile`, `config.cash_register.manage`, `config.payment_method.manage`, `reports.cash.read`, `reports.sales.read`, `reports.inventory.read`, `reports.margin.read`, `reports.fiscal.read` |

Ningún rol sembrado recibe permisos de identidad, de sincronización, de configuración de nodo o
sucursal, ni `reports.audit.read`, ni `supplier.tax_identity.correct`: quedan en `ADMIN` hasta
que un administrador decida otra cosa. Completar una venta no aparece porque `CompleteSale`
exige sesión válida y no un permiso (`permission: null` en su contrato); este ADR no lo cambia.

La siembra crea los roles **sin asignarlos a ningún usuario**: un rol sin portadores no concede
nada. Ocurre en el aprovisionamiento inicial para bases nuevas y en la transición de D4 para
bases ya provisionadas, en ambos casos de forma idempotente: un rol cuyo código ya existe no se
sobrescribe ni se le reponen permisos que un administrador haya quitado.

### D2. Ciclo de vida del operador

- **La desactivación es reversible.** `User.activate`/`deactivate` ya existen en el dominio y
  ambas transiciones están permitidas. Desactivar no borra: no existe eliminación de operadores.
- **`operatorCode` no se reutiliza.** Es único y, como ningún operador se borra, un código nunca
  queda libre. Reactivar al mismo operador es la operación prevista para quien vuelve.
- **`actorId` es inmutable y la auditoría conserva su historia** bajo el mismo identificador,
  esté el operador activo o no. Desactivar retira el acceso; nunca reescribe evidencia pasada.
- Desactivar incrementa `authorization_version` del operador, de modo que sus sesiones vivas
  quedan invalidadas por el mecanismo que ya existe.

### D3. Restablecimiento de PIN

Existen dos caminos, separados por permiso, y ninguno viola ADR-0011: el PIN nunca se registra,
se devuelve ni se muestra.

1. **Caducar la credencial vigente** (`identity.user.manage`). El operador conserva su PIN
   actual, ingresa con él y la sesión resultante solo puede cambiar el PIN. Es la rotación
   ordinaria: no crea un momento en el que un tercero conozca la credencial.
2. **Enrolamiento de credencial** (`identity.credential.reset`, permiso nuevo y distinto del
   anterior). Para el operador que olvidó su PIN o que todavía no tiene credencial en ese
   nodo. [ADR-0028](./0028-enrolamiento-local-de-credenciales.md) reemplazó aquí el PIN
   temporal que este ADR había previsto: el administrador autoriza con motivo y auditoría, y
   el propio operador establece su PIN en el nodo. Ningún tercero conoce la credencial.
3. **Cambio propio.** Cualquier operador cambia su propio PIN presentando el actual. Exige
   sesión válida y ningún permiso adicional.

Una credencial marcada para cambio produce una **sesión restringida**: `SessionResponse` publica
que el cambio es obligatorio y el servidor rechaza toda petición autenticada que no sea cambiar
el PIN o cerrar sesión, con el código estable `AUTH_PIN_CHANGE_REQUIRED`. La restricción se
aplica en el punto único donde el nodo resuelve el principal, no repetida por ruta. La
visibilidad del renderer no la sustituye.

### D4. Último administrador y transición de bases ya provisionadas

- **Definición.** Es administrador el usuario activo cuyos permisos efectivos —la unión de los
  permisos activos de sus roles activos, la misma que publica ADR-0015— incluyen
  `identity.user.manage`. Ningún cambio puede dejar el sistema sin al menos uno así.
- **Evaluación.** El bloqueo se evalúa **dentro de la misma transacción** que el cambio, con
  `BEGIN IMMEDIATE`, como ya hace el resto del store de autenticación. No es una validación
  previa: dos administradores que se retiran el permiso a la vez no pueden dejar el sistema
  descubierto. El rechazo usa el código estable `IDENTITY_LAST_ADMINISTRATOR`.
- **Alcance.** Cubre retirar el permiso, quitar el rol que lo concede, desactivar al usuario y
  desactivar o vaciar de permisos el rol que lo concede. La regla es sobre el efecto, no sobre
  la forma del comando.
- **Transición.** Los permisos `identity.user.manage`, `identity.role.manage` e
  `identity.credential.reset` llegan a una base ya provisionada mediante una **migración
  forward-only de datos**, no repitiendo el bootstrap —que devolvería
  `AUTH_ALREADY_PROVISIONED`— ni exigiendo un permiso que el administrador todavía no posee. La
  migración:
  - concede los tres permisos al rol `ADMIN` creado por `ProvisionInitialAdmin`, identificado
    por su código, y a ningún otro destinatario;
  - siembra los cuatro roles de D1 que falten, sin asignarlos a nadie;
  - incrementa `authorization_version` de los usuarios afectados en la misma transacción;
  - es idempotente —repetirla no duplica asignaciones ni evidencia— y revierte entera si falla;
  - no crea usuarios, no toca credenciales y no altera `actorId` ni historia de auditoría.

### D5. Dueño de la identidad en la LAN

- **El coordinador es el nodo dueño del agregado de identidad.** Los operadores y los roles se
  crean y modifican allí. Es coherente con la frontera universal de un único nodo dueño por
  agregado y con ADR-0026, que ya hace del coordinador la autoridad de las concesiones.
- **Una instalación standalone es su propio coordinador** y administra su identidad sin
  restricción: es el despliegue de un solo nodo, no una excepción a la regla.
- **Una terminal con coordinador no compone los casos de uso de administración de identidad.**
  El intento falla cerrado con el código estable `IDENTITY_NOT_OWNED_BY_NODE`, no con un error
  genérico, y la pantalla explica que la administración vive en el coordinador.
- **Los cambios llegan a las terminales por concesión**, con el mecanismo ya implementado en la
  Fase 10: `OperatorGrantPublished` transporta `roleCodes`, `permissionCodes`, `isActive` y su
  versión monotónica; la terminal los proyecta en `identity_operator_grant` y la concesión
  gobierna los permisos del operador en esa terminal. **No se sincronizan PINs, hashes de
  credencial, tokens ni sesiones**, como ADR-0026 ya prohíbe.

## Consecuencias

- 11.02 puede implementar `CreateOperator`, `UpdateOperator`, `ChangeOperatorStatus`,
  `AssignOperatorRoles`, `CreateRole`, `UpdateRolePermissions` y `ChangeRoleStatus` sin inventar
  reglas: cada una tiene aquí su invariante, su permiso y su código de error.
- El catálogo de permisos de aplicación crece de 50 a 53 con `identity.user.manage`,
  `identity.role.manage` e `identity.credential.reset`. Son parte del contrato estable y sus
  contratos HTTP los declaran, con la prueba de cruce que ya existe.
- La sesión gana un estado nuevo —cambio de PIN obligatorio— que el renderer debe atender. Es
  la única restricción de sesión que este ADR agrega; los límites idle y absoluto de ADR-0011 y
  la vigencia de concesión de ADR-0026 siguen aplicándose sin cambio.
- Los roles sembrados hacen visible el efecto de ADR-0015: un cajero deja de ver la navegación
  completa y el servidor sigue rechazando lo que la interfaz oculta. El conjunto sugerido es
  una propuesta operativa revisable, no una política de seguridad certificada.
- **Brecha declarada, no resuelta aquí:** un operador creado en el coordinador no obtiene por sí
  solo una credencial local en otra terminal, porque la concesión no transporta credenciales y
  ADR-0026 mantiene controlada la provisión local. Puede ingresar en el nodo donde su credencial
  existe. El enrolamiento de credenciales entre nodos no está especificado y no se resuelve en
  11.02: requiere su propia decisión normativa en la fase que lo asuma. No presentar la
  concesión como si habilitara el ingreso en una terminal nueva.
- La migración de transición es forward-only y se suma a la cadena existente; el arranque real
  debe seguir la ruta de migración con respaldo que 11.04 conectará.
