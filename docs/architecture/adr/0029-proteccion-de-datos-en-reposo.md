# ADR-0029: Protección de datos en reposo

- Estado: Aceptado
- Fecha: 2026-09-08
- Responde: D7 (cifrado en reposo), D8 (retención) y D9 (rotación) de la
  [secuencia y decisiones de Fase 11](../../cronograma/fase-11-seguridad/plan-secuencia-y-decisiones.md).
- Complementa: [ADR-0003](./0003-sqlite-dinero-identificadores.md),
  [ADR-0011](./0011-autenticacion-pin-y-sesiones-locales.md),
  [ADR-0026](./0026-lan-operativa-y-recuperacion-entre-nodos.md) y
  [ADR-0028](./0028-enrolamiento-local-de-credenciales.md).

## Contexto

La Fase 11.04 no puede implementarse sin una decisión normativa previa: el alcance del trabajo
cambia por completo según se cifre o no el archivo de la base. Este ADR la toma sobre el árbol
real, no sobre una intuición.

Lo que hoy existe, verificado:

- **Las credenciales ya están protegidas dentro de la base.** El PIN se guarda como hash scrypt
  con sal individual y el token de sesión solo como SHA-256 (ADR-0011). El ticket de
  enrolamiento se guarda solo como hash (ADR-0028). Ninguno de esos valores viaja entre nodos.
- **El archivo que los contiene no está protegido de ninguna manera declarada.** El SQLite
  operativo, sus `-wal`/`-shm` y los respaldos de `migrateDatabase` son archivos legibles por
  cualquier cuenta con acceso al directorio.
