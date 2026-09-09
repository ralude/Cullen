# Cronograma del Proyecto

Este directorio es la fuente única de verdad para el avance por fases. Cada fase tiene un README explicativo y un archivo independiente por sub-fase.

## Estado actual

| Fase | Nombre | Estado |
|---:|---|---|
| 0 | Arquitectura | ~~Completada~~ |
| 1 | Infraestructura | ~~Completada~~ |
| 2 | Codigo de negocio | ~~Completada~~ |
| 3 | Persistencia | ~~Completada~~ |
| 4 | Ledger, outbox y auditoria | ~~Completada~~ |
| 5 | Caja operativa | ~~Completada~~ |
| 6 | Inventario operativo | ~~Completada~~ |
| 7 | Driver fiscal fake | ~~Completada~~ |
| 8 | Integracion serial | Suspendida por dependencia externa |
| 9 | UI | ~~Completada~~ |
| 9B | Perfiles operativos | ~~Completada para el MVP técnico 2026-09-05~~; 9B.08 transferida a Fase 13 y 9B.09 trasladada a Fase 11 |
| 10 | Sincronizacion | ~~Completada~~ |
| 11 | ~~[Seguridad](./fase-11-seguridad/README.md)~~ | Entregada el 2026-09-08; la [auditoría de cierre del 2026-09-09](./fase-11-seguridad/auditoria-cierre-2026-09-09.md) corrigió sus trece hallazgos. El gate de tienda conserva sus requisitos propios, sin bloquear el release open source |
| 12 | [Optimización](./fase-12-optimizacion/README.md) | Planificada después de `v0.1.0`: 12.01 → 12.02 → 12.03 → 12.05; 12.04 suspendida con Fase 8 |
| 12B | [Manual de usuario no técnico](./fase-12b-manual-usuario/README.md) | Planificada el 2026-09-09 después de `v0.1.0`; fase documental, no bloquea ni depende de Fase 12 |
| 13 | [Almacenes por sucursal](./fase-13-almacenes/README.md) | Planificada; post-MVP, sin iniciar |
| 14 | [Plataforma central PostgreSQL](./fase-14-plataforma-central/README.md) | Planificada; post-MVP, sin iniciar |
| 15 | [Sincronización SQLite–PostgreSQL](./fase-15-sincronizacion-cloud/README.md) | Planificada; post-MVP, sin iniciar |
| 16 | [Web App interna Next.js](./fase-16-web-app/README.md) | Planificada; post-MVP, sin iniciar |
| 16B | [Sistema de diseño propio](./fase-16b-sistema-diseno/README.md) | Planificada; post-MVP, sin iniciar |
| 17 | [Validación y despliegue gradual](./fase-17-validacion-despliegue/README.md) | Planificada; post-MVP, sin iniciar |

**Hito actual:** [release open source `v0.1.0`](./release-v0.1-portafolio/README.md), en ejecución
desde el 2026-09-09 como código fuente y demo reproducible en `SIMULACION`, sin hardware fiscal ni
publicación de un MSI sin firma. Sus cinco etapas son alcance, CI remoto, demo limpia,
documentación y publicación.
[V0.1.00](./release-v0.1-portafolio/0-alcance-y-verdad.md) cerró el 2026-09-09.
[V0.1.01](./release-v0.1-portafolio/1-ci-reproducible.md) cerró el mismo día: el pipeline corre
en GitHub Actions sobre `windows-latest` y su primer run sobre `main` terminó verde.
[V0.1.02](./release-v0.1-portafolio/2-demo-en-entorno-limpio.md) verificó el clon limpio y
corrigió tres pasos implícitos del README; su recorrido interactivo y sus capturas exigen una
estación Windows limpia y siguen abiertos.
[V0.1.03](./release-v0.1-portafolio/3-documentacion-portafolio.md) entregó contribución,
seguridad y las notas de versión en borrador; solo le faltan esas capturas.
[V0.1.04](./release-v0.1-portafolio/4-publicacion.md) no se inicia hasta cerrar las anteriores.
Fase 11 entregó sus cinco sub-fases y la
[auditoría de cierre del 2026-09-09](./fase-11-seguridad/auditoria-cierre-2026-09-09.md) corrigió
trece hallazgos, cada uno con su prueba. En la verificación local del 2026-09-09 aprobaron
`pnpm lint`, `pnpm typecheck`, `pnpm test` —1.212 de 1.212 pruebas en 191 archivos— y
`pnpm build:artifacts`. Las tres pruebas de `generate-lan-material.test.ts` que antes quedaban
sin completar la emisión TLS pasan cuando el intérprete alcanza `openssl` en su `PATH`; el
diagnóstico anterior atribuía al host una carencia que era del entorno de ejecución. Ese mismo
pipeline ya corre en un runner remoto, y no solo en la máquina del autor.

Fase 12 comienza después de publicar `v0.1.0`: 12.01–12.03 y 12.05 preparan una versión
posterior; 12.04 continúa suspendida con Fase 8. La
[Fase 12B](./fase-12b-manual-usuario/README.md), planificada el 2026-09-09, también espera al
release: entrega el manual de usuario no técnico que cubre las doce pantallas de la navegación
más el ingreso, el cambio de PIN y el enrolamiento. Es documental, no depende de Fase 12 ni la
bloquea, y absorbe [`operacion-diaria.md`](../operacion/operacion-diaria.md), que queda como
redirección al cerrarse. Sus tres decisiones de alcance —una captura por pantalla, absorción de
la guía anterior y ejecución posterior al release— quedaron fijadas el 2026-09-09 en su README.

