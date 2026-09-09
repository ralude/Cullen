# ADR-0030: Empaquetado del nodo y runtime como servicio de Windows

- Estado: Aceptado
- Fecha: 2026-09-09
- Complementa: [ADR-0002](./0002-transporte-negocio-ipc.md),
  [ADR-0008](./0008-topologia-offline-por-nodo.md),
  [ADR-0011](./0011-autenticacion-pin-y-sesiones-locales.md),
  [ADR-0026](./0026-lan-operativa-y-recuperacion-entre-nodos.md) y
  [ADR-0029](./0029-proteccion-de-datos-en-reposo.md), cuyo punto D8 amplía con la retención del
  respaldo operativo.
- Responde: la brecha de empaquetado que
  [11.03](../../cronograma/fase-11-seguridad/11.03-jwt-sesiones.md) declaró y no cubrió
  (CA-11.03-09) y los ítems de instalador y respaldo operativo del
  [gate de piloto](../../cronograma/gate-piloto-release.md).

## Contexto

La Fase 11 cerró la frontera de sesión y transporte, pero el nodo todavía no se puede instalar.
Lo verificado sobre el árbol real:

- **El servidor corre en desarrollo con `tsx src/index.ts`.** No hay build; el artefacto de
  ejecución es el árbol de fuentes TypeScript más `tsx`. `apps/server/package.json` no declara
  un script `build`.
- **Nadie arranca el servidor en una estación instalada.** El proceso principal de Electron
  (`apps/desktop/src/main/index.ts`) carga `http://127.0.0.1:3000/app/` desde el nodo y muestra
  una página de reintento si no responde, pero no lo lanza ni lo supervisa. En desarrollo el
  nodo lo levanta el operador y el renderer lo sirve `electron-vite`.
- **El nodo ya sabe servir la interfaz.** `apps/server/src/app.ts` registra los estáticos del
  renderer bajo `/app/` cuando `RENDERER_DIST_PATH` apunta a un bundle con `index.html`. El
  renderer llama a `/api/v1/...` con rutas relativas y la cookie viaja `SameSite=Strict`, así
  que interfaz y API comparten origen sólo si la sirve el propio nodo.
- **El arranque exige una ACL que nadie aplica.** `assertProtectedDirectory`
  (`packages/drivers/security/src/data-directory.ts`) falla cerrado si el directorio de datos
  concede acceso más allá de `SYSTEM`, `Administrators`, `CREATOR OWNER` y la cuenta del
  servicio (ADR-0029 D7.2). Hoy esa ACL depende de que "el instalador la aplique", y no hay
  instalador.
- **`better-sqlite3` es un módulo nativo.** Su binario se compila para un ABI concreto de Node.
- **El respaldo periódico no existe.** `createBackup` (vacuum + validación + sellado) es privado
  de `packages/drivers/db/src/migrations.ts` y sólo corre en la migración de arranque. ADR-0029
  D8 delegó el respaldo operativo —distinto del de migración— a este gate.

El nodo es una estación de tienda: Windows, un único negocio, servicio local desatendido, sin
operador de sistemas dedicado. Aplica al MVP de referencia no certificado
([ADR-0021](./0021-mvp-referencia-no-certificado.md)).

## Decisión

### D1. El nodo es un servicio de Windows independiente, no un proceso hijo de Electron

El servidor Fastify se instala y ejecuta como un **servicio de Windows** que arranca en el
inicio del sistema, antes e independientemente de cualquier sesión de usuario. Electron es
sólo la ventana: abre `http://127.0.0.1:3000/app/` contra el servicio y no gestiona su ciclo de
vida.

Se rechaza que Electron lance el servidor como proceso hijo. Un turno empieza encendiendo la
estación, no abriendo una aplicación; la sincronización LAN, la entrega del outbox y el respaldo
periódico deben correr aunque la ventana esté cerrada; y un `better-sqlite3` reconstruido para
el ABI de Electron acopla el nodo a la versión de Electron sin ninguna ganancia. El servicio
también evita que cerrar la ventana por error detenga la caja.

Una instalación standalone y una terminal LAN usan el mismo servicio; su rol lo decide la
configuración de sincronización que ya existe (`SYNC_*`), no el empaquetado.

