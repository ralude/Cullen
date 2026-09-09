# Gate de piloto en tienda

- **Estado:** Pendiente
- **Aplica después de:** release open source funcional
- **Bloqueo vigente:** la Fase 8 está suspendida y debe reanudarse y completarse
  antes de cerrar este gate; el modo fiscal simulado no habilita una tienda.
- **No bloquea:** el [release `v0.1.0` de portafolio](./release-v0.1-portafolio/README.md), que
  distribuye código fuente y opera explícitamente con `FiscalPrinterFake`.

## Propósito

Separar la publicación técnica del proyecto de la capacidad real para instalar, operar,
recuperar y soportar el sistema en una tienda.

## Tareas mínimas para piloto

El [paquete pre-piloto](./pre-piloto/README.md) entregó el empaquetado, el respaldo operativo y
el material LAN el 2026-09-09, conforme a
[ADR-0030](../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md). Lo entregado se marca
abajo; lo que sigue abierto conserva su casilla y su motivo.

- [ ] Configurar CI remoto obligatorio y umbrales de coverage acordados. Incluye ejecutar
  `wix build` en un runner Windows.
- [x] Generar instalador reproducible. El nodo se compila a un bundle y
  [`packaging/`](../../packaging/README.md) define el MSI de WiX que registra el servicio y
  aplica la ACL del directorio de datos; el arranque del artefacto —interfaz bajo `/app`, sesión,
  operación y recuperación tras reinicio, sin proxy de Vite— está probado y cierra CA-11.03-09.
  Ver [plan de empaquetado](./pre-piloto/plan-empaquetado-nodo.md).
- [ ] **Definir firma de ejecutables.** El MSI se construye sin firmar: no hay certificado
  disponible y un instalable sin firma no prueba su origen.
- [ ] **Validar el MSI en una estación de tienda real**, con el
  [runbook de instalación](../operacion/instalacion-estacion.md).
- [x] Emitir el material TLS de LAN. `generate-lan-material` produce una autoridad interna y el
  material por nodo, verificable y aceptado por el arranque una vez sellado; la emisión inicial y
  el alta de terminales tienen [runbook](../operacion/emision-material-lan.md).
- [ ] **Decidir la PKI del despliegue real.** Si la instalación tiene PKI corporativa, reemplaza
  a la autoridad interna. La sustitución de certificados vigentes sigue siendo un procedimiento
  coordinado dependiente de esa PKI (ver
  [rotación de material protegido](../operacion/rotacion-material-protegido.md)); **no está
  automatizada**.
- [x] Probar actualización, migración y rollback mediante backup. La ruta real de arranque lo
  cubre con respaldo cifrado, validación y restauración en 11.04.
- [x] Automatizar backup operativo periódico y ensayar restauración con datos representativos.
  El servicio toma copias diarias y semanales con retención propia, hay CLI de copia y
  restauración, y el ensayo que destruye la base y la restaura está automatizado. Ver
  [plan de respaldo operativo](./pre-piloto/plan-respaldo-operativo.md).
- [ ] **Ejecutar el ensayo de restauración en una estación real**, con su almacén de claves.
- [ ] Ejecutar chaos tests de energía, LAN, Electron y dispositivo fiscal.
- [ ] Conservar dos perfiles fiscales aprobados por Fase 8, cada uno con
  fabricante/representante, hardware autorizado y una fila exacta de modelo,
  firmware, protocolo o SDK, interfaz y plataforma. La tienda piloto puede usar
  uno de los perfiles, pero no una combinacion fuera de esas filas.
- [ ] Conservar por perfil evidencia vigente de autorizacion del modelo, registro
  del desarrollador de conectividad ante el fabricante y revision tributaria
  aplicable.
- [ ] Validar por perfil coexistencia con el DCTD en la topologia autorizada y
  documentar el responsable de configuracion, transmision y soporte.
- [ ] Aprobar la edicion y ciclo de seguridad de Windows; Windows 10 requiere
  LTSC vigente o ESU activo, no solo compatibilidad tecnica del binding.
- [ ] Revalidar el marco fiscal antes del piloto; no presentar SNAT/2024/000121 como vigente despues de su derogacion por SNAT/2026/00084.
- [ ] Definir configuración inicial de tienda, terminales, usuarios y dispositivos. El
  [runbook de instalación](../operacion/instalacion-estacion.md) cubre la estación y la
  provisión del primer administrador; falta la configuración de negocio de la tienda piloto.
- [ ] Crear runbooks de base de datos, red, caja y fiscalidad. Entregados los de
  [instalación](../operacion/instalacion-estacion.md),
  [respaldo](../operacion/respaldo-operativo.md),
  [emisión de material LAN](../operacion/emision-material-lan.md) y
  [rotación de material protegido](../operacion/rotacion-material-protegido.md); faltan los de
  caja y fiscalidad.
- [ ] Definir exportación segura de diagnóstico y política de soporte.

## Deuda registrada fuera de este gate

El residuo de redondeo del costeo pertenece a 9B.04 y no bloquea el piloto por sí mismo; su
[análisis y recomendación](./fase-09b-perfiles/analisis-residuo-costeo.md) está acotado y
declarado. No se cierra sin un ADR que enmiende ADR-0016.

## Criterio de salida

Una instalación piloto puede desplegarse, actualizarse, recuperarse y diagnosticarse sin procedimientos improvisados ni pérdida silenciosa de operaciones.
