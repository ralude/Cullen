# Registro de auditoría de cierre — 2026-09-09

- **Fase relacionada:** Fase 11 — Seguridad
- **Estado:** los once hallazgos quedaron corregidos el 2026-09-09, cada uno con su prueba. No
  queda ninguno abierto por esta auditoría
- **Alcance:** revisión focal de los recorridos que la Fase 11 declara cerrados —enrolamiento y
  revocación de credenciales, protección de datos en reposo, transporte de sesión, redacción y
  diagnóstico operativo—. No es una auditoría exhaustiva del árbol ni una certificación de
  seguridad.

## Resultado ejecutivo

La auditoría abrió once hallazgos y los once quedaron cerrados el mismo día. Los cuatro de
prioridad alta afectaban garantías que la fase declaraba cumplidas: la revocación de una concesión
dejaba de aplicarse después del primer enrolamiento, la rotación de claves podía destruir material
sin evidencia, el diagnóstico podía bloquearse minutos justo cuando el coordinador está caído y el
almacén de claves se sobrescribía sin publicación atómica.

Los seis P2 y el P3 no destruían ni exponían material por sí solos, pero contradecían contratos
declarados —el estado `NEEDS_ENROLLMENT` de ADR-0028, el aislamiento por destino, los códigos de
error estables, la higiene de secretos en memoria y en logs, y la evidencia de autorización—.

Cerrar esta auditoría no certifica la Fase 11 por sí solo: la certificación sigue dependiendo del
criterio de salida de la fase y del gate de piloto, que conserva sus propias deudas abiertas.

## Evidencia de la auditoría

- `pnpm lint`, `pnpm typecheck` y `pnpm test`: aprobados el 2026-09-09 con 1.210 pruebas en 191
  archivos, ya con las once correcciones aplicadas.
- Cada corrección incorpora la prueba que reproduce el defecto y falla sin el fix.

## Hallazgos corregidos

### P1-1. La revocación de una concesión dejaba de aplicarse tras el primer enrolamiento

- **Evidencia:** `enrollableOperator` devolvía la identidad local sin revalidar
  `identity_operator_grant`, de modo que un ticket pendiente o un restablecimiento posterior
  seguía consumiéndose después de vencer o revocar la concesión, contra
  [ADR-0028 D9](../../architecture/adr/0028-enrolamiento-local-de-credenciales.md).
- **Cierre:** la vigencia se evalúa una sola vez en
  `packages/drivers/db/src/operator-grant.ts`, con la marca de agua durable que ya gobernaba la
  autorización de sesiones (ADR-0026 D5). Una concesión que gobierna al operador manda aunque
  exista fila local; sin concesión —nodo standalone o coordinador— manda la identidad local.
- **Prueba:** `identity-administration.integration.test.ts`, «stops enrolling once the grant is
  revoked, also after the first enrollment». Commit `46251cc`.

### P1-2. La rotación de claves podía aplicarse sin dejar auditoría

- **Evidencia:** `rotate()` y `forget()` corrían antes de abrir la transacción que escribe la
  auditoría: un fallo de SQLite devolvía error con las claves ya rotadas o eliminadas y sin
  registro, incumpliendo CA-11.04-08.
- **Cierre:** el almacén de claves y la base son recursos distintos que ninguna transacción cubre
  juntos, así que el orden es la garantía. La rotación —aditiva— y el registro de lo que se
  retira se confirman primero; solo después se olvida el material sin referencias. Un fallo de
  auditoría deja el almacén completo y basta repetir el procedimiento, como recoge el
  [runbook de rotación](../../operacion/rotacion-material-protegido.md).
- **Prueba:** `rotate-protected-material.test.ts`, «no olvida ninguna clave cuando la evidencia no
  llega a confirmarse». Commit `321e27b`.

### P1-3. El diagnóstico podía bloquearse unos 500 segundos con el coordinador caído

- **Evidencia:** `GetOperationalDiagnostics` consultaba secuencialmente hasta cincuenta eventos
  con el timeout de transporte de diez segundos por consulta.
- **Cierre:** las consultas remotas comparten un presupuesto total, leído del reloj antes de cada
  una. Agotado, las ventas restantes se declaran `APPLICATION_UNKNOWN`, que es exactamente lo que
  significa no haber podido preguntar; ninguna cuenta como aplicada.
- **Prueba:** `operational-diagnostics.test.ts`, «acota lo que espera al coordinador y no confunde
  no preguntar con aplicado». Commit `7a17f52`.

### P1-4. El vault se sobrescribía sin publicación atómica

- **Evidencia:** `FileSecretVault.write` escribía directamente sobre el único `node-keys.json`;
  una caída durante bootstrap, rotación o purga podía truncarlo y volver irrecuperables el nodo y
  los respaldos cifrados con sus claves.
- **Cierre:** el contenido nuevo se escribe completo en un intermedio del mismo directorio, se
  fuerza a disco y recién entonces sustituye al publicado con un renombrado. Una publicación
  fallida deja el almacén anterior intacto y sin intermedios.
- **Prueba:** `secret-vault.test.ts`, «conserva el almacén publicado cuando la publicación no
  puede completarse». Commit `a463048`.

### P2-5. El diagnóstico de entrantes no se filtraba por destino

- **Evidencia:** la lectura de efectos entrantes no acotaba por `destinationNodeId`; un
  coordinador que atiende varias terminales sobre la misma base mostraba en una las incidencias
  de otra, contra el aislamiento local de
  [ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md).
