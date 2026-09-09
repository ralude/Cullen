# Respaldo operativo del nodo

Cubre la copia periódica de la base y su restauración. Es **distinta** del respaldo previo a
migración: aquél protege una actualización ([ADR-0029](../architecture/adr/0029-proteccion-de-datos-en-reposo.md)
D8, cinco copias); éste protege la operación diaria —corrupción, borrado accidental, disco
perdido— y lo decide
[ADR-0030 D7](../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md).

## Qué hace el nodo por su cuenta

El servicio toma una copia **diaria** a la hora local declarada —03:00 por omisión— desde el
proceso dueño de SQLite, y publica una **semanal** cada siete días duplicando la copia diaria ya
sellada. Conserva siete diarias y cuatro semanales en
`%ProgramData%\Cullen\backups\operational\`, en familias separadas de las copias de migración:
la retención de una nunca borra las de la otra.

Cada copia va cifrada con la clave del nodo (ADR-0029 D7.3). **Restaurarla exige esa clave**, que
vive en el almacén del sistema operativo de esa máquina. Un respaldo copiado a un pendrive no es
legible en otra parte, y ese es el punto; también significa que perder el almacén vuelve los
respaldos irrecuperables, por decisión expresa del ADR.

Ajustes en `%ProgramData%\Cullen\node.env`:

| Variable | Por omisión | Qué cambia |
| --- | --- | --- |
| `OPERATIONAL_BACKUP_HOUR` | `3` | Hora local (0-23) de la copia diaria. |
| `OPERATIONAL_BACKUP_DAILY_RETENTION` | `7` | Copias diarias conservadas. |
| `OPERATIONAL_BACKUP_WEEKLY_RETENTION` | `4` | Copias semanales conservadas. |
| `OPERATIONAL_BACKUP_EXTERNAL_PATH` | — | Copia adicional fuera de la máquina; sigue sellada. |

Un valor inválido **aborta el arranque**, no la noche que toca correr. El log registra si hubo
copia semanal o externa, nunca las rutas.

## Copia a petición

Antes de una intervención, o para el ensayo. Exige el servicio **detenido**: la herramienta
reclama la propiedad del archivo, igual que la rotación de material protegido, y dos procesos
dueños de la misma base es justo lo que `DATABASE_NODE_LOCKED` impide.

```powershell
Stop-Service CullenNode
& "C:\Program Files\Cullen\runtime\node.exe" "C:\Program Files\Cullen\server\backup.js"
Start-Service CullenNode
```

Imprime la ruta de la copia diaria y, si correspondía, de la semanal y la externa.

## Ensayo de restauración

Hazlo al instalar la estación y cada vez que cambie la clave de protección. **Sobre una copia de
la máquina o una VM, nunca sobre la estación en producción.**

1. Detén el servicio y anota qué debe reaparecer: número de operadores, productos y la última
   operación registrada.
2. Elige el respaldo a restaurar:

   ```powershell
   Get-ChildItem C:\ProgramData\Cullen\backups\operational | Sort-Object LastWriteTime -Descending
   ```

3. Restaura:

   ```powershell
   & "C:\Program Files\Cullen\runtime\node.exe" "C:\Program Files\Cullen\server\backup.js" `
     --restore "C:\ProgramData\Cullen\backups\operational\<archivo>"
   ```

   El comando descifra el respaldo sobre la base, retira los sidecars de la anterior —un WAL que
   el respaldo no conoce deja una base incoherente— y verifica la integridad. Si no pasa,
   termina con `BACKUP_RESTORE_INVALID` y no deja el nodo operando sobre datos dudosos.

4. Arranca el servicio y comprueba lo que anotaste en el paso 1: ingreso de un operador, un
   producto consultable y la operación esperada.

El ensayo equivalente está automatizado en
`apps/server/src/operational-backup.integration.test.ts`: borra el archivo operativo, restaura
desde el respaldo sellado y comprueba integridad, integridad referencial, conteos de filas y que
el artefacto no lleva credenciales legibles. Este runbook cubre lo que la prueba no puede: la
máquina real, su almacén de claves y el servicio.

## Lo que este respaldo no resuelve

Un respaldo diario deja una ventana de hasta 24 horas de operaciones. Reducirla —o replicar
fuera de la tienda— es una decisión de despliegue que el MVP no toma. La cadencia depende de que
el servicio esté corriendo a esa hora: una estación apagada por la noche no respalda, y conviene
mover `OPERATIONAL_BACKUP_HOUR` a una hora en la que la tienda esté encendida.
