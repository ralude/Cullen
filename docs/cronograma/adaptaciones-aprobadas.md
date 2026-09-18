# Adaptaciones aprobadas al plan

Decisiones que **cambiaron el plan y siguen gobernando**: qué módulo entra en qué fase, qué se
divide, qué se difiere, qué gate existe y por qué. Se leen antes de asignar trabajo a una fase.

Lo que sólo registra que algo se hizo o se cerró está en la [bitácora](./bitacora.md). La
separación se hizo el 2026-09-18; hasta entonces ambas cosas convivían en este archivo y en el
[cronograma maestro](./README.md).

Las entradas **no se editaron** y conservan el orden en que fueron aprobadas, que es cronológico
y por eso mezcla fases. Reordenarlas por fase rompería las referencias que unas hacen a otras.
Las más antiguas están sin acentos, como se escribieron.

Una adaptación no sustituye a un ADR: cuando la decisión es normativa o cara de revertir, la
entrada enlaza el ADR que la gobierna.

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
- El 2026-09-09 se detalló la ejecución de Fase 12. El orden obligatorio queda
  12.01 baseline y presupuestos → 12.02 comunicación HTTP local → 12.03 SQLite e historia de
  inventario → 12.05 mantenibilidad y benchmark final. Cada cambio exige BEFORE/AFTER y puede
  descartarse si no supera el ruido. 12.04 conserva un gate separado por perfil fiscal y sigue
  suspendida con Fase 8; no se sustituye con `FiscalPrinterFake`.
- La planificacion regulatoria de Fase 8 reconoce que SNAT/2026/00084 derogo la SNAT/2024/000121 el 2026-08-12. La autorizacion por modelo y el registro del desarrollador ante el fabricante de SNAT/2018/0141 se verifican nuevamente antes del piloto.
- ADR-0008 establece terminales POS autonomas con Fastify y SQLite local; el nodo coordinador sincroniza eventos y datos de referencia.
- ADR-0009 establece tablas relacionales como fuente de verdad, ledger append-only para historia y outbox para entrega; no se usa event sourcing completo en el MVP.
- Antes de la Fase 9 se ejecuta el gate de seguridad de transporte autorizado el 2026-08-14; no adelanta cifrado ni hardening final de la Fase 11.