- **Cierre:** cada consulta describe la conversación con un solo nodo —lo entregado a él y lo
  recibido de él—, así que los entrantes se filtran por el nodo de origen del evento, que es el
  que la propia lectura reporta.
- **Prueba:** `operational-diagnostics.integration.test.ts`, «solo devuelve los efectos entrantes
  del nodo consultado». Commit `00eab51`.

### P2-6. El directorio omitía las concesiones sin credencial local

- **Evidencia:** el directorio listaba solo `identity_users`, de modo que un operador conocido
  únicamente por la concesión del coordinador no aparecía y la interfaz no podía representar el
  estado que ADR-0028 D1 obliga a distinguir.
- **Cierre:** el directorio incluye las concesiones utilizables sin fila local, marcadas con
  `hasLocalIdentity: false`. La pantalla las distingue del operador local sin credencial y no
  ofrece editar una identidad que esta terminal no administra; el enrolamiento, que sí es local,
  sigue disponible. Una concesión vencida deja de listarse: ya no describe a nadie en el nodo.
- **Prueba:** `identity-administration.integration.test.ts`, «publishes the granted operator that
  has no local identity yet» y «stops listing the grant separately once the operator enrolls
  locally»; `identity-screen.interaction.test.tsx`, «distingue al operador concedido del operador
  local sin credencial». Commit `a10df61`.

### P2-7. Una cookie de sesión mal formada respondía 500 en vez de 401

- **Evidencia:** `sessionTokenOf` llamaba `decodeURIComponent()` sin contener el `URIError`;
  `pos_session=%` terminaba como error de servidor, contra los códigos estables de
  [11-errores](../../architecture/11-errores.md).
- **Cierre:** una cookie ilegible es una credencial inválida, no un fallo del nodo: se trata como
  sesión ausente, de modo que ausente, ilegible y desconocida comparten la misma respuesta 401.
- **Prueba:** `node-boundary.contract.test.ts`, «trata una cookie de sesión ilegible como sesión
  ausente». Commit `1080608`.

### P2-8. PIN y token de enrolamiento permanecían en memoria tras un fallo

- **Evidencia:** las dos pantallas de credencial limpiaban su estado solo en el camino de éxito;
  ante un fallo el PIN y el código de un solo uso seguían en el estado del renderer, contra el
  corte 3.5 de 11.02.
- **Cierre:** la limpieza pasa al `finally`, de modo que el secreto no sobrevive al envío salga
  bien o mal. El mensaje del fallo sí se conserva: sin él el operador no sabría qué reintentar.
- **Prueba:** `identity-screen.interaction.test.tsx`, «no conserva el PIN en pantalla cuando el
  cambio falla» y el cierre del código vencido. Commit `b3a72a8`.

### P2-9. Un staging en claro sobrevivía si abrir o validar el respaldo fallaba

- **Evidencia:** solo el sellado tenía `finally`; un fallo al abrir o validar el intermedio
  dejaba publicada una copia completa de la base en texto claro, justo lo que la protección de
  [ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.3 existe para
  impedir.
- **Cierre:** el borrado cubre cualquier salida del respaldo protegido. La copia sin protección
  declarada conserva su comportamiento: ahí el archivo no es un intermedio sino el respaldo mismo.
- **Prueba:** `backup.test.ts`, «no deja la copia en claro cuando el intermedio no puede
  validarse». Commit `0528e7c`.

### P2-10. La redacción no cubría rutas de claves en `message`, `stack` ni `cause`

- **Evidencia:** la redacción actuaba sobre asignaciones sensibles, pero un error del sistema
  —`ENOENT ... open 'C:\Cullen\keys\node-keys.json'`— publica dónde vive la clave sin tener forma
  de asignación, incumpliendo CA-11.04-07 y CA-11.05-02.
- **Cierre:** el texto libre censura la ruta que apunta a material protegido: la que vive en un
  directorio de material, la que lo declara por extensión y la que nombra un secreto en un
  archivo de datos. Una ruta que no apunta a material —la base del nodo, un archivo de código en
  un stack— se conserva, porque es lo que permite diagnosticar.
- **Prueba:** `redaction.test.ts`, «censors the path of protected material...» y «censors a
  protected path inside the message, the stack and the cause chain». Commit `c9e42eb`.

### P3-11. La autorización por rol dejaba una denegación falsa en la auditoría

- **Evidencia:** `GetIdentityDirectory` consultaba primero `identity.user.manage` y solo después
  `identity.role.manage`; quien administra roles obtenía acceso y, aun así, la auditoría
  registraba una entrada `AUTHORIZATION_DENIED` que no corresponde a ninguna decisión.
- **Cierre:** el puerto de autorización admite alternativas —una decisión que varios permisos
  pueden satisfacer— y la evidencia sigue siendo una sola: ninguna entrada si alguna alcanza, y
  una que las nombra a todas si ninguna lo hace. Es la misma notación que los contratos HTTP ya
  usaban para este caso.
- **Prueba:** `authorization-audit.contract.test.ts`, «does not audit a denial for a decision that
  another permission authorizes» y «records one denial when no permission of the decision
  authorizes it»; `audited-authorization.test.ts`, «records one denial for a decision that several
  permissions could authorize». Commit `a332608`.

## Regla de seguimiento

Se aplica la misma regla del
[registro focal del 2026-09-04](./auditoria-puntos-clave-2026-09-04.md): un hallazgo se marca
cerrado cuando existen la corrección, su prueba y la evidencia end-to-end de su fase propietaria,
no por tener una prueba unitaria. Este registro queda cerrado; el estado de la fase y del gate de
piloto sigue viviendo únicamente en el [cronograma](../README.md).
