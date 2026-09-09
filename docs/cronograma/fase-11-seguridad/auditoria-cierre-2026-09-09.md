# Registro de auditoría de cierre — 2026-09-09

- **Fase relacionada:** Fase 11 — Seguridad
- **Estado:** cuatro hallazgos P1 corregidos el 2026-09-09; siete —seis P2 y un P3— siguen
  abiertos y bloquean la certificación de la fase
- **Alcance:** revisión focal de los recorridos que la Fase 11 declara cerrados —enrolamiento y
  revocación de credenciales, protección de datos en reposo, transporte de sesión, redacción y
  diagnóstico operativo—. No es una auditoría exhaustiva del árbol ni una certificación de
  seguridad.

## Resultado ejecutivo

La Fase 11 no debe certificarse todavía. Los cuatro hallazgos de prioridad alta afectaban
garantías que la fase declara cumplidas: la revocación de una concesión dejaba de aplicarse
después del primer enrolamiento, la rotación de claves podía destruir material sin evidencia, el
diagnóstico podía bloquearse minutos justo cuando el coordinador está caído y el almacén de
claves se sobrescribía sin publicación atómica. Los cuatro quedaron corregidos con prueba propia.

Los siete restantes no destruyen ni exponen material por sí solos, pero contradicen contratos
declarados —el estado `NEEDS_ENROLLMENT` de ADR-0028, el aislamiento por destino, los códigos de
error estables y la higiene de secretos en memoria y en logs— y deben cerrarse antes de dar la
fase por certificada.

## Evidencia de la auditoría

- `pnpm lint`, `pnpm typecheck` y `pnpm test`: aprobados el 2026-09-09 con 1.197 pruebas en 189
  archivos, ya con las correcciones P1 aplicadas.
- Cada corrección P1 incorpora la prueba que reproduce el defecto y falla sin el fix.

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

## Hallazgos abiertos

Ninguno tiene todavía corrección ni prueba. El orden es de prioridad, no de ejecución.

### P2-5. El diagnóstico de entrantes no se filtra por destino

- **Evidencia:** `packages/drivers/db/src/operational-diagnostics.ts:123` selecciona los efectos
  entrantes sin acotar por `destinationNodeId`; una terminal puede mostrar incidencias de otras.
- **Dueño:** 11.05, con el aislamiento local de
  [ADR-0023](../../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md).
- **Criterio:** una prueba con dos destinos debe demostrar que cada uno solo ve lo suyo.

### P2-6. El directorio omite las concesiones sin credencial local

- **Evidencia:** `packages/drivers/db/src/identity-administration-store.ts:51` lista solo
  `identity_users`, de modo que la UI no puede representar el estado `NEEDS_ENROLLMENT` que exige
  ADR-0028.
- **Dueño:** 11.02.
- **Criterio:** el directorio incluye al operador concedido y todavía sin credencial local, y la
  pantalla lo distingue de un operador local sin credencial.

### P2-7. Una cookie de sesión mal formada responde 500 en vez de 401

- **Evidencia:** `apps/server/src/session-transport.ts:68` llama `decodeURIComponent()` sin
  contener el `URIError`; `pos_session=%` termina como error de servidor.
- **Dueño:** 11.03; contradice los códigos estables de
  [11-errores](../../architecture/11-errores.md).
- **Criterio:** una sesión inválida —ausente, mal formada o desconocida— responde siempre 401 sin
  distinguir la causa.

### P2-8. PIN y token de enrolamiento permanecen en memoria tras un fallo

- **Evidencia:** `apps/desktop/src/renderer/src/screens/credential.tsx:54` limpia el estado solo
  en el camino de éxito; ante un fallo el PIN y el token siguen en el estado React, contra el
  corte 3.5 de 11.02.
- **Dueño:** 11.02.
- **Criterio:** el secreto se limpia también en el camino de error, sin perder el mensaje que el
  operador necesita para reintentar.

### P2-9. Un staging en claro sobrevive si abrir o validar el respaldo falla

- **Evidencia:** `packages/drivers/db/src/backup.ts:80` abre y valida el staging antes de que
  exista el `finally` que lo borra; un fallo ahí deja una copia completa de la base en texto claro.
- **Dueño:** 11.04, con la protección de respaldos de
  [ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.3.
- **Criterio:** ninguna ruta de fallo deja el intermedio en claro cuando hay protección declarada.

### P2-10. La redacción no cubre rutas de claves en `message`, `stack` ni `cause`

- **Evidencia:** `packages/drivers/logging/src/redaction.ts:130` censura asignaciones sensibles,
  pero conserva rutas de claves o certificados incrustadas en el texto libre del error,
  incumpliendo CA-11.04-07 y CA-11.05-02.
- **Dueño:** 11.05.
- **Criterio:** un error de infraestructura que nombra la ruta del almacén de claves no deja esa
  ruta en la línea de log.

### P3-11. Autorización por rol deja una denegación falsa en la auditoría

- **Evidencia:** `packages/core/src/application/identity/role-use-cases.ts:184` consulta primero
  `identity.user.manage`; un usuario autorizado solo por `identity.role.manage` obtiene acceso,
  pero deja registrada una entrada `AUTHORIZATION_DENIED` que no corresponde a ninguna decisión.
- **Dueño:** 11.02.
- **Criterio:** la evidencia de autorización refleja la decisión efectiva; una comprobación
  intermedia no se registra como denegación.

## Regla de seguimiento

Se aplica la misma regla del
[registro focal del 2026-09-04](./auditoria-puntos-clave-2026-09-04.md): un hallazgo se marca
cerrado cuando existen la corrección, su prueba y la evidencia end-to-end de su fase propietaria,
no por tener una prueba unitaria. Mientras quede un hallazgo abierto, la Fase 11 no se presenta
como certificada.
