# Plan de ejecución 11.04: protección de datos en reposo

- Fecha: 2026-09-07.
- Estado: **completado el 2026-09-08**.
  D7–D9 quedaron respondidas
  en [ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md), aceptado, según la
  [secuencia y decisiones de Fase 11](./plan-secuencia-y-decisiones.md).
- Especificación: [11.04 Encriptacion](./11.04-encriptacion.md).
- Deuda de origen: [auditoría 2026-09-04](./auditoria-puntos-clave-2026-09-04.md), punto 5.
- Relación: el [gate de piloto y release](../gate-piloto-release.md) exige backup automático y
  ensayo de restauración; este plan produce la evidencia que ese gate consume.

## Objetivo y prerrequisitos

Que los datos sensibles estén clasificados con su política de retención y acceso, que el
arranque real no pueda migrar sin respaldo y validación, y que una actualización fallida deje
una base íntegra y recuperable sin exponer secretos.

Leer antes de implementar: AGENTS.md y el `AGENTS.md` de `packages/drivers/db` y `apps/server`;
arquitectura de persistencia; ADR-0003, ADR-0009 y ADR-0011; el ADR de protección de datos en
reposo que cierre D7–D9.

Antes de escribir código: D7–D9 respondidas. Lo están desde el 2026-09-08 en ADR-0029, cuyo
inventario se levantó sobre el árbol real y no sobre una intuición. El corte 1 se reduce a
publicar y enlazar esa clasificación donde gobierne, sin mantener una segunda copia.

## Línea base comprobada

Verificada sobre el árbol del 2026-09-07.

- **El driver ya sabe migrar con seguridad y nadie lo usa así.**
  `packages/drivers/db/src/migrations.ts:359` expone `migrateDatabase`, que crea un respaldo con
  `vacuum into`, lo abre y valida (`integrity_check` más `foreign_key_check`), aplica las
  migraciones y, si la validación falla, restaura el respaldo y lanza. `createBackup` conserva
  cinco copias por defecto y purga el resto.
- **El arranque real no lo usa.** `apps/server/src/runtime.ts:153` llama `applyMigrations`
  directamente sobre el handle abierto. La transacción individual de una migración no sustituye
  la recuperación de una actualización completa: si la 0043 deja la base inconsistente, no hay
  respaldo del que volver.
- **Los secretos ya viven en archivos, sin política declarada.** La identidad de nodo se lee de
  `node-identity.json` (`packages/drivers/security/src/index.ts:95`); el material TLS de LAN se
  lee de rutas declaradas por entorno (`apps/server/src/sync/lan-listener.ts`,
  `lan-client.ts`). ADR-0011 menciona una ACL local para la identidad; nada la verifica.
- **Las credenciales ya están protegidas en la base.** El PIN se guarda con scrypt y salt
  individual y el token de sesión solo como hash SHA-256. Eso no está en discusión aquí: lo que
  falta es la protección del archivo que los contiene y de sus copias.
- **No existe clasificación ni retención.** Ningún documento del repositorio declara qué datos
  son sensibles, cuánto se conservan los respaldos, quién puede leerlos ni qué pasa con los
  artefactos de diagnóstico.

## Corte 1: clasificación, retención y acceso

Corte documental con salida normativa, no una lista informal. Es el insumo de D7.

1. Inventariar y clasificar, como mínimo: el archivo SQLite operativo y sus `-wal`/`-shm`; los
   respaldos de `createBackup`; `node-identity.json`; el material TLS de cliente y listener; la
   tabla `identity_credentials` y `auth_sessions`; los artefactos de diagnóstico y logs
   técnicos; y cualquier exportación CSV que produzcan los reportes de 9B.
2. Para cada uno: qué contiene, quién debe poder leerlo, dónde vive, cuánto se conserva y qué
   pasa cuando caduca. La retención concreta la fija D8.
3. Declarar explícitamente lo que **no** se protege en el MVP y por qué. Una brecha declarada es
   trazable; una omitida se presenta luego como garantía inexistente.
4. La clasificación se publica donde gobierne —ADR o `docs/architecture/`— y el cronograma solo
   la enlaza. No se mantienen dos copias.

## Corte 2: el arranque real usa la ruta segura

Independiente de D7. Cierra la mitad más concreta del punto 5 de la auditoría.

1. Prueba primero: arrancar sobre una base que una migración deja inválida debe restaurar el
   respaldo, dejar la base íntegra y fallar con un código estable, sin abrir el servidor a medio
   migrar.
2. Cambiar `runtime.ts` para componer `migrateDatabase` con su directorio de respaldo, en lugar
   de `applyMigrations`. Es el cambio mínimo: el driver ya existe y no se duplica.
3. El directorio de respaldo y la retención se leen de configuración con un default explícito;
   una ruta no escribible aborta el arranque en vez de continuar sin respaldo.
4. Probar el caso feliz también: una migración correcta deja respaldo, aplica versiones y purga
   según retención. Un respaldo que nunca se creó no se descubre el día que hace falta.