El release de portafolio no habilita una tienda: el
[gate de piloto](./gate-piloto-release.md) conserva sus requisitos de hardware, fabricante,
laboratorio y operación real.
Desde el 2026-09-09 corre en paralelo el [paquete pre-piloto](./pre-piloto/README.md), que **no
es una fase**: entrega capacidad de despliegue que el gate de piloto ya exigía —empaquetado del
nodo, respaldo operativo y material TLS de LAN— sin reabrir la Fase 11 ni adelantar la 12.
**Fase 10, completada el 2026-09-07:** 10.01 entregó el outbox
durable ordenado por agregado con claims generacionales; 10.02 el protocolo de eventos de
[ADR-0023](../architecture/adr/0023-protocolo-de-eventos-entre-nodos.md); 10.03 el servidor
receptor y la base operativa LAN; y 10.04 la operación offline con reconexión.

El cierre incluye: registro confiable de nodos con alta y revocación auditadas; transporte
HTTPS con autenticación mutua en un listener técnico separado; custodia durable con
deduplicación, cuarentena y ACK posterior al commit; tres consumidores compuestos —inventario
autoritativo, referencias y consolidación comercial—; el conjunto cerrado de referencias con
catálogo, categorías, unidades, métodos de pago, políticas operativas, tasas confirmadas,
concesiones de operador y disponibilidad informativa; el costo conocido al vender con
`SaleCompleted.v2`; la infraestructura durable de intención, paso y consulta de progreso; y el
estado visible con la antigüedad real de cada referencia; los efectos remotos autoritativos de
compra, conteo y devolución con su conciliación de `APPLIED`, `DISCREPANCY` y estados
desconocidos; los once escenarios de corte; y la interacción automatizada de la pantalla de
sincronización sobre `jsdom`. Migraciones 0028–0042.