### D2. El servidor se compila a un bundle con un runtime Node embebido

`apps/server` gana un script `build` que produce `apps/server/dist/` con `esbuild`: un bundle
ESM con target Node, `better-sqlite3` marcado como externo y su carpeta de `node_modules`
copiada junto al bundle. El instalador incluye un **runtime Node** propio; el nodo no depende de
que la estación tenga Node instalado ni de una versión concreta del sistema.

`better-sqlite3` se reconstruye para el ABI de **ese** Node —el del runtime embebido—, no el de
Electron, porque el servidor no corre dentro de Electron (D1). La reconstrucción es parte del
empaquetado y su resultado se verifica en la prueba de arranque (D6).

El bundle no cambia la composición: el entrypoint sigue siendo `apps/server/src/index.ts`, que
ya resuelve el host permitido antes de tocar la base, abre el almacén de claves sin degradar,
migra por la ruta con respaldo y compone el listener LAN fail-closed.

### D3. Supervisión con WinSW

El servicio se registra a través de **WinSW** (`CullenNode.exe`, WinSW renombrado, más
`CullenNode.xml`). WinSW arranca el proceso Node con el bundle, lo reinicia ante caída con
retroceso, y redirige la salida estándar del logger estructurado a archivos rotados por tamaño
en el directorio de logs protegido. No se escribe un supervisor propio: reiniciar un proceso y
rotar su log es exactamente lo que WinSW hace y ya está probado.

El servicio corre bajo una **cuenta de servicio virtual** (`NT SERVICE\CullenNode`), no
`LocalSystem`. Es la cuenta de menor privilegio que puede escribir en su directorio de datos y
usar DPAPI en ámbito de máquina; su SID entra en la ACL de D4 por la vía
`currentAccountSid()` que `assertProtectedDirectory` ya contempla.

### D4. El instalador es un MSI de WiX y es responsable del perímetro

El instalable es un **MSI construido con WiX Toolset**. Sus responsabilidades:

1. Copiar el bundle del servidor, el runtime Node, WinSW y la aplicación Electron.
2. Crear `%ProgramData%\Cullen\` con `db\`, `backups\`, `keys\`, `logs\` y `diagnostics\`, y
   aplicar una **ACL explícita** —herencia deshabilitada; sólo `SYSTEM`, `Administrators`,
   `CREATOR OWNER` y `NT SERVICE\CullenNode`— que es la que `assertProtectedDirectory` verifica
   en cada arranque. El nodo no confía en que se aplicó: la comprueba y falla cerrado.
3. Registrar el servicio (`ServiceInstall`/`ServiceControl`) con arranque automático.
4. Instalar los accesos directos de la ventana Electron.

El MSI **no** agenda una tarea de respaldo: la cadencia vive dentro del servicio (D7).

El MSI **no** coloca `node-identity.json`. La identidad del nodo se genera en el primer arranque
o con `bootstrap-admin`, para que el mismo MSI sirva a cualquier terminal sin materializar una
identidad en el paquete.

La actualización es un upgrade in-place del MSI. El rollback de datos ante una actualización
fallida ya lo cubre la migración con respaldo, validación y restauración de 11.04
(`apps/server/src/node-storage.ts`); el MSI no añade su propia lógica de rollback de base.

### D5. Provisión del primer administrador

El runbook de instalación ejecuta, una sola vez y de forma local, el `bootstrap-admin` que ya
existe (`apps/server/src/bootstrap-admin.ts`). No hay credenciales predeterminadas y el MSI no
crea usuarios.

### D6. Prueba del arranque empaquetado

Cierra CA-11.03-09 una prueba automatizada que arranca el **bundle compilado** como proceso
real, con un directorio temporal y `RENDERER_DIST_PATH` apuntando al renderer compilado,
**sin el proxy de `electron-vite` en ninguna parte**:

- `/app/` sirve la interfaz y sus assets resuelven bajo ese prefijo;
- un operador autentica por `/api/v1/auth/session` y la cookie es `SameSite=Strict`;
- ejecuta una operación;
- al reiniciar el proceso, la sesión sigue su ciclo esperado y la operación quedó persistida.

La verificación de ACL sólo aplica en Windows; la prueba la ejercita ahí y documenta que en
otra plataforma esa rama se omite. La instalación completa del MSI y la ventana Electron nativa
se cubren con un **runbook manual reproducible** (`docs/operacion/instalacion-estacion.md`); el
criterio no se marca por una prueba de renderer.

### D7. Retención del respaldo operativo (amplía ADR-0029 D8)

El respaldo operativo periódico —distinto del de migración— se conserva con su propia política:
**siete copias diarias y cuatro semanales**, configurable, y nunca menos de una. Vive en
`%ProgramData%\Cullen\backups\operational\`, sellado con la clave del nodo (ADR-0029 D7.3), y el
procedimiento admite además una copia a una ruta externa que el operador indique. Es
independiente de las cinco copias de migración de ADR-0029 D8, que no se tocan.

La cadencia desatendida la ejecuta **el propio servicio**, en el proceso dueño de SQLite, a una
hora local declarada (`OPERATIONAL_BACKUP_HOUR`, 03:00 por omisión). No se agenda una tarea de
Windows paralela: una herramienta externa que abriera la base reclamaría su propiedad y
chocaría con `DATABASE_NODE_LOCKED`, que existe para impedir dos procesos dueños del mismo
archivo. El **CLI de respaldo** cubre la copia a petición y el ensayo de restauración con el
servicio detenido, igual que la rotación de material protegido. El ensayo de restauración con
datos representativos está automatizado.

### D8. Firma de ejecutables: diferida

El MVP construye un MSI **sin firmar**. Definir la firma de ejecutables —certificado, cadena,
sellado de tiempo— sigue siendo un ítem abierto del gate de piloto. Un MSI sin firmar es
aceptable para una VM de prueba y un piloto controlado; no lo es para distribución abierta, y
este ADR no lo presenta como tal.

## Threat model

**Cubre.** El nodo opera sin sesión de usuario y sobrevive al cierre de la ventana. El
directorio de datos no es legible por cuentas sin privilegio y el nodo se niega a arrancar si
esa condición no se puede verificar. Una actualización fallida deja una base íntegra. Una
pérdida de datos por corrupción o borrado accidental se recupera desde el respaldo operativo
más reciente.

**No cubre, y se declara.** Un MSI sin firmar no prueba su origen: quien sustituye el instalable
antes de instalarlo no encuentra una barrera criptográfica (D8). Un atacante con Administrador
local sobre la estación —igual que en ADR-0029— puede leer la base y pedir la clave al almacén.
El cifrado de disco completo del sistema operativo es una decisión de despliegue. La validación
del MSI en hardware de tienda real y los chaos tests de energía, LAN y dispositivo fiscal
pertenecen al gate de piloto.

## Alternativas consideradas

- **Electron lanza y supervisa el servidor.** Rechazada en D1: acopla el nodo a Electron, ata
  la caja a la ventana y no cubre el trabajo de fondo con la ventana cerrada.
- **El servidor en el proceso principal de Electron.** Rechazada: un fallo no controlado del
  servidor tumba la ventana y viceversa; sin aislamiento de proceso.
- **Instalador NSIS de electron-builder + wrapper de servicio.** Rechazada: registrar un
  servicio y aplicar una ACL con herencia deshabilitada es idiomático en WiX/MSI y frágil en
  NSIS. electron-builder se usa, si acaso, sólo para producir la carpeta de la app Electron.
- **Depender de un Node instalado en la estación.** Rechazada: introduce una dependencia de
  versión del entorno que el MVP no controla.
- **Servicio como `LocalSystem`.** Rechazada en D3 a favor de la cuenta de servicio virtual de
  menor privilegio.

## Consecuencias

`apps/server` gana un artefacto de distribución y un modo de ejecución supervisado. El gate de
piloto pasa de "brecha declarada" a "cubierto por código y prueba" en arranque empaquetado,
instalador reproducible (sin firma) y respaldo operativo. Queda abierto: la firma, la
validación del MSI en una tienda real y los chaos tests. El paquete de trabajo pre-piloto
([docs/cronograma/pre-piloto/](../../cronograma/pre-piloto/README.md)) recoge los planes de
ejecución; la Fase 11 permanece cerrada y no se renumera nada.