5. Verificar que el respaldo se puede abrir y validar de forma independiente. `createBackup` ya
   lo hace; la prueba lo fija como garantía.

## Corte 3: claves y cifrado donde sea necesario

Depende de D7, ya respondida: **ADR-0029 D7.1 descartó cifrar el archivo SQLite** y eligió la
segunda vía, de modo que el punto 2 es el alcance real y el punto 1 queda como registro de la
alternativa descartada.

1. Si D7 elige cifrar el archivo SQLite: la dependencia nueva se justifica en el ADR con la
   necesidad concreta, se evalúa su efecto sobre migraciones, respaldos y `vacuum into`, y se
   prueba que una base cifrada sigue siendo migrable y restaurable. No se adopta por defecto.
2. Si D7 elige ACL más cifrado de respaldos y secretos: implementar y **verificar** la
   protección del archivo en el arranque —permisos efectivos, no supuestos—, cifrar los
   respaldos y los secretos de configuración, y fallar cerrado cuando la protección no se puede
   garantizar.
3. En cualquiera de los dos casos, el almacenamiento de claves es explícito: dónde vive la
   clave, quién la puede leer, qué pasa si falta. Una clave junto al dato que protege no es
   protección.
4. Ninguna clave, material TLS ni ruta de secreto aparece en logs, respuestas HTTP, IPC ni
   renderer. Se prueba, no se asume.

## Corte 4: rotación y recuperación

Depende de D9.

1. Rotar el material que D9 declare, con actor, terminal, timestamp y motivo, y con el permiso
   que corresponda: es una operación sensible.
2. Probar que tras rotar, lo cifrado con material anterior sigue siendo recuperable, o que el
   procedimiento de migración de material existe y está probado. Una rotación que inutiliza los
   respaldos anteriores es pérdida de datos, no seguridad.
3. Probar el ensayo de restauración completo con datos representativos, que es lo que el gate de
   piloto exige: respaldo, restauración, arranque y operación posterior.
4. Verificar que ni el respaldo ni su restauración exponen secretos —material TLS, claves,
   PINs— a quien pueda leer el archivo restaurado sin autorización.

## Criterios de aceptación

Evidencia automatizada: `protected-storage.integration.test.ts` cubre migración segura,
respaldo AES-256-GCM, restauración, rechazo de TLS plano y conservación de respaldos con claves
anteriores; `secret-vault.test.ts` y `data-directory.test.ts` fijan custodia y ACL; las pruebas
de retención y rotación cubren purga y evidencia auditable. La pérdida del almacén del sistema
operativo sigue siendo irrecuperable por decisión expresa de ADR-0029.
La rotación operativa y la dependencia de confianza TLS están documentadas en
[rotación de material protegido](../../operacion/rotacion-material-protegido.md); la emisión y
distribución concretas continúan subordinadas a la PKI aprobada para cada instalación.

- [x] CA-11.04-01: D7–D9 están respondidas y registradas en un ADR aceptado antes de implementar
  los cortes 3 y 4 (ADR-0029, 2026-09-08).
- [x] CA-11.04-02: existe una clasificación publicada de datos sensibles con retención y acceso por
  cada elemento del inventario, y las brechas no cubiertas están declaradas.
- [x] CA-11.04-03: el arranque real migra por la ruta con respaldo, validación y restauración; una
  migración inválida restaura y aborta con código estable sin abrir el servidor.
- [x] CA-11.04-04: un directorio de respaldo no escribible aborta el arranque en vez de continuar
  sin respaldo.
- [x] CA-11.04-05: una migración correcta deja respaldo verificable, aplica versiones y purga según
  la retención declarada.
- [x] CA-11.04-06: el cifrado y el almacenamiento de claves que D7 decida están implementados,
  auditables y probados; una base o respaldo protegido sigue siendo migrable y restaurable.
- [x] CA-11.04-07: ninguna clave, material TLS ni ruta de secreto aparece en logs, respuestas, IPC
  ni renderer; hay prueba automatizada.
- [x] CA-11.04-08: la rotación de material deja evidencia auditable y no inutiliza lo cifrado
  anteriormente sin un procedimiento probado.
- [x] CA-11.04-09: el ensayo de respaldo y restauración con datos representativos está automatizado
  o documentado como procedimiento reproducible, y no expone secretos.
- [x] CA-11.04-10: `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes; la especificación 11.04, el
  gate de piloto y el registro de auditoría reflejan lo entregado.

## Superficies y límites

Migración segura y respaldo en `packages/drivers/db`, que ya los implementa y no se duplica;
composición del arranque en `apps/server/src/runtime.ts`; lectura y protección de material en
`packages/drivers/security`; clasificación y retención en `docs/architecture/` o su ADR.

Fuera de alcance: cambiar el esquema de credenciales de ADR-0011; sustituir SQLite; añadir
almacenamiento remoto de secretos; el empaquetado del instalador; y la observabilidad de los
respaldos, que es de 11.05.
