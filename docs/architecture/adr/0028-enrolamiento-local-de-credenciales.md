# ADR-0028: Enrolamiento local de credenciales entre nodos

- Estado: Aceptado
- Fecha: 2026-09-08
- Complementa: [ADR-0011](./0011-autenticacion-pin-y-sesiones-locales.md),
  [ADR-0026](./0026-lan-operativa-y-recuperacion-entre-nodos.md) y
  [ADR-0027](./0027-administracion-de-identidad.md), cuyo punto D3 actualiza.

## Contexto

[ADR-0027](./0027-administracion-de-identidad.md) declaró una brecha y no la resolvió: el
coordinador es dueño de la identidad y publica concesiones con roles, permisos y estado, pero
**la concesión no transporta credenciales**. ADR-0026 lo prohíbe explícitamente —«no sincronizar
PINs, tokens, sesiones o secretos»— y ADR-0011 guarda el PIN solo como hash scrypt local.

El efecto operativo es concreto: un operador dado de alta en el coordinador llega a una terminal
con identidad, roles y permisos utilizables, y aun así no puede ingresar allí, porque
`findByOperatorCode` une `identity_users` con `identity_credentials` y en esa terminal no existe
ninguna de las dos filas. Hoy no hay ningún camino para crearlas sin repetir el bootstrap.

ADR-0027 D3 previó para el operador que olvida su PIN un «PIN temporal» fijado por un
administrador. Esa vía resuelve el olvido pero deja a un tercero conociendo una credencial
ajena durante una ventana, y no resuelve el alta en otra terminal. Este ADR la sustituye por un
mecanismo que cubre ambos casos sin que nadie más que el operador conozca su PIN.

Aplica al MVP de referencia no certificado
([ADR-0021](./0021-mvp-referencia-no-certificado.md)).

## Decisión

### D1. La credencial se materializa donde se usa

Identidad y autorización viajan del coordinador a la terminal por concesión. **La credencial
no viaja nunca.** No se transportan, ni dentro de un evento, ni de una concesión, ni del outbox,
ni del ledger: PIN, hash de PIN, salt, parámetros de derivación, token de sesión, ticket de
enrolamiento en claro ni ninguna credencial cifrada disfrazada de dato de negocio.

Una concesión de operador **no implica** que exista credencial local. Son dos hechos distintos y
la interfaz debe distinguirlos: un operador puede existir, estar activo y tener permisos en una
terminal donde todavía no puede iniciar sesión.

### D2. Enrolamiento local en dos pasos

La credencial local se crea en el nodo donde se usará, en dos pasos separados por actor:

1. **Autorización.** Un operador autenticado *en ese nodo* con permiso
   `identity.credential.reset` autoriza el enrolamiento de un operador objetivo, con motivo
   obligatorio. El objetivo debe ser conocido por el nodo: una fila local en `identity_users`, o
   una **concesión utilizable** publicada por el coordinador —vigente y activa—. Si no lo es, la
   autorización falla cerrado con `IDENTITY_OPERATOR_NOT_FOUND`; conocer un `operatorCode` no
   crea identidad.
2. **Consumo.** El operador objetivo establece su PIN en ese mismo nodo presentando el ticket. El
   PIN entra una sola vez, se deriva con scrypt allí y la credencial se guarda allí. El
   administrador nunca lo conoce, no lo elige y no puede recuperarlo.

La autoridad de la operación es doble y ninguna de las dos partes basta sola: el coordinador
declara *quién es* el operador y si sigue activo; el administrador local declara *que puede
enrolar en este nodo*. Un nodo que nunca recibió la concesión de un operador no puede enrolarlo,
aunque su administrador lo quiera.

### D3. El ticket de enrolamiento

- Es un token opaco aleatorio de 256 bits, generado con el mismo servicio que las sesiones de
  ADR-0011. La base guarda **solo su SHA-256**; el valor en claro se entrega una vez a quien
  autoriza y no vuelve a existir.
- Está ligado a `operatorCode`, `originNodeId` y `terminalId`. Un ticket de otro nodo no existe
  en esta base, y uno restaurado desde una copia ajena falla por identidad de nodo.
- Vence a los **15 minutos** de emitirse. Reemitir no renueva un ticket anterior: cada
  autorización crea el suyo y los anteriores del mismo operador quedan invalidados.
- Es de **un solo uso**: el consumo marca `consumed_at` en la misma transacción que escribe la
  credencial. Un segundo intento con el mismo token falla cerrado.
- No contiene el PIN, no lo transporta y no lo puede reconstruir.

### D4. Efecto del consumo

Dentro de una única transacción `BEGIN IMMEDIATE`:

- si el operador no tiene fila local, se crea con un identificador generado por la aplicación,
  el `operatorCode` y el nombre que publicó la concesión, activo y con versión de autorización
  inicial. **No se copian roles ni permisos locales**: mientras exista concesión utilizable, ella
  es la autoridad de ese operador en este nodo (ADR-0026 D5);
- se escribe o reemplaza `identity_credentials` con el hash scrypt del PIN nuevo y su versión
  incrementada;
- se avanza `authorization_version` del operador, de modo que cualquier sesión viva suya en este
  nodo queda invalidada por el mecanismo que ya existe;
- el ticket queda consumido;
- la auditoría registra actor autorizante, operador, nodo, terminal, UTC y motivo. **Nunca el
  PIN, su hash ni el ticket.**

### D5. Sustitución del PIN temporal de ADR-0027 D3

