# Fase 8: Integración serial fiscal

- **Estado:** Suspendida por dependencia externa (no completada)
- **Índice:** [Cronograma](../README.md)
- **Replanificación:** [Suspensión de Fase 8 y avance a Fase 9](../replanificacion-fase-08-a-09.md)
- **Decisión relacionada:** [ADR-0010](../../architecture/adr/0010-transporte-serial-y-protocolos-fiscales.md)
- **Retrospectiva de entrada:** [Fase 7](../fase-07-driver-fiscal-fake/retrospectiva.md)
- **Fuentes revisadas:** [Registro de fuentes primarias, de fabricante y técnicas](./fuentes-oficiales.md)
- **Matriz:** [Perfiles candidatos y bloqueos](./matriz-compatibilidad.md)
- **Gap contractual:** [Campos y decisiones antes del encoder](./gap-contrato-fiscal.md)
- **Arranque fiscal:** [Diseño de barrido y bloqueo](./orquestador-arranque-fiscal.md)
- **Plan de cierre 8.00:** [Corte interno y bloqueos](./plan-cierre-8.00.md)
- **Runtime nativo:** [Owner, aislamiento y hard recovery](./runtime-nativo-8.00.md)
- **Exclusión fiscal:** [Puerta única y casos de concurrencia](./exclusion-dispositivo-fiscal.md)

## Propósito

Conectar dos perfiles exactos de impresoras fiscales reales de familias y
fabricantes distintos, sin acoplar dominio ni aplicación a
SerialPort, sin prometer un protocolo universal y sin duplicar un documento o
cierre fiscal ante timeout, desconexión o reinicio.

La frontera genérica de todos los perfiles es el contrato semántico. El
transporte serial de bytes también se comparte entre perfiles cuya vía oficial
sea serial; un SDK, DLL u otro transporte autorizado conserva un gateway nativo
aislado y no se fuerza a fingir SerialPort. El framing, comandos, checksums,
estados, capacidades y reglas de recuperación pertenecen a un adaptador
versionado por proveedor, familia, modelo y firmware.

## Suspensión vigente

Desde el 2026-09-01 la fase está suspendida porque no se dispone del hardware
fiscal oficial, el protocolo/manual vigente del fabricante ni el laboratorio
necesario. Se conservan las tareas cerradas y abiertas de 8.00, pero no se
inicia 8.01 ni se declara soporte real hasta satisfacer el gate. La Fase 9
avanza únicamente con el driver fake y las restricciones de simulación de la
[decisión de replanificación](../replanificacion-fase-08-a-09.md).

**Revisión del 2026-09-09:** ninguno de los bloqueos externos ha cambiado. La suspensión sigue
vigente y la fase no recibe trabajo. Para reanudarla hacen falta, todos: hardware fiscal
autorizado de dos perfiles exactos; el protocolo o SDK vigente del fabricante, con el registro
del desarrollador de conectividad; laboratorio para las pruebas HIL; y la revalidación del marco
fiscal tras la derogación de SNAT/2024/000121 por SNAT/2026/00084. Nada de eso depende de este
repositorio, así que el bloqueo no se cierra con código y no se presenta como avance. El
[paquete pre-piloto](../pre-piloto/README.md) no toca esta fase: el modo fiscal sigue simulado y
toda representación conserva `SIMULACION`.

## Alcance de la fase

- Windows x64 dentro de una edición con soporte de seguridad: Windows 11 como
  base; Windows 10 solo con LTSC vigente o ESU activo y documentado. Un solo
  proceso propietario del recurso de integración fiscal por terminal, incluido
  el puerto cuando la vía oficial sea serial.
- Dos combinaciones exactas de proveedor, familia, modelo, firmware, protocolo o
  SDK e interfaz expresamente permitidas. Los candidatos iniciales son PNP y The
  Factory HKA/ACLAS, pero el soporte solo se declara después de sus gates y HIL.
- Configuración explícita del recurso de integración y handshake no mutante de
  identidad; los parámetros de puerto solo existen en perfiles seriales.
- Factura, notas fiscales expresamente incluidas, reportes X/Z y consultas de
  recuperación que el protocolo seleccionado documente y que la aplicación ya
  soporte. Nota de débito y contingencias quedan decididas, no implícitas.
- Evidencia separada de transporte, efecto del comando, compromiso fiscal y
  entrega impresa; cualquier dimensión ambigua bloquea nuevas operaciones hasta
  reconciliar o intervenir según el protocolo.
- Coexistencia verificada con el DCTD sin sustituirlo, configurarlo ni interferir
  el canal que transmite al sistema centralizado.
- Pruebas unitarias, contractuales, integración, caos y hardware-in-the-loop
  para cada combinación declarada.