Verificación de cierre: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`,
`pnpm test` (915 pruebas en 150 archivos, verdes) y `git diff --check` aprobados. Quedan fuera
del alcance cerrado la compensación explícita de un rechazo definitivo, que conserva un gate
separado, la administración de usuarios y roles de 11.02, las tiendas con historia y cualquier
piloto o producción; el hardware fiscal sigue siendo fake y toda representación conserva
`SIMULACION`.

El 2026-09-06 se planificó la secuencia restante **10.03 → 10.04** en el
[registro de decisiones y gates](./fase-10-sincronizacion/plan-secuencia-y-decisiones.md),
con planes de [receptor LAN](./fase-10-sincronizacion/plan-10.03-servidor-receptor.md) y
[operación offline/reconexión](./fase-10-sincronizacion/plan-10.04-offline-reconexion.md).
El usuario confirmó LAN operativa completa, nodos nuevos de prueba y alta manual auditable
de confianza. La planificación incorpora las brechas de referencias, bootstrap y entrega
por terminal de ADR-0023. Esa planificación se ejecutó completa, incluido el flujo remoto de D3
que la auditoría del 2026-09-07 había reabierto.
Las preguntas de negocio se resolvieron en la misma sesión y quedaron en
[ADR-0026](../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md), aceptado para
el MVP de prueba: operaciones de stock conectadas con conciliación recuperable, concesiones
de ocho horas, snapshot de costo al vender y diez intentos por ciclo con reanudación manual.

El
[plan correctivo de la auditoría del 2026-09-05](./fase-09b-perfiles/plan-correcciones-auditoria-9b.md)
quedó **cerrado el 2026-09-05** (Cortes 0-4). La auditoría había reabierto 9B.04, 9B.06, 9B.07
y 9B.11 y bloqueado 9B.12/9B.13 por decisiones pendientes.

Resultado del gate (580 pruebas / 119 archivos verdes; `typecheck`, `lint`, `git diff --check`
limpios):

- **Corte 0:** persistencia de `originNodeId` completada (migración `0026-aggregate-origin-node`,
  backfill solo desde la auditoría de creación, triggers de obligatoriedad e inmutabilidad).
- **Decisiones bloqueantes aceptadas:** ADR-0016 (moneda de valoración de escritura única +
  riesgo de margen mudo aceptado y «valoración inicial administrativa» diferida); M5 (un conteo
  `OPEN` por nodo; diferencia congelada aplicada como delta con signo); ADR-0017 punto 8 /
  FS-006 (reintegro por método original; esperado negativo exige motivo y autorización de
  supervisor al cierre, `SHIFT_NEGATIVE_EXPECTED_REASON_REQUIRED`, implementado en
  `CloseShift`); M8 (`originNodeId` como nodo de origen fijo e inmutable para `Branch`,
  `Device`, `StockCount`, `PurchaseReceipt`).
- **Corte 1:** invariante de costo, `PURCHASE_RECEIPT_SOURCE_DUPLICATED`, `DRAFT` sin efectos
  durables, `reverse()` validado antes de compensar, ownership de recepción.
- **Corte 2:** autorización en aplicación de todas las lecturas (incl. `GetKardex` con
  `inventory.kardex.read`), matriz de permisos ampliada, unicidad de identificador de
  dispositivo (app + índice `0024`), motivo del operador e idempotencia por intención en el
  renderer, `OPEN` único por nodo, `formatScaledDecimal` sin `float`, tipos reales de Electron.
- **Corte 3:** `GetSaleHistory` pliega devolución y cambio de destinatario, autoriza con
  `sale.history.read` y acota versiones; cierre con esperado negativo; "turno ajeno" definido
  como `Shift.openedBy !== actor`.
- **Corte 4:** margen neto de descuentos y devoluciones, período UTC válido con cota en SQL,
  `quantitySoldScaled` derivado sin costo, escalas incompatibles separadas, `currencyCode`
  normalizado a mayúsculas en la frontera.

Tras cerrar el gate se completaron **9B.12** (lectura de arqueo `GetShift` con pertenencia por
`Shift.openedBy` y `cash.shift.read.any`; `GET /api/v1/sales/:saleId/history` con
`sale.history.read`) y **9B.13** (`reports.sales.read` y `reports.inventory.read` con
adaptadores SQLite acotados, rutas y panel del renderer con exportación CSV; margen ya
corregido en el Corte 4). El 2026-09-05 se completaron **9B.10** y los perfiles
**9B.14-9B.18**, que ensamblan pantallas y controles a partir de permisos efectivos. Único diferido: el caso de uso de
corrección administrativa de `originNodeId`, solo si una migración real produce una fila sin
resolver.

9B.11 - Sucursales y dispositivos se marcó **completada** el 2026-09-04, con alcance recortado
(ver más abajo). 9B.07 - Conteos físicos quedó **completada** el 2026-09-04. 9B.03 -
Proveedores quedó **completada** el 2026-09-04. Su
[plan](./fase-09b-perfiles/plan-9b.03-proveedores.md) detectó que el snapshot de una recepción
`COMPLETED` exige costos de 9B.04 y que la arquitectura aún no reconocía `Supplier` ni
`PurchaseReceipt` como raíces. [ADR-0019](../architecture/adr/0019-proveedores-y-recepciones-de-compra.md)
implementó el maestro `Supplier` y reservó la recepción completa para 9B.04. La sub-fase
entregó el maestro persistido y auditado, la pantalla administrativa con controles derivados
de los permisos efectivos, la recepción sin datos técnicos escritos por el renderer y, en su
corte de cierre, las reglas fiscales aprobadas por el negocio: RIF venezolano estructural sin
checksum, identidad genérica `TAX_ID` fuera de Venezuela, dirección fiscal estructurada y
semántica diferenciada de `BLOCKED` e `INACTIVE`.

9B.07 - Conteos físicos entregó `StockCount` como raíz separada de `StockItem`, con ciclo de
vida `OPEN -> COUNTED -> APPROVED|REJECTED`: `CloseStockCount` congela la diferencia de cada
línea contra el saldo vigente y `ApproveStockCount` la usa para registrar los ajustes
derivados, coordinando ambas raíces dentro de una sola `UnitOfWork`. Su
[plan](./fase-09b-perfiles/plan-9b.07-conteos-fisicos.md) dejó cuatro decisiones abiertas que
se resolvieron con el criterio más conservador y consistente con el código existente —
diferencia congelada al cierre, granularidad por lote impuesta por la invariante ya vigente de
`StockItem`, alcance del conteo limitado a las líneas registradas y separación de funciones
solo por asignación de permiso — documentadas en el corte de la sub-fase para que el negocio
las confirme o las corrija. No requirió ADR porque ninguna es una regla fiscal, contable o
legal: son decisiones de diseño reversibles.

9B.11 - Sucursales y dispositivos entregó `Branch` (maestro con código elegido por el
administrador, no generado por secuencia) y `Device` (raíz con tipo inmutable de lista
cerrada, identificador editable y `branchId` opcional). Su
[plan](./fase-09b-perfiles/plan-9b.11-sucursales-y-dispositivos.md) dejó abierta la relación
entre un nodo y su sucursal (¿un nodo pertenece a una sola sucursal, o una sucursal agrupa
varios nodos?); en vez de bloquear la sub-fase completa por esa pregunta no resuelta, se
recortó el alcance a lo que no depende de ella: administrar sucursales y etiquetar
opcionalmente qué dispositivo pertenece a cuál, sin que la estación declare su propia
sucursal como identidad de nodo. Una prueba de contrato demuestra que declarar una impresora
fiscal no altera `GET /api/v1/system/capabilities`, que sigue reportando `SIMULATION`.

El mismo 2026-09-04 se corrigió una excepción arquitectónica que el ADR-0012 dejó pendiente:
`OperationalPolicyWriter` (activación de las políticas versionadas de IGTF y descuento
máximo) vivía solo en `packages/drivers/db`, sin puerto en `core/application`. Se movió el
puerto a `core/application/ports` y `SqliteOperationalPolicyWriter` pasó a implementarlo; sin
cambio de comportamiento, `pnpm test` completo quedó verde en ese corte. Esto dejó lista la base para
que 9B.10 publique sus casos de uso de administración fiscal sin nueva cirugía.

La Fase 9B no tiene un gate legal global, pero desde el 2026-09-05 sí tiene un gate técnico
correctivo. 9B.04, 9B.05 y 9B.10 usan los defaults de referencia de ADR-0016, ADR-0018,
ADR-0017 y ADR-0021; 9B.12 queda acotada a lecturas, arqueos e historia, sin reapertura, y espera
las decisiones del corte 3. 9B.08 queda diferida por ADR-0020. Los perfiles 9B.14-9B.18 se
ensamblan solo después de cerrar el gate, según las capacidades disponibles.
Todas las sub-fases activas de 9B tienen ahora un plan de ejecución enlazado desde el índice de
la fase. 9B.08 conserva su plan de diferimiento y 9B.09 queda excluida por haber sido retirada.

La fundación de 9B (9B.00 permisos efectivos, 9B.01 renderer y 9B.02 datos maestros) y las
sub-fases 9B.03, 9B.06, 9B.07 y 9B.11 se marcaron completadas el 2026-09-04. La auditoría del
2026-09-05 reabrió 9B.06, 9B.07 y 9B.11, además de 9B.04. 9B.06 dejó la devolución
total simulada con restauración de inventario, reintegro en el turno, nota recuperable y
auditoría, sin declarar cumplimiento fiscal. La Fase 9 cerró sus sub-fases y
la Fase 8 permanece suspendida: su validación de hardware y cumplimiento solo es requisito del
piloto o la producción. La Fase 10 cerró sus cuatro sub-fases el 2026-09-07.

## Fases

- [~~Fase 0 - Arquitectura~~](./fase-00-arquitectura/README.md)
- [~~Fase 1 - Infraestructura~~](./fase-01-infraestructura/README.md)
- [~~Fase 2 - Codigo de negocio~~](./fase-02-dominio/README.md)
- [~~Fase 3 - Persistencia~~](./fase-03-persistencia/README.md)
- [~~Fase 4 - Ledger, outbox y auditoria~~](./fase-04-event-store/README.md)
- [~~Fase 5 - Caja~~](./fase-05-caja/README.md)
- [~~Fase 6 - Inventario~~](./fase-06-inventario/README.md)
- [~~Fase 7 - Driver fiscal fake~~](./fase-07-driver-fiscal-fake/README.md)
- [Fase 8 - Integracion serial](./fase-08-integracion-serial/README.md)
- [~~Fase 9 - UI~~](./fase-09-ui/README.md)
- [~~Fase 9B - Perfiles operativos~~](./fase-09b-perfiles/README.md)
- [~~Fase 10 - Sincronizacion~~](./fase-10-sincronizacion/README.md)
- [~~Fase 11 - Seguridad~~](./fase-11-seguridad/README.md)
- [Fase 12 - Optimizacion](./fase-12-optimizacion/README.md)

## Reglas de seguimiento

1. Toda tarea terminada se marca como `- [x] ~~tarea~~` en su archivo de sub-fase.
2. Cuando todas las tareas de una sub-fase terminan, se marca su estado como `Completada` y se tacha el enlace en el README de la fase.
3. Cuando todas las sub-fases terminan, se tacha la fase en este índice y se avanza la fase actual.
4. Cada cambio de código o configuración debe indicar la fase y sub-fase que modifica.
5. No se trabaja en una fase futura mientras la fase actual tenga tareas abiertas, salvo una decisión documentada.
6. Las tareas completadas se conservan tachadas; no se eliminan del historial del cronograma.

## Adaptaciones aprobadas

- `currency` se incluye en la Fase 2 porque las ventas requieren moneda, tasas y pagos mixtos.
- `identity` se divide: el modelo `User`/`Role`/`Permission` se crea en la Fase 2; autenticacion, JWT y cifrado quedan en la Fase 11.
- `inventory` se divide: el dominio de movimientos se crea en la Fase 2; su flujo operativo y persistencia quedan en la Fase 6.
- La Fase 2 no imprime ni persiste; la persistencia comienza en la Fase 3 y el driver fiscal fake en la Fase 7.
- CI/CD se ejecuta inicialmente como scripts locales mediante `pnpm pipeline`, sin asumir una plataforma remota.
- La actualizacion diaria de tasas se resuelve con carga manual mas sugerencia externa con confirmacion humana (el driver propone, un humano confirma via `UpdateExchangeRate`); se agrega la sub-fase 9.07 a la Fase 9. La tasa externa nunca se aplica sola y el sistema opera offline con la ultima tasa vigente.
- La sub-fase 2.02 incluye la capa de aplicación del módulo `currency` (`UpdateExchangeRate`, `GetCurrentExchangeRate`, `CalculateMixedPaymentTotals`) porque 06-casos-de-uso.md las asigna a ese módulo y no había otra sub-fase que las cubriera.
- La sub-fase 2.03 implementa catálogo con referencias configurables de categoría y unidad, snapshots de producto y validación de barcode por puertos; no agrega persistencia ni CRUD de configuración.
- La sub-fase 2.04 implementa ventas puras con precio neto, descuentos porcentuales por línea, IGTF configurable, pagos mixtos exactos y autorización mínima; no modifica caja, inventario ni fiscalidad persistida.
- La sub-fase 2.05 implementa `Shift` como agregado de caja con ownership por terminal/nodo, movimientos manuales de efectivo, balances multi-moneda y cierre con arqueo; persistencia, auditoria y pagos derivados de venta quedan para fases posteriores.
- La sub-fase 2.06 implementa permisos de codigo estable, roles configurables y usuarios sin credenciales; autenticacion, sesiones, JWT y cifrado permanecen en la Fase 11.
- La sub-fase 2.07 implementa `StockItem` con movimientos append-only, cantidades escaladas y lotes opcionales; persistencia, FEFO, kardex e integracion con ventas permanecen en la Fase 6.
- La Fase 6 persiste inventario como movimientos append-only, recibe compras mediante un contrato minimo, descuenta ventas con FEFO e idempotencia y deriva el kardex sin almacenar saldos mutables.
- La Fase 7 implementó el puerto fiscal, un fake determinista, estados
  persistentes recuperables, emision y reportes X/Z. El gate 8.00 ya separó sus
  controles privados de las suites semánticas exclusivas de simulador y aisló
  X/Z detrás de consentimiento simulado explícito. No instala ni usa SerialPort.
- La Fase 8 comienza por 8.00 para cerrar las deudas de recuperacion de la Fase 7 y habilitar un primer perfil con evidencia primaria. El transporte serial y la recuperacion neutral se estabilizan con ese perfil; luego un gate, adaptador y HIL independientes califican el segundo, reutilizando SerialPort solo si su via oficial es compatible. La fase solo termina con dos combinaciones exactas soportadas, inicialmente candidatas PNP y The Factory HKA/ACLAS. ADR-0010 limita la genericidad al contrato semantico y, cuando aplica, al transporte serial; cada protocolo o SDK, modelo y firmware requiere evidencia y calificacion propias.
- El corte interno de 8.00 del 2026-08-31 separa retry de terminalidad,
  persiste evidencia fiscal en cuatro ejes y añade las migraciones 0010–0012
  con recuperación determinista e integridad fail-closed. Esto no cierra el
  gate: siguen pendientes fabricante, protocolo, registro, spike nativo y equipo.
- El segundo corte interno de 8.00 del 2026-08-31 actualiza Electron a 44.1.0,
  fija SerialPort 13.0.0 solo como candidato del spike y selecciona un proceso
  hijo supervisado como owner físico del binding. El gate sigue pendiente:
  faltan evidencia del fabricante, registro, decisiones del gap, laboratorio y
  pruebas nativas/HIL; ninguna integración fiscal real queda declarada.
- El 2026-09-01 se aprobó la
  [suspensión de Fase 8 y el avance a Fase 9](./replanificacion-fase-08-a-09.md)
  porque no están disponibles el hardware fiscal oficial, el protocolo/manual
  del fabricante ni el laboratorio requerido. La Fase 8 no se considera
  completada: la UI avanza con `FiscalPrinterFake` identificado como simulación
  y el piloto continúa bloqueado hasta reanudar y cerrar los dos perfiles.
- La suspensión de Fase 8 arrastra 12.04 porque no existe una implementación serial real que
  medir. Ninguna tarea de Fase 8 ni 12.04 bloquea el release open source `v0.1.0`. Después de
  publicarlo, 12.01–12.03 miden el modo simulado para una versión posterior; el fake fiscal no
  se usa como sustituto de parser, cola, CRC, transporte ni HIL.
- El 2026-09-02 se cerró 9.00 y se trasladaron las lecturas especializadas a su
  consumidor dueño: catálogo 9.04, reportes 9.06 y tasas 9.07. La
  sincronización pendiente conserva su implementación en Fase 10; no se
  publican respuestas ficticias para adelantarla.
- El 2026-09-03 se completó 9.01 con recuperación de sesión, acceso por PIN,
  cliente HTTP basado en contratos compartidos, navegación hash y estados de
  carga/error. Ponytail se aplicó solo al shell visual; no se agregó router,
  design system ni IPC de negocio.
- El 2026-09-03 se cerró 9.06 con ADR-0013: permisos propios de lectura para
  caja, auditoría y fiscalidad, límite de filas obligatorio recortado en
  aplicación, exportación CSV local sin permiso ni auditoría adicionales y
  captura manual de la jornada de X/Z. La auditoría no proyecta los resúmenes
  antes/después y la sincronización sigue como estado estático de Fase 10.
- El 2026-09-04 se aprobó la
  [inserción de la Fase 9B antes de la Fase 10](./replanificacion-fase-09b.md).
  La interfaz de Fase 9 está organizada por módulo técnico y no por trabajo real:
  la sesión entrega `roleCodes` que el renderer nunca lee, `permissionCodes` se
  calcula en aplicación y se descarta en el mapper HTTP, el campo `permission`
  que declara cada contrato no lo lee ningún código, y varias pantallas exigen
  escribir identificadores internos a mano. Además, cinco perfiles operativos
  dependen de capacidades inexistentes: clientes con RIF, proveedores como
  entidad, costo de compra, devoluciones, conteos, transferencias, alta de
  usuarios y roles, configuración de datos maestros y KPIs. La Fase 9B agrega
  esas diecinueve sub-fases sin renumerar ninguna fase; la administración de
  identidad que adelantaba de 11.02 se devolvió a la Fase 11 el 2026-09-04 y la
  fase quedó con dieciocho activas. No ejecuta trabajo de Fase 10: la
  sucursal es solo dato maestro y las transferencias quedan diferidas.
  El análisis de decisiones se conserva en el [registro de disposición de 9B](./fase-09b-perfiles/gate-decisiones-9b.md),
  que ya no bloquea el MVP: las reglas faltantes se cubren con defaults explícitos o se difieren.
  La Fase 8 sigue suspendida: la nota de crédito se rotula `SIMULACIÓN`. La Fase 12 conserva su
  alcance de optimización medida.
- El 2026-09-04 se completó la fundación de la Fase 9B (9B.00-9B.02). 9B.00
  agregó `permissionCodes` a la sesión (ADR-0015) y derivó de ahí la navegación
  y doce botones de comando del renderer. 9B.01 dividió `operation-screens.tsx`
  (561 líneas) en módulos por pantalla, sin cambio de comportamiento salvo
  reemplazar `window.confirm` de la anulación por confirmación en pantalla; el
  indicador de conexión de la barra superior se limitó a derivarse del ciclo de
  vida de sesión ya existente, no de un nuevo `/health` (no versionado, no
  proxiado en Vite) ni de sondeo periódico. 9B.02 publicó cuatro lecturas de
  datos maestros (categorías, unidades, métodos de pago, cajas) de extremo a
  extremo y las usó para reemplazar selectores de texto libre en catálogo, caja
  y venta; la venta deriva la escala de cantidad del producto escaneado y ya no
  puede producir `SALE_ITEM_QUANTITY_SCALE_MISMATCH`. Al implementar se encontró
  que `KardexDto` no exponía el `id` del stock item: se agregó, y con eso
  inventario dejó de pedirlo a mano y de enviar `unitCode`/`quantityScale`
  codificados en la recepción, cerrando una fuente silenciosa de
  `STOCK_ITEM_CONFIGURATION_MISMATCH`. Quedan reportadas, sin resolver: la
  recepción de un producto nunca antes recibido (el `stockItemId` de un
  agregado nuevo no es derivable sin decidir generación de id desde el
  renderer) y la cobertura de interacción DOM, que sigue sin entorno de
  pruebas (`jsdom`) en el monorepo.
- El 2026-09-04, el segundo corte de 9B.03 cerró esa recepción pendiente y
  agregó la pantalla administrativa de proveedores. `ReceivePurchase` dejó de
  aceptar `stockItemId`, `unitCode`, `quantityScale` y `tracksBatches`: la
  aplicación genera el artículo de la primera recepción, toma unidad y escala
  del producto del catálogo, rechaza un producto desconocido con
  `PRODUCT_NOT_FOUND` y escala la cantidad decimal del operador con la unidad
  derivada. La ruta `#/suppliers` se oculta sin permisos de proveedor porque su
  lectura solo existe para el selector de recepción. Queda reportado que
  `tracksBatches` de un artículo nuevo se fija según la primera recepción traiga
  lote o no: el catálogo no modela ese atributo y decidirlo pertenece a la
  configuración de datos maestros de 9B.10.
