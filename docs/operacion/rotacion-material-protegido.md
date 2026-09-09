# Rotación de material protegido del nodo

Este procedimiento aplica a la clave AES-256-GCM que protege respaldos y secretos y al material
TLS de la LAN. Se ejecuta localmente con la cuenta que administra el servicio; no existe una
ruta HTTP para hacerlo. La identidad `originNodeId`/`terminalId` no se cambia.

## Clave de protección

1. Detener el servidor y confirmar que no hay una actualización en curso.
2. Conservar el directorio de respaldos y el almacén de claves del sistema operativo. No copiar
   la clave a la carpeta de respaldos.
3. Ejecutar desde el repositorio, con la misma configuración del nodo:

   ```powershell
   pnpm --filter @supermarket/server rotate-protected-material -- "Rotación anual; cambio CHG-1234"
   ```

4. Confirmar la salida `Protection key rotated`, arrancar el nodo y verificar `/health` y el
   estado de sincronización.
5. Ensayar la restauración de un respaldo anterior y de uno nuevo. La clave retirada se conserva
   mientras un respaldo vigente la referencie; la herramienta solo olvida claves sin referencias.

La operación deja `SECURITY_PROTECTION_KEY_ROTATED` con nodo, terminal, instante UTC, protección
efectiva y motivo. La evidencia se confirma antes de olvidar ninguna clave: si la auditoría no
llega a escribirse, la herramienta falla con el almacén completo —incluida la clave recién
retirada— y basta repetir el procedimiento. Un fallo no se resuelve borrando el almacén: perderlo
vuelve irrecuperables los respaldos cifrados por decisión expresa de ADR-0029.

## Certificados y claves TLS

La sustitución requiere una ventana coordinada. Rotar solo un extremo puede cortar la LAN. La
emisión inicial y el alta de una terminal nueva son otro procedimiento:
[emisión de material LAN](./emision-material-lan.md).

1. Emitir el material nuevo con la PKI aprobada y validar vigencia, nombres y propósito antes de
   tocar el nodo. Con la autoridad interna del MVP, `generate-lan-material` lo emite reutilizando
   `ca.key`; con una PKI corporativa, emitirlo allí con los mismos atributos. Mantener el
   material plano únicamente en un directorio administrativo temporal con ACL restringida; nunca
   pasarlo por argumentos, logs, correo o el renderer.
2. Preparar copias `.sealed` con la clave activa mediante `openSecretVault`,
   `loadFileProtection` y `FileProtection.seal` del driver de seguridad. Las rutas configuradas
   por `SYNC_*_TLS_*_PATH` deben apuntar únicamente a archivos sellados: el arranque rechaza el
   texto plano con `SECRET_MATERIAL_NOT_SEALED`.
3. Si cambia una autoridad de certificación, distribuir primero el conjunto de confianza que
   acepte el material viejo y el nuevo. Confirmar esa confianza en coordinador y terminales antes
   de sustituir certificados finales. No retirar la autoridad anterior hasta verificar todos los
   nodos registrados.
4. Detener el nodo, conservar una copia de los archivos sellados vigentes y reemplazar juntos la
   clave, el certificado y las autoridades correspondientes. No cambiar las rutas de entorno a
   archivos planos.
5. Ejecutar `rotate-protected-material` con un motivo que identifique explícitamente la rotación
   TLS y su cambio operativo. Esto deja el checkpoint auditable y vuelve a sellar todos los
   secretos vivos con la nueva clave de protección.
6. Arrancar primero el extremo cuya confianza ya admite ambos juegos, verificar mTLS, entregar un
   evento de prueba y confirmar **aplicación**, no solo ACK de custodia. Completar los demás nodos
   uno por uno.
7. Ante fallo, detener, restaurar el juego sellado anterior y repetir la verificación. Cuando
   todos los nodos operen con el material nuevo, retirar la confianza anterior según la política
   de la PKI.
8. Eliminar el material plano temporal con el mecanismo seguro aprobado por operaciones y
   conservar solo la evidencia sellada y el registro del cambio.

Este runbook no automatiza la emisión ni la redistribución de certificados: dependen de la PKI y
de la topología aprobadas para la instalación. El gate de piloto sigue exigiendo completar los
runbooks de red y despliegue para el entorno real.
