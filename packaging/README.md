# Empaquetado del nodo Cullen

Define el instalable de una estación: el servicio de Windows que ejecuta el nodo Fastify y la
ventana Electron que lo consume. Sigue [ADR-0030](../docs/architecture/adr/0030-empaquetado-y-runtime-del-nodo.md).

Este directorio contiene la **definición** del empaquetado. El MSI se construye en un host
Windows con WiX Toolset instalado; no se produce ni se valida dentro de `pnpm test`. La
verificación automatizada cubre el arranque del bundle del servidor
(`apps/server/src/packaged-node-boot.integration.test.ts`); la instalación completa se valida
con el runbook [`docs/operacion/instalacion-estacion.md`](../docs/operacion/instalacion-estacion.md).

## Contenido

| Ruta | Qué es |
| --- | --- |
| `winsw/CullenNode.xml` | Configuración del supervisor del servicio (WinSW): ejecutable, entorno, reinicio y rotación de logs. |
| `wix/Cullen.wxs` | Proyecto WiX: componentes, servicio, ACL del directorio de datos y tarea de respaldo. |
| `wix/config/node.env.example` | Plantilla de variables por instalación (LAN, TLS, coordinador). Se copia a `%ProgramData%\Cullen\node.env` y se completa por sitio. |

## Prerrequisitos del host de construcción

- Windows 10/11 o Windows Server.
- Node del runtime embebido: se descarga la distribución oficial `node-v<version>-win-x64` y se
  copia como `runtime/` en el staging (ver abajo). El nodo no usa el Node del sistema.
- [WiX Toolset v5](https://wixtoolset.org/) (`dotnet tool install --global wix`) con la extensión
  `WixToolset.Util.wixext`.
- [WinSW v3](https://github.com/winsw/winsw/releases) (`WinSW-x64.exe`), renombrado a
  `CullenNode.exe`.
- `better-sqlite3` reconstruido para el ABI del Node embebido (`pnpm rebuild better-sqlite3` con
  ese Node en el `PATH`, o `prebuild-install`).

## Pasos

```powershell
# 1. Verificación y artefactos
pnpm pipeline
pnpm --filter @supermarket/server build       # -> apps/server/dist
pnpm --filter @supermarket/desktop build      # -> apps/desktop/out

# 2. Staging (script de construcción, fuera de este repo o en CI)
#    staging/
#      server/        <- apps/server/dist/* + node_modules/better-sqlite3 (ABI del runtime)
#      app/renderer/  <- apps/desktop/out/renderer
#      app/           <- apps/desktop/out/main, out/preload y el ejecutable Electron
#      runtime/node.exe
#      service/CullenNode.exe (WinSW) + CullenNode.xml
#      config/node.env

# 3. MSI
wix build packaging/wix/Cullen.wxs -ext WixToolset.Util.wixext -d Staging=staging -o Cullen-<version>.msi
```

El MSI resultante **no está firmado**. Definir la firma de ejecutables (certificado, cadena,
sellado de tiempo) sigue abierto en el [gate de piloto](../docs/cronograma/gate-piloto-release.md).

## Qué hace el MSI al instalar

1. Copia `server/`, `app/`, `runtime/` y `service/` a `%ProgramFiles%\Cullen\`.
2. Crea `%ProgramData%\Cullen\{db,backups,keys,logs,diagnostics}` y ejecuta
   `icacls <dir> /inheritance:r /grant *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F "NT SERVICE\CullenNode":(OI)(CI)F`
   — exactamente la ACL que `assertProtectedDirectory`
   (`packages/drivers/security/src/data-directory.ts`) verifica en cada arranque.
3. Registra el servicio `CullenNode` (arranque automático, cuenta `NT SERVICE\CullenNode`).
4. Agenda la tarea `Cullen\RespaldoOperativo` que invoca `node.exe server\backup.js` a diario,
   como respaldo de la cadencia en proceso del servicio.
5. Instala los accesos directos de la ventana Electron.

No coloca `node-identity.json`: la identidad la genera el primer arranque del servicio o
`bootstrap-admin`. La provisión del primer administrador y el material TLS de LAN son pasos del
runbook de instalación, no del MSI.