- El 2026-09-04 el negocio aprobó las reglas fiscales, documentales y de ciclo
  de vida que faltaban, ADR-0019 las incorporó y 9B.03 quedó completada. El
  maestro implementa RIF venezolano de una letra soportada más nueve dígitos
  **sin checksum**, porque el proyecto no tiene una fuente oficial verificable
  del SENIAT y no se copian algoritmos comunitarios como norma; identidad
  genérica `TAX_ID` fuera de Venezuela sin validadores por país; dirección
  fiscal estructurada en país y línea, opcional pero nunca a medias, con la
  migración forward-only `0016`; y estados diferenciados donde `BLOCKED` es
  suspensión temporal reversible e `INACTIVE` una relación retirada, ambos con
  historia conservada y revalidación de `ACTIVE` dentro de la transacción. El
  documento de origen (`INVOICE`/`DELIVERY_NOTE`), el ciclo
  `DRAFT -> COMPLETED -> REVERSED`, el reverso compensatorio con
  `replacesReceiptId` y la dirección obligatoria antes de completar quedan
  decididos en ADR-0019 y se implementan en 9B.04 con el costo de ADR-0016.
- El 2026-09-04 se corrigió el solapamiento entre la Fase 9B y la Fase 11. La
  sub-fase 9B.09, que existía solo como alcance adelantado de 11.02, se retiró
  y su alcance completo volvió a
  [11.02 Roles y permisos](./fase-11-seguridad/11.02-roles-permisos.md): alta de
  usuarios, creación de roles, asignación de permisos, bloqueo de
  auto-exclusión y su pantalla. El número 9B.09 no se reutiliza y ninguna
  sub-fase se renumera. Se revisó el resto de la fase contra las Fases 10, 11 y
  12 y no se encontró otra duplicación: 9B.08 y 9B.11 delimitan lo que
  pertenece a Fase 10 sin que exista una sub-fase de esa fase que lo cubra,
  9B.12 publica capacidades que 11.02 solo prueba desde la autorización y 9B.13
  publica lecturas que la Fase 12 no planifica. Queda declarado que hasta
  implementar 11.02 el único rol disponible es el administrador provisionado por
  CLI, y que 9B.17 deja de presentar usuarios y roles.