- **Los secretos de configuración ya viven en archivos sin política.** `node-identity.json` se
  lee de `%ProgramData%\SupermarketPlatform\` y el material TLS de LAN de rutas declaradas por
  entorno. ADR-0011 menciona una ACL para la identidad de nodo; nada la verifica.
- **El driver ya sabe migrar con respaldo, validación y restauración** (`migrateDatabase`), y el
  arranque real todavía no lo usa. Eso es deuda de implementación de 11.04, no una decisión.
- **No existe clasificación, retención ni rotación declaradas.** `createBackup` conserva cinco
  copias porque ese es su valor por omisión, no porque alguien lo haya decidido.

El nodo es una estación de tienda: Windows, un único negocio, servicio local desatendido, sin
operador de sistemas dedicado. Aplica al MVP de referencia no certificado
([ADR-0021](./0021-mvp-referencia-no-certificado.md)).

## Decisión

### D7.1. No se cifra el archivo SQLite operativo en el MVP

No se adopta SQLCipher ni ninguna otra dependencia de cifrado de la base. La razón no es el
costo de integrarla sino que **no cambiaría el resultado frente al atacante que importa**: el
servicio arranca desatendido, así que la clave tendría que estar disponible para el proceso sin
intervención humana, en la misma máquina. Quien obtiene Administrador local —el único atacante
que puede leer hoy el archivo— obtendría también la clave. Cifrar la base compraría una
promesa, no una protección, y AGENTS.md prohíbe agregar dependencias sin necesidad concreta.

Se declara explícitamente: **el archivo operativo no está cifrado y este ADR no promete que un
atacante con Administrador local no pueda leerlo.** Lo que sí protege está en D7.2 y D7.3.

### D7.2. El directorio de datos se protege con ACL verificada en arranque

El directorio que contiene la base, sus sidecars, los respaldos y los secretos de configuración
se restringe a la cuenta de servicio del nodo y a los administradores locales. El arranque
**verifica los permisos efectivos** —no supone que el instalador los aplicó— y falla cerrado con
un código estable si el directorio es legible por otros, si no es escribible, o si la
verificación no se puede realizar. Un nodo que no puede garantizar dónde escribe no abre el API.

Esto es lo que separa «cualquier cuenta de la máquina lee los hashes de PIN» de «solo el
servicio y quien ya es administrador». Es una protección modesta y es la que corresponde al
riesgo real de una estación de tienda.

### D7.3. Respaldos y secretos de configuración se cifran; la clave vive fuera

Todo lo que **puede salir de la máquina** se cifra: los respaldos de migración y los secretos de
configuración (material TLS de LAN y cualquier credencial de integración). Un respaldo se copia
a un pendrive o a una carpeta compartida; ahí la ACL local ya no protege nada.

- **Primitiva:** AES-256-GCM de `node:crypto`, nonce aleatorio de 96 bits por archivo y el
  encabezado autenticado con el identificador de nodo y la versión de formato. No se escribe
  criptografía propia: se componen primitivas estándar de la biblioteca de la plataforma.
- **Clave:** una clave de datos de 256 bits por nodo, generada con `randomBytes`, que **nunca se
  escribe en claro en disco**. No vive en `.env`, ni en un `config.json`, ni en la base, ni en el
  código, ni junto al ciphertext.
- **Custodia:** la clave se guarda envuelta por el almacén del sistema operativo, a través de un
  puerto `SecretVault` con una implementación por plataforma que usa la herramienta que el
  sistema ya trae: DPAPI en ámbito de máquina en Windows, el llavero en macOS, el servicio de
  secretos en Linux. No se agrega dependencia de ejecución nueva.
- **Fail closed:** si el almacén no está disponible, el nodo **no** degrada a una clave en disco:
  aborta el arranque de las rutas que cifran. Existe una única excepción explícita para
  desarrollo, seleccionable solo por variable de entorno, que el nodo rechaza cuando corre en
  producción y que deja constancia en auditoría cada vez que se usa.
- **Ventana de texto claro:** `vacuum into` produce un archivo sin cifrar. Se escribe dentro del
  directorio protegido de D7.2, se cifra allí y el intermedio se borra antes de publicar el
  respaldo en su directorio final. La ventana existe, dura lo que dura la copia y está dentro del
  perímetro de la ACL.

Frontera honesta: esto protege el respaldo que sale de la máquina y el secreto que se copia. No
protege contra quien ya tiene Administrador local en el nodo, porque ese atacante puede pedirle
al mismo almacén que le devuelva la clave.

### D7.4. Clasificación de datos sensibles

| Elemento | Contiene | Dónde vive | Quién lo lee | Protección |
| --- | --- | --- | --- | --- |
| SQLite operativo y `-wal`/`-shm` | Hash de PIN y de sesión, identidad de operadores, auditoría, ventas | Directorio de datos del nodo | Servicio y administradores locales | ACL verificada (D7.2) |
| Respaldos de migración | Lo mismo que la base | Directorio de respaldos | Servicio y quien ejecute la restauración | Cifrado (D7.3) |
| `node-identity.json` | `terminalId` y `originNodeId` | `%ProgramData%\SupermarketPlatform\` | Servicio | ACL; no es secreto (D9.3) |
| Material TLS de LAN | Clave privada y certificado | Rutas declaradas por entorno | Servicio | Cifrado (D7.3) |
| `identity_credentials` / `auth_sessions` / `identity_credential_enrollments` | Hash scrypt, sal, hashes de token | Dentro de la base | El proceso del nodo | ADR-0011, ADR-0028; nunca salen (probado) |
| Logs técnicos | Diagnóstico ya redactado | Directorio de logs | Servicio y administradores | ACL; redacción de 11.05 |
| Artefactos de diagnóstico y exportaciones CSV | Datos de negocio, sin credenciales | Directorio de diagnóstico | Quien los solicitó, autenticado | ACL; retención de D8 |

### D8. Retención y acceso

- **Respaldos de migración:** las cinco copias más recientes, y nunca menos de una. Se confirma
  el valor que `createBackup` ya usaba, ahora como política y no como omisión. La copia de
  seguridad operativa periódica —distinta de la de migración— pertenece al gate de piloto y no a
  este ADR.
- **Logs técnicos:** 30 días, rotativos. Contienen diagnóstico redactado; no son evidencia.
- **Artefactos de diagnóstico y exportaciones:** 7 días. Se generan solo a petición autenticada y
  se escriben en el directorio protegido.
- **`auth_sessions` cerradas o vencidas:** se purgan a los 30 días de su vencimiento absoluto.
  Conservan solo hashes, pero no aportan nada después de ese plazo.
- **`identity_credential_enrollments` consumidos o vencidos:** se purgan a los 30 días. Su
  utilidad —detectar el replay de un ticket— no sobrevive a la caducidad.
- **`audit_log`: no se purga.** Es evidencia append-only y su retención en el MVP es indefinida.
  Si algún día se archiva, será con una decisión propia y un procedimiento verificable, no con
  una purga.
- **Acceso:** la cuenta de servicio y los administradores locales. Los respaldos añaden a quien
  ejecute el procedimiento de restauración, que necesita además la clave del almacén del nodo.

### D9. Rotación

- **Clave de cifrado de respaldos y secretos:** rota anualmente o ante sospecha de compromiso.
  La rotación genera una clave nueva y **conserva la anterior en el almacén**, marcada como
  retirada, hasta que caduque el último respaldo cifrado con ella. Una rotación que inutiliza
  los respaldos existentes es pérdida de datos, no seguridad. Cada archivo declara en su
  encabezado autenticado qué clave lo cifró.
- **Material TLS de LAN:** rota al vencer el certificado o ante sospecha. Rotarlo en el
  coordinador obliga a redistribuir la confianza a las terminales; el procedimiento se documenta
  con esa dependencia explícita, porque hacerlo a medias corta la LAN operativa.
- **Identidad de nodo:** **no rota.** `originNodeId` y `terminalId` identifican el origen de cada
  evento del ledger; cambiarlos rompería la trazabilidad y el ownership de ADR-0026. No son un
  secreto: su protección es de integridad, no de confidencialidad.
- **PIN de operador:** no caduca por política de tiempo en el MVP. Una expiración periódica sin
  gestión de contraseñas empuja a PINs previsibles y anotados en el mostrador. Se caduca cuando
  hay una razón —`identity.user.manage`, con motivo y auditoría— y el operador lo cambia él
  mismo (ADR-0027 D3, ADR-0028 D5).
- **Token de sesión:** rota en cada ingreso y muere con la sesión; ya cubierto por ADR-0011.
- **Quién rota:** la rotación de clave y de material TLS es una operación del nodo, no del API de
  operadores: se ejecuta en la máquina, con la cuenta que administra el servicio, y deja
  auditoría con actor de nodo, terminal, timestamp UTC y motivo. No se expone por HTTP en el
  MVP; exponerla añadiría una superficie remota para una operación que solo tiene sentido con
  acceso físico o administrativo a la estación.

## Threat model

**Cubre.** Un respaldo copiado fuera de la máquina —pendrive, carpeta compartida, correo— no es
legible sin la clave que quedó en el almacén del nodo. Un secreto de configuración copiado,
tampoco. Una cuenta sin privilegios en la estación no puede leer la base ni los hashes de PIN,
y el nodo se niega a arrancar si esa condición no se puede verificar. Una actualización fallida
deja una base íntegra, porque el arranque migra por la ruta con respaldo y restauración.

**No cubre, y se declara.** Un atacante con Administrador local o que ya controla el proceso
desbloqueado: puede leer el archivo y pedirle la clave al almacén del sistema. El robo físico de
la máquina encendida y desbloqueada. Un operador legítimo que abusa de los permisos que tiene
—eso lo cubre la auditoría, no el cifrado—. El cifrado de disco completo del sistema operativo,
que es una decisión de despliegue y no de este código. La confidencialidad de los datos de
negocio frente a quien puede restaurar un respaldo con la clave del nodo.

**No se promete recuperación imposible.** Si se pierde el almacén de claves del nodo —reinstalación
del sistema, cambio de máquina— los respaldos cifrados con esa clave **no se pueden recuperar**.
El procedimiento de reinstalación debe exportar la clave antes, y esa exportación es a su vez
material sensible. Prometer lo contrario sería prometer un cifrado que no cifra.

## Alternativa descartada

**Cifrar la base con SQLCipher.** Descartada por D7.1: en un servicio desatendido de una sola
máquina, la clave tiene que estar al alcance del proceso, de modo que el único atacante que hoy
puede leer el archivo seguiría pudiendo. Añadiría una dependencia nativa, complicaría
`vacuum into`, los respaldos y las migraciones, y compraría sobre todo la sensación de estar
cifrado. Se reconsiderará si el nodo pasa a operar en una máquina compartida o multiempresa, o
si aparece una exigencia normativa que lo pida por sí mismo.

**Guardar la clave en un archivo con permisos restringidos.** Descartada porque una clave junto
al dato que protege, en el mismo perímetro de ACL, no agrega ninguna frontera: quien puede leer
el respaldo puede leer la clave.

## Consecuencias

- 11.04 queda desbloqueada: el corte 1 se reduce a publicar la clasificación de D7.4, el corte 2
  a componer `migrateDatabase` en el arranque, el corte 3 a la ACL verificada y al cifrado de
  respaldos y secretos con custodia en el almacén del sistema, y el corte 4 a la rotación de D9.
- Aparece un puerto nuevo, `SecretVault`, con implementación por sistema operativo. El núcleo no
  conoce DPAPI ni llaveros: conoce «envolver» y «desenvolver», y falla cerrado.
- El arranque gana dos motivos nuevos de fallo —ACL insuficiente y almacén no disponible— con
  códigos estables. Un nodo que no puede proteger lo que escribe no atiende.
- Restaurar un respaldo en otra máquina exige llevar también la clave, deliberadamente. El
  procedimiento de restauración deja de ser «copiar un archivo».
- Escribir este ADR no completa 11.04. La sub-fase sigue pendiente hasta que sus criterios de
  aceptación estén demostrados por código y pruebas.
