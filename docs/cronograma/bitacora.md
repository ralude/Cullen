# Bitácora de avance

Registro fechado de lo que se cerró, se corrigió o se auditó, entrada por entrada. **No gobierna
nada**: es memoria de cómo se llegó al estado actual.

Lo que sí gobierna —qué entra en qué fase, qué se difiere, qué gate existe— está en
[adaptaciones aprobadas](./adaptaciones-aprobadas.md). El relato largo de cierre de cada fase
está en el [historial](./historial.md). El estado vigente, en el
[cronograma maestro](./README.md).

Las entradas **no se editaron** y conservan su orden original: varias se refieren a la anterior
y separarlas de él las dejaría sin antecedente. Las cifras de prueba que cita cada una son las
que estaban vigentes ese día, no las de hoy.

- El corte interno de 8.00 del 2026-08-31 separa retry de terminalidad,
  persiste evidencia fiscal en cuatro ejes y añade las migraciones 0010–0012
  con recuperación determinista e integridad fail-closed. Esto no cierra el
  gate: siguen pendientes fabricante, protocolo, registro, spike nativo y equipo.
- El segundo corte interno de 8.00 del 2026-08-31 actualiza Electron a 44.1.0,
  fija SerialPort 13.0.0 solo como candidato del spike y selecciona un proceso
  hijo supervisado como owner físico del binding. El gate sigue pendiente:
  faltan evidencia del fabricante, registro, decisiones del gap, laboratorio y
  pruebas nativas/HIL; ninguna integración fiscal real queda declarada.
- El 2026-09-03 se completó 9.01 con recuperación de sesión, acceso por PIN,
  cliente HTTP basado en contratos compartidos, navegación hash y estados de
  carga/error. Ponytail se aplicó solo al shell visual; no se agregó router,
  design system ni IPC de negocio.
- El 2026-09-03 se cerró 9.06 con ADR-0013: permisos propios de lectura para
  caja, auditoría y fiscalidad, límite de filas obligatorio recortado en
  aplicación, exportación CSV local sin permiso ni auditoría adicionales y
  captura manual de la jornada de X/Z. La auditoría no proyecta los resúmenes
  antes/después y la sincronización sigue como estado estático de Fase 10.
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
- El 2026-09-04 se completó la planificación de todas las sub-fases activas de 9B. Los planes
  9B.04-9B.06 y 9B.13-9B.18 fijan línea base comprobada, decisiones de frontera, orden
  outside-in, criterios verificables y fuera de alcance. 9B.08 mantiene su plan de
  diferimiento y 9B.09 no recibe plan porque su alcance fue trasladado íntegramente a 11.02.
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
- La auditoría focal del 2026-09-04 quedó documentada en el [registro de puntos
  clave de la Fase 11](./fase-11-seguridad/auditoria-puntos-clave-2026-09-04.md).
  Confirma la base arquitectónica, pero deja como deudas trazables la composición
  venta → caja → inventario, el redondeo de costo de 9B.04, la consolidación de
  `typecheck`, el arranque empaquetado, el uso de migraciones con respaldo, el
  transporte LAN, la administración de identidad, la política offline y la
  medición de crecimiento del inventario. Cada punto conserva su fase propietaria
  y no adelanta trabajo de Fase 10, 11 o 12.
- La Fase 1 se completó con Electron, React, Fastify, SQLite, Drizzle y ESLint instalados y verificados mediante smoke tests.
- El [hito transversal de cierre arquitectonico](./hito-cierre-arquitectonico.md) se completo el 2026-08-14 y habilito la continuacion desde 2.03.

- El 2026-09-18 la Fase 12 cerró con una excepción declarada: los dos puntos de su gate que exigen
  un verificador distinto de quien hizo el trabajo —la reproducción de la serie de 12.01 por un
  tercero y las sesiones reales de navegación de 12.05.01— pasaron de abiertos a **suspendidos por
  falta de verificador independiente**, la misma figura que ya gobierna a 12.04 con Fase 8. La
  decisión está en el [README de la fase](./fase-12-optimizacion/README.md#suspensión-de-la-verificación-independiente--2026-09-18)
  y no cambia ninguna cifra publicada: la reducción de superficie de 12.05 sigue siendo inspección
  estática y la línea base de 12.01, una serie capturada por su autor. El cierre habilita la Fase
  12B, que es documental, y **no habilita la Fase 13**. Ese mismo día quedó preparado, sin
  ejecutar, el [guion de sesiones de navegación](./fase-12-optimizacion/guion-sesiones-navegacion-12.05.01.md),
  que admite contextos de agente nuevos y deja la suspensión levantable sin redescubrir el método.