- El 2026-09-04 se planificaron las capacidades de negocio restantes de la Fase
  9B. El análisis confirmó que `stock_items.product_id` no puede representar varios
  almacenes sin cambiar la identidad de un agregado persistido; [ADR-0020](../architecture/adr/0020-modelo-de-almacenes-y-transferencias.md)
  dejó esa capacidad diferida. Los ADR-0016, ADR-0017 y ADR-0018 se redactaron inicialmente
  como bloqueos de negocio; [ADR-0021](../architecture/adr/0021-mvp-referencia-no-certificado.md)
  los convirtió en defaults de referencia reemplazables para el MVP no certificado. Este
  registro conserva el análisis original, pero el gate vigente es el de la Fase 8 y el piloto.
- El 2026-09-04 se completó la planificación de todas las sub-fases activas de 9B. Los planes
  9B.04-9B.06 y 9B.13-9B.18 fijan línea base comprobada, decisiones de frontera, orden
  outside-in, criterios verificables y fuera de alcance. 9B.08 mantiene su plan de
  diferimiento y 9B.09 no recibe plan porque su alcance fue trasladado íntegramente a 11.02.
- El 2026-09-05 una auditoría técnica abrió un
  [plan correctivo bloqueante](./fase-09b-perfiles/plan-correcciones-auditoria-9b.md). Reprodujo
  el fallo contractual que impedía ejecutar la devolución y reabrió 9B.04, 9B.06, 9B.07 y
  9B.11 por costo persistente, moneda de valoración, autorización, idempotencia, concurrencia,
  unicidad y ownership. También corrigió la línea base y los criterios de 9B.10, 9B.12 y
  9B.13: el módulo `config` y `reports.margin.read` ya existen; la historia debe incluir
  devoluciones; y el margen debe netear descuentos/devoluciones con período y cota SQL. No se
  inicia otra capacidad hasta cerrar las decisiones normativas, las pruebas observables y la
  suite completa.