Quedan fuera: detectar automáticamente cualquier impresora, aceptar modelos no
incluidos en la matriz, ejecutar comandos configurables por el operador,
soportar ESC/POS como si fuera fiscal y agregar una tercera familia sin repetir
su gate, adaptador y calificación. Dos equipos soportados no convierten en
compatibles a todos los modelos de sus marcas.

No existe evidencia pública suficiente para afirmar cuáles son estadísticamente
las dos marcas más vendidas del mercado venezolano. PNP y HKA/ACLAS se tratan
como candidatos con producto, documentación o ecosistema local verificable; la
disponibilidad y base instalada se corroboran con canales autorizados antes de
comprar el laboratorio.

## Orden obligatorio

1. [8.00 Gate de evidencia, contrato y proveedor](./8.00-gate-evidencia-proveedor.md)
2. [8.01 Transporte SerialPort](./8.01-serialport-adapter.md)
3. [8.02 Codec del primer perfil seleccionado](./8.02-parser-protocolo.md)
4. [8.03 Coordinación single-flight](./8.03-command-queue.md)
5. [8.04 Retry seguro y reconciliación](./8.04-retry-reconciliacion.md)
6. [8.05 Proyección operativa del dispositivo](./8.05-state-machine-dispositivo.md)
7. [8.06 Calificación del primer perfil con hardware](./8.06-calificacion-hardware.md)
8. [8.07 Gate del segundo proveedor HKA/ACLAS](./8.07-gate-segundo-proveedor.md)
9. [8.08 Adaptador del segundo perfil](./8.08-adaptador-segundo-perfil.md)
10. [8.09 Calificación cruzada y cierre](./8.09-calificacion-cruzada.md)

No se inicia una sub-fase posterior mientras la anterior tenga tareas abiertas.
Un spike del gate puede comprobar compatibilidad sin enviar comandos fiscales
desde un workspace desechable; no modifica manifests/lock de producción ni se
convierte en implementación.

## Diseño objetivo

```text
caso de uso
  -> FiscalPrinterPort (semántico)
    -> adaptador de familia fiscal
      ├─ protocolo serial oficial:
      │    codec/status mapper -> SerialPort (bytes) -> puerto COM
      └─ SDK/DLL oficial:
           gateway nativo aislado -> interfaz autorizada del proveedor
```

El servidor local del nodo compone estas piezas y posee SQLite y el dispositivo
dentro de un único límite operativo. Electron puede iniciar o supervisar ese
servidor, pero el renderer nunca recibe Node.js, rutas COM, handles, bytes ni
tipos o funciones del SDK/DLL.

## Principios de seguridad fiscal

- `write()`, el evento `drain` de Node y `port.drain()` no confirman que la
  impresora ejecutó un comando.
- Una desconexión después de iniciar el envío produce resultado ambiguo hasta
  que una consulta autoritativa del protocolo demuestre lo contrario.
- No se reproducen tramas ni comandos fiscales persistidos después de reiniciar.
  `FiscalDocument` y `FiscalDay` conservan la intención local y determinan qué
  reconciliar; memoria, status, contadores y reportes autoritativos del equipo
  aportan evidencia del efecto físico/fiscal.
- Una referencia distinta a la última observada no es evidencia suficiente de
  que un documento no se emitió.
- Facturas, notas, X, Z y consultas comparten una sola exclusión por dispositivo.
- Un cierre Z no es una impresión inocua: modifica la jornada y los contadores
  fiscales y nunca se reintenta por descarte.

## Criterio de salida de la fase

La fase termina solo cuando dos combinaciones exactas e independientes de
proveedor, familia, modelo, firmware, interfaz, versión de protocolo o SDK y
plataforma, una por cada perfil soportado:

- figura en una matriz de compatibilidad con evidencia vigente;
- superó contract tests de bytes o llamadas SDK/DLL, según la vía oficial, y de
  estados contra la especificación del fabricante;
- superó pruebas con hardware fiscal autorizado y con simulador oficial cuando
  el fabricante disponga de uno;
- se recupera de desconexión, pérdida de respuesta, reinicio y papel agotado sin
  duplicar factura, nota, X o Z;
- funciona desde el artefacto Windows empaquetado, no únicamente en desarrollo;
- tiene runbook de instalación, diagnóstico, contingencia y reconciliación;
- cuenta con evidencia fechada del registro completado ante fabricante o
  representante conforme al artículo 51;
- superó revisión regulatoria vigente y coexistencia con el DCTD exigidas para
  el piloto.

Completar esta fase declara soporte solo para esas dos filas de la matriz. La
evidencia de un perfil no valida el otro. Las demás marcas, familias, modelos y
firmwares permanecen no soportados hasta repetir el gate, adaptador y
calificación.
