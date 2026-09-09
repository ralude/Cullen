# Instalación de una estación Cullen

Procedimiento reproducible para dejar una estación operando desde cero. Sigue
[ADR-0030](../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md); el instalable y sus
prerrequisitos de construcción viven en [`packaging/`](../../packaging/README.md).

El nodo es un **servicio de Windows** que arranca con la máquina. La ventana Electron sólo
muestra la interfaz que el servicio sirve en `http://127.0.0.1:3000/app/`; cerrarla no detiene
la caja.

## Antes de empezar

- Windows 10/11 o Windows Server, con la edición y ciclo de seguridad que el
  [gate de piloto](../cronograma/gate-piloto-release.md) exige.
- Cuenta con privilegios de administrador local para instalar.
- El MSI de la versión a instalar. **No está firmado**: verifica su procedencia por otro medio
  antes de ejecutarlo.

## 1. Instalar

```powershell
msiexec /i Cullen-<version>.msi /qn /l*v install.log
```

El MSI copia binarios, crea `%ProgramData%\Cullen\{db,backups,keys,logs,diagnostics}` con su ACL
restringida y registra el servicio `CullenNode` con arranque automático.

Verifica la ACL antes de seguir. Debe listar **sólo** `SYSTEM`, `Administradores`,
`CREATOR OWNER` y `NT SERVICE\CullenNode`:

```powershell
icacls C:\ProgramData\Cullen
```

Si aparece `Usuarios` o `Todos`, el nodo se negará a arrancar con
`DATA_DIRECTORY_NOT_PROTECTED`. Es la comprobación de ADR-0029 D7.2 y no se debe eludir
ampliando la ACL: corrige la instalación.

## 2. Configurar la topología

Copia la plantilla y complétala según el papel de la estación:

```powershell
copy "C:\Program Files\Cullen\config\node.env.example" C:\ProgramData\Cullen\node.env
notepad C:\ProgramData\Cullen\node.env
```

- **Standalone:** no declares nada más.
- **Coordinador** o **terminal LAN:** completa el bloque correspondiente con el material TLS ya
  sellado. Emítelo con [emisión de material LAN](./emision-material-lan.md) antes de este paso.

La API de operadores permanece en loopback en todos los casos. Un `SERVER_HOST` que la exponga
aborta el arranque con `SERVER_HOST_NOT_LOOPBACK`.

## 3. Arrancar el servicio

```powershell
Start-Service CullenNode
Get-Service CullenNode
Invoke-WebRequest http://127.0.0.1:3000/health -UseBasicParsing
```

El primer arranque genera la identidad del nodo, migra la base por la ruta con respaldo y
verifica el perímetro. Si falla, el motivo está en `C:\ProgramData\Cullen\logs\` con un código
estable; los mensajes no exponen rutas ni material.

## 4. Provisionar el primer administrador

No hay credenciales predeterminadas. Con el servicio **detenido**:

```powershell
Stop-Service CullenNode
& "C:\Program Files\Cullen\runtime\node.exe" "C:\Program Files\Cullen\server\bootstrap-admin.js"
Start-Service CullenNode
```

El comando pide código de operador y PIN de forma interactiva y local. A partir de ahí, las
altas de operadores se hacen desde la pantalla de identidad.

## 5. Verificar la estación

Abre Cullen desde el menú de inicio y comprueba, en este orden:

1. La ventana carga la interfaz —no la página de «no pudimos conectar con el nodo»—.
2. El ingreso por PIN funciona con el administrador provisionado.
3. Una operación de prueba se completa y queda consultable.
4. `Restart-Computer`: tras reiniciar, el servicio está `Running` sin que nadie inicie sesión, y
   la operación anterior sigue ahí.

Los pasos 1–3 sobre el artefacto compilado están cubiertos por
`apps/server/src/packaged-node-boot.integration.test.ts`. Este runbook cubre lo que esa prueba
no puede: el MSI, la ventana nativa y el arranque en el inicio del sistema.

## 6. Respaldo

El servicio toma la copia diaria por su cuenta (ver [respaldo operativo](./respaldo-operativo.md)).
Antes de dar la estación por instalada, ejecuta una vez el **ensayo de restauración** de ese
runbook sobre una copia de la máquina, no sobre la estación en producción.

## Actualizar

```powershell
msiexec /i Cullen-<version-nueva>.msi /qn /l*v upgrade.log
```

El MSI hace upgrade in-place. La base la migra el arranque del servicio, que respalda, valida y
**restaura y aborta** si la actualización la deja inválida; el servicio no queda escuchando con
una base a medio migrar.

## Desinstalar

```powershell
msiexec /x Cullen-<version>.msi /qn
```

Se retiran binarios y servicio. **`%ProgramData%\Cullen\` no se borra**: contiene la base, la
auditoría append-only, los respaldos y el almacén de claves. Eliminarlo es una decisión
deliberada y hace irrecuperables los respaldos cifrados.

## Lo que este procedimiento no cubre

El MSI sin firmar, la validación en hardware de tienda real, los chaos tests de energía, LAN y
dispositivo fiscal, y la calificación del hardware fiscal de la Fase 8 siguen abiertos en el
[gate de piloto](../cronograma/gate-piloto-release.md). Instalar una estación no habilita un
piloto.