- El 2026-09-04 se agregó la sub-fase correctiva 9.08 tras una auditoría de
  `apps/desktop`. Corrige el defecto reportado en la venta (barcode aceptado y
  pantalla en blanco), cuya causa raíz es del renderer: `Intl.NumberFormat` con
  un código de moneda desconocido lanzaba `RangeError` sin `ErrorBoundary` que
  lo contuviera, el campo de barcode se limpiaba aunque el nodo rechazara la
  línea y "Completar venta" se deshabilitaba sin declarar su causa. El servidor
  no participa del defecto. La misma sub-fase publica **Cullen** como nombre
  comercial visible del sistema, agrega retroalimentación visible por acción y
  retira el rótulo de sub-fase de las pantallas. No se agregaron dependencias:
  al no haber `jsdom` en el monorepo, la lógica corregida se extrajo a funciones
  puras probadas y la interacción DOM queda sin cobertura automatizada. Queda
  reportado y sin corregir que en un empaquetado real (`loadFile`) `fetch('/api/…')`
  resolvería a `file:///api/…`, porque el origen del nodo en producción es
  alcance de empaquetado. Fase 10 sigue sin iniciar.
- El 2026-09-04 se cerró 9.07 con ADR-0014, y con ello la Fase 9 completa:
  vigencia por `validFrom` más reciente sin cerrar ventanas solapadas, límite
  de histórico acotado (1-500, 100 por defecto), lecturas de moneda con solo
  sesión verificada y timeout configurable sin reintento automático. La fuente
  externa de sugerencia (proveedor, credenciales, pares por tienda) queda
  diferida como decisión de negocio; el mecanismo es agnóstico de proveedor y
  falla cerrado con `EXCHANGE_RATE_PROVIDER_NOT_CONFIGURED` sin bloquear la
  tasa vigente, el histórico ni la carga manual. El avance a Fase 10 no inicia
  su implementación; solo refleja que Fase 9 no tiene tareas abiertas.