El camino «PIN temporal fijado por el administrador» de ADR-0027 D3 **queda reemplazado** por
este enrolamiento: cubre el olvido de PIN y el alta en otra terminal con la misma autorización,
sin que un tercero conozca jamás una credencial ajena. El otro camino de ADR-0027 D3 —caducar la
credencial vigente con `identity.user.manage`, que obliga al operador a cambiar su PIN en el
próximo ingreso y produce una sesión restringida con `AUTH_PIN_CHANGE_REQUIRED`— se conserva sin
cambios, igual que el cambio de PIN propio presentando el actual.

### D6. Permiso: se reutiliza `identity.credential.reset`

No se agrega un permiso nuevo. Enrolar la primera credencial local de un operador y reemplazar
una existente son el mismo acto con la misma autoridad —materializar una credencial local sin
conocer el PIN— y el mismo riesgo. Separarlos multiplicaría el catálogo sin separar ninguna
decisión real, y AGENTS.md exige no ampliar sin necesidad concreta. La distinción queda en la
auditoría, no en el permiso.

### D7. Comportamiento offline y sin coordinador

- Un nodo **standalone** es su propio coordinador (ADR-0027 D5): enrola con su identidad local,
  sin concesión.
- Una **terminal sin conectividad** enrola igual, mientras la concesión del operador siga
  utilizable: la vigencia de la concesión es la que gobierna, no el enlace.
- Una concesión **vencida o revocada** no habilita enrolamiento: falla cerrado con
  `IDENTITY_OPERATOR_NOT_FOUND`, sin distinguir públicamente entre inexistente y no utilizable.

### D8. Códigos de error estables

`IDENTITY_OPERATOR_NOT_FOUND`, `IDENTITY_ENROLLMENT_NOT_FOUND`,
`IDENTITY_ENROLLMENT_EXPIRED`, `IDENTITY_ENROLLMENT_CONSUMED`,
`IDENTITY_ENROLLMENT_NODE_MISMATCH` y `AUTH_PIN_POLICY_VIOLATION`. Ninguno expone si un
`operatorCode` existe en otro nodo, ni el estado interno de la consulta.

### D9. Recuperación, revocación y caída

- Un corte entre autorización y consumo deja el ticket sin consumir: vence solo y no habilita
  nada. No hay estado intermedio que reparar.
- Un fallo dentro del consumo revierte la transacción entera: no queda credencial a medias, ni
  usuario local sin credencial creado por ese intento, ni ticket consumido.
- Desactivar al operador o revocar su concesión invalida los tickets pendientes por efecto: el
  consumo vuelve a verificar que el objetivo siga siendo enrolable.
- Reemitir la autorización invalida los tickets anteriores del mismo operador en ese nodo.

## Threat model

**Cubre:**

- transporte de secretos entre nodos: no existe ninguno que transportar;
- un administrador que quiere conocer el PIN de otro operador: nunca lo ve ni lo elige;
- reutilización del ticket (replay): un solo uso, verificado en la transacción que escribe;
- ticket robado después de vencer: inútil;
- ticket de otro nodo o de una copia de base restaurada en otra máquina: identidad de nodo y
  terminal verificadas;
- enrolamiento de un operador que el nodo no conoce, o cuya concesión venció o fue revocada;
- alta silenciosa: cada autorización y cada consumo dejan auditoría con motivo.

**No cubre, y se declara:**

- un atacante con acceso al proceso desbloqueado o al archivo SQLite del nodo: la protección de
  ese archivo es 11.04 y este ADR no la promete;
- alguien físicamente presente en la terminal entre la autorización y el consumo, dentro de la
  ventana de 15 minutos: el ticket es una capacidad al portador en ese nodo. Se mitiga con la
  ventana corta, el uso único y la auditoría, no se elimina;
- un administrador local malicioso: puede enrolarse a sí mismo la credencial de otro operador
  presente en el nodo. Queda auditado con actor, operador, motivo y UTC; la contención es la
  evidencia, no la prevención.

## Alternativa descartada

**Ticket emitido por el coordinador y entregado por sincronización.** El coordinador autorizaría
`operatorId` para `nodeId` y publicaría el hash del ticket como evento dirigido.

Se descarta porque exige un contrato de sincronización nuevo con destinatario único —la
publicación de concesiones es para todos los destinos y periódica, no dirigida ni de un solo
uso—, obliga a transportar el hash de un secreto de autenticación entre nodos, que es
exactamente lo que ADR-0026 prohíbe, y no mejora ninguna garantía: la autoridad sobre *quién es*
el operador ya viaja en la concesión, y la autoridad sobre *este nodo* la tiene quien administra
este nodo. La solución adoptada obtiene las mismas propiedades sin ampliar el protocolo ni mover
secretos.

## Consecuencias

- Una terminal necesita al menos un operador con `identity.credential.reset` y credencial local
  para enrolar a los demás. El primero de cada nodo sigue siendo el administrador local que
  provisiona el CLI de ADR-0011; ese camino no cambia.
- El esquema gana una tabla `identity_credential_enrollments` con hash, vínculo de nodo y
  terminal, vencimiento y consumo. Es estado local: no se publica ni se sincroniza.
- La ruta de consumo es **no autenticada** —el operador todavía no puede iniciar sesión— y por
  eso queda acotada a presentar un ticket válido y un PIN que cumple la política de ADR-0011. Es
  la segunda ruta sin sesión de la API, junto al login, y conserva loopback como todas.
- La interfaz debe representar «identidad sincronizada sin credencial local» como un estado
  propio, no como un operador listo para ingresar.
- ADR-0027 D3 queda actualizado: donde decía PIN temporal, ahora rige este enrolamiento.