- El 2026-09-07 se ratificó el gate de salida de Fase 9 con un E2E real del
  camino crítico de venta: `App` montada → `fetch` → listener Fastify → SQLite.
  El escenario automatiza ingreso, resolución del turno, escaneo, cobro y
  finalización, y verifica la venta `COMPLETED` en la base. Las coberturas con
  API o transporte simulados quedan clasificadas como interacción o contrato,
  no como evidencia E2E autónoma.
- El 2026-09-07 se planificaron las sub-fases pendientes de la Fase 11 en el
  [plan de secuencia y decisiones](./fase-11-seguridad/plan-secuencia-y-decisiones.md) y los
  planes de 11.02, 11.03, 11.04 y 11.05. La secuencia no sigue la numeración: el corte de
  redacción de 11.05 se adelanta como prerrequisito de 11.02, porque 11.02 introduce los
  primeros endpoints que transportan un PIN fuera del login; después van 11.02, 11.03, 11.04 y
  los cortes restantes de 11.05. La línea base verificada dejó cuatro brechas concretas que
  ninguna especificación había nombrado: no existe ningún camino para crear un operador
  —`ProvisionInitialAdmin` se niega si ya hay uno—, nada incrementa `authorization_version`
  aunque la revocación por cambio de autorización ya esté implementada en la lectura de sesión,
  una denegación de permiso no deja rastro auditable, y el arranque real llama `applyMigrations`
  en vez de la ruta con respaldo y restauración que el driver ya ofrece. La planificación
  registró inicialmente nueve decisiones abiertas (D1-D9): siembra de roles,
  ciclo de vida del operador, restablecimiento de PIN, definición de último administrador y
  dueño de la identidad en LAN para 11.02; alcance del transporte para 11.03; cifrado en reposo,
  retención y rotación para 11.04. La revisión del 2026-09-08 corrigió D6: AGENTS.md y ADR-0026
  ya exigen loopback, por lo que no requiere un ADR nuevo ni bloquea 11.03. D1-D5 y D7-D9
  siguen abiertas y requieren ADR nuevos. La planificación no inicia implementación ni adelanta
  trabajo de las Fases 4, 5, 6, 10 o 12, que
  conservan la propiedad de los puntos 1, 2, 8 y 9 de la auditoría.
- El 2026-09-08 se corrigieron los planes de Fase 11 tras una segunda revisión: auditoría de
  rechazos mediante `UnitOfWork` independiente; transición autorizada de permisos para bases ya
  provisionadas; comandos y permisos concretos en las pruebas, con la ambigüedad de
  `CompleteSale` pendiente de aclaración normativa; y línea base de inventario ajustada a la
  composición ya existente. 11.05 distingue rechazo local, aplicación remota pendiente y
  discrepancia. Las correcciones documentales no inician ni completan implementación.
- El 2026-09-08 se cerró la Fase 11. Se entregaron 11.01–11.05: autorización e identidad
  auditable con contención multiproceso del último administrador, confinamiento del transporte
  de operadores y política única de cookie, protección en reposo conforme a ADR-0029 —ACL
  verificada, cifrado AES-256-GCM de respaldos y secretos, custodia por el almacén del sistema
  operativo—, retención y rotación de clave con conservación de claves retiradas referenciadas,
  separación de logs técnicos y auditoría append-only, y diagnóstico correlacionado con
  allowlist y pantalla desktop. `pnpm pipeline` cerró verde con 1.182 pruebas en 186 archivos.
  Quedan declaradas fuera de alcance y abiertas en el gate de piloto: el arranque empaquetado
  de Electron, el backup operativo periódico independiente de actualizaciones y la sustitución
  coordinada de certificados TLS dependiente de la PKI. La deuda contable de residuo/redondeo
  de 9B.04 y la ausencia de garantía de stock global durante desconexión permanecen explícitas.
  Este cierre no habilita el piloto ni inicia la Fase 12.
- El 2026-09-09 una auditoría de cierre revirtió esa certificación: quedó registrada en
  [auditoria-cierre-2026-09-09.md](./fase-11-seguridad/auditoria-cierre-2026-09-09.md) con trece
  hallazgos validados. Los cuatro P1 —revocación de concesiones que dejaba de aplicarse tras el
  primer enrolamiento, rotación de claves capaz de destruir material sin evidencia, diagnóstico
  bloqueado unos 500 segundos con el coordinador caído y almacén de claves sobrescrito sin
  publicación atómica— se corrigieron ese día, cada uno con la prueba que lo reproduce. Los seis
  P2 —aislamiento del diagnóstico entrante, directorio de operadores concedidos, cookie de sesión
  ilegible, PIN retenido tras un fallo, respaldo intermedio en claro y rutas de material en el
  texto libre de los logs— y los tres P3 —una denegación auditada que no correspondía a ninguna
  decisión, una acción de enrolamiento sin jerarquía visual y dos formularios competidores— se
  cerraron con la misma exigencia de prueba. La evidencia vigente consta en el registro. El cierre
  de la auditoría habilita planificar `v0.1.0`, no una tienda: el gate de piloto conserva el
  instalable firmado, hardware y validación real.
- El 2026-09-09 se detalló la ejecución de Fase 12. El orden obligatorio queda
  12.01 baseline y presupuestos → 12.02 comunicación HTTP local → 12.03 SQLite e historia de
  inventario → 12.05 mantenibilidad y benchmark final. Cada cambio exige BEFORE/AFTER y puede
  descartarse si no supera el ruido. 12.04 conserva un gate separado por perfil fiscal y sigue
  suspendida con Fase 8; no se sustituye con `FiscalPrinterFake`.
- La auditoría focal del 2026-09-04 quedó documentada en el [registro de puntos
  clave de la Fase 11](./fase-11-seguridad/auditoria-puntos-clave-2026-09-04.md).
  Confirma la base arquitectónica, pero deja como deudas trazables la composición
  venta → caja → inventario, el redondeo de costo de 9B.04, la consolidación de
  `typecheck`, el arranque empaquetado, el uso de migraciones con respaldo, el
  transporte LAN, la administración de identidad, la política offline y la
  medición de crecimiento del inventario. Cada punto conserva su fase propietaria
  y no adelanta trabajo de Fase 10, 11 o 12.
- La planificacion regulatoria de Fase 8 reconoce que SNAT/2026/00084 derogo la SNAT/2024/000121 el 2026-08-12. La autorizacion por modelo y el registro del desarrollador ante el fabricante de SNAT/2018/0141 se verifican nuevamente antes del piloto.
- La Fase 1 se completó con Electron, React, Fastify, SQLite, Drizzle y ESLint instalados y verificados mediante smoke tests.
- ADR-0008 establece terminales POS autonomas con Fastify y SQLite local; el nodo coordinador sincroniza eventos y datos de referencia.
- ADR-0009 establece tablas relacionales como fuente de verdad, ledger append-only para historia y outbox para entrega; no se usa event sourcing completo en el MVP.
- Antes de la Fase 9 se ejecuta el gate de seguridad de transporte autorizado el 2026-08-14; no adelanta cifrado ni hardening final de la Fase 11.
- El [hito transversal de cierre arquitectonico](./hito-cierre-arquitectonico.md) se completo el 2026-08-14 y habilito la continuacion desde 2.03.

## Documentos transversales

- [Release open source `v0.1.0`](./release-v0.1-portafolio/README.md) — cinco etapas secuenciales
  para alcance, CI, demo limpia, documentación y publicación del código fuente en GitHub. No
  exige hardware fiscal y no adjunta un MSI sin firma.

- [Paquete de trabajo pre-piloto](./pre-piloto/README.md) — abierto el 2026-09-09 con
  [ADR-0030](../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md). Entrega empaquetado del
  nodo como servicio de Windows, respaldo operativo y emisión de material TLS de LAN. No es una
  fase, no renumera nada y no cierra el gate de piloto.

- [Fase 12.05 — Mantenibilidad estructural y eficiencia de contexto](./fase-12-optimizacion/12.05-mantenibilidad-estructural.md)
  — añadida el 2026-09-08 con diagnóstico de hubs y baseline estática reproducible.
  Con la Fase 11 entregada el 2026-09-08 la ejecución queda desbloqueada, pero no cambia la fase
  activa ni el gate fiscal y no se inician refactors.

- [Evolución post-MVP: almacenes, nube y consulta web](./evolucion-post-mvp.md) — aprobada
  el 2026-09-06; secuencia 13 → 14 → 15 → 16 → 16B → 17 después del cierre técnico del MVP.
  Next.js, Tailwind y TanStack Query en 16; sistema propio basado en shadcn/ui en 16B;
  Zustand para estado UI cuando corresponda. Ponytail no aplica en 16 ni 16B.
  La planificación no cambia la fase activa ni declara implementación.
- [Replanificación de Fase 8 a Fase 9](./replanificacion-fase-08-a-09.md)
- [Replanificación: inserción de Fase 9B](./replanificacion-fase-09b.md)
- [Estrategia de testing](./testing.md)
- [CI/CD local](./ci-cd.md)
- [Hito de cierre arquitectonico](./hito-cierre-arquitectonico.md)
- [Gate de seguridad antes de UI operativa](./gate-seguridad-pre-ui.md)
- [Gate de piloto en tienda](./gate-piloto-release.md)
- [Alcance por nivel de entrega](../producto/alcance-entregas.md)
