# Plan de ejecución 10.03: servidor receptor y base operativa LAN

- Fecha: 2026-09-06.
- Estado: cortes 1, 2 y 3 (inventario) implementados el 2026-09-06; corte 4 parcial; corte 0 abierto.
- Predecesora: 10.02 completada. Sucesora: 10.04, solo tras cerrar esta sub-fase.
- Decisiones: [secuencia y registro D1–D8](./plan-secuencia-y-decisiones.md).
- ADR: [ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md), aceptado; detalle contractual en el corte 0.

## Objetivo y lecturas

Recibir hechos con identidad verificada, conservarlos antes de confirmar custodia y
procesarlos de forma recuperable. Entregar los contratos y adaptadores necesarios para
que 10.04 conecte una LAN operativa con catálogo/referencias y disponibilidad informativa.

Leer AGENTS.md; arquitectura 01, 02, 03, 05, 06, 08, 10, 11 y 12; ADR-0001, 0003,
0005–0009, 0011, 0012, 0016, 0017, 0022 y 0023; FS-004–FS-008; los contratos de los
dominios afectados. Las nuevas decisiones complementan estos documentos; no los contradicen
mediante un plan o PRP de menor autoridad.

## Alcance y fronteras

El usuario confirmó LAN operativa completa, nodos nuevos de prueba y confianza provisionada
manualmente. Incluir los productores y consumidores de referencias faltantes, carga inicial
y estado de entrega por terminal. La historia de tiendas existentes necesita un gate
independiente; no se drena ni se resetea por efecto de esta sub-fase.

Se reutilizan `ReceiveSyncEvent`, `SyncReceptionStore`, `AggregateAuthorityRegistry`,
`OutboxRelay`, validadores y `UnitOfWork`. No se agrega otra cola con copias de payload ni
un bus genérico. Un driver de transporte concreto solo se crea donde lo exija un puerto
y respetando exports públicos; `apps/server` compone, autentica y adapta, sin SQL ni negocio.

## Corte 0: contrato aprobado antes del código

El mecanismo de distribución y el vertical de catálogo quedaron especificados el 2026-09-06 en
[corte 0: distribución de referencias](./plan-10.03-corte-0-referencias.md), con el conjunto
cerrado acotado al mínimo operativo, entrega push del coordinador y contratos de estado
completo versionado. El resto del conjunto reutiliza ese mecanismo en cortes posteriores.

1. Especificar D1–D7 según ADR-0026: las preguntas de negocio quedaron resueltas. Documentar
   DTOs, transiciones, fingerprints y permisos por operación antes de sus pruebas outside-in.
2. Cerrar alta/revocación de nodos, asociación nodo/terminal/tienda y autoridad de agregados
   nuevos. La comprobación también cubre reentregas: conocer un `eventId` no autoriza a
   consultar su ACK ni a eludir la identidad del emisor.
3. Publicar el contrato de transporte: ruta técnica propuesta `POST /sync/v1/events`, un
   sobre por solicitud; identidad de destino requerida; límites v1 y respuestas seguras.
   Formalizar el mapeo entre errores HTTP `application/problem+json` y rechazos/ACK de sync:
   un 2xx aislado nunca significa entrega, y una respuesta sin identidad de evento válida
   no sirve como ACK. Conservar cookies y endpoints de operadores en loopback.
4. Fijar estados internos de procesamiento, dependencias, discrepancia y revisión, con
   transiciones y evidencia durable. El resultado v1 de recepción permanece inmutable;
   progreso posterior se expone por lectura separada, conforme D7 y ADR-0026.
5. Para cada referencia necesaria, especificar productor, autoridad, versión, corte inicial,
   consumidor, datos mínimos y aplicación atómica: catálogo/precios/impuestos, categorías,
   unidades, métodos de pago, políticas operativas, tasas confirmadas, concesiones y
   disponibilidad. Incluir cambios/desactivaciones, no solo altas. Delimitar proveedores y
   configuración de sucursal/dispositivos según los casos de uso LAN realmente habilitados.
6. Evaluar cada consumidor contra payloads reales. Publicar versiones nuevas o contratos
   nuevos cuando falten datos; conservar intactos los once v1 originales y sus fixtures.
   Definir también
   qué proyecciones de ventas/caja/fiscalidad bastan para el coordinador, sin importar sus
   agregados operativos ni volver a ejecutar efectos locales.

Salida: decisiones aceptadas, contratos suficientes y CA de este plan revisados; ninguna
decisión pendiente se convierte en default de negocio durante la implementación.

## Corte 1: persistencia receptora outside-in

1. Prueba roja del caso de uso: evento válido con emisor autorizado adquiere custodia una
   vez; reentrega idéntica conserva el ACK; cambio de cualquier dato inmutable es conflicto.
2. Coordinar deduplicación, clasificación y registro en una unidad transaccional. Un índice
   único por `eventId` arbitra la concurrencia; una colisión se relee y compara, no se declara
   duplicado a ciegas. Orden por agregado sin exigir versiones consecutivas ni unicidad por versión.
3. Persistir evento validado, recepción, resultado de custodia y trabajo de aplicación
   pendiente juntos. Ningún ACK sale antes del commit; rollback no deja trabajo huérfano.
4. Implementar autoridad durable e inmutable desde evidencia confiable. Convertir fallos
   de lectura de autoridad o almacenamiento en indisponibilidad segura, nunca aceptación.
5. Separar cuarentena de entradas autenticadas incompatibles de la custodia aceptada.
   Conservar evidencia acotada para revisión sin sobrescribir un evento legítimo que use el
   mismo ID. No almacenar indiscriminadamente bodies sin autenticar, secretos o entradas
   superiores a límites. Cuarentena no emite ACK de aceptación; diagnóstico usa IDs/códigos.
6. Crear migraciones forward-only con upgrade, rollback ante fallo y reapertura de SQLite;
   conservar historia y retención de identidad sin TTL de comandos ni purga automática.

## Corte 2: transporte y confianza reales

### Criterios del corte de continuación

- El receptor terminal acepta referencias solo de su coordinador registrado, activo y
  vigente; el coordinador acepta hechos solo de terminales de su tienda. Se verifican
  ambos extremos, incluso si el emisor ya es confiable o se trata de un duplicado.
- La dirección declarada por el catálogo se valida en aplicación antes de deduplicar o
  registrar. Registrar manualmente un dueño no autoriza a invertir esa dirección.
- Una lectura fallida del registro produce indisponibilidad transitoria segura. Un rechazo
  de confianza conserva un código permanente distinguible; ninguna excepción interna se filtra.
- El cliente comprueba identidad y huella provisionadas del receptor además de TLS; un
  certificado distinto firmado por una CA confiable no puede recibir el payload comercial.
- Un ACK truncado o que no termina dentro del plazo total falla de forma acotada; no quedan
  promesas pendientes ni una transferencia lenta prolonga indefinidamente el envío.

Componer un listener técnico con autenticación/cifrado conforme D3, usando el mismo proceso
servidor dueño de SQLite. Provisionar destinos e identidades antes de escuchar en LAN;
configuración incompleta falla cerrado. Verificar certificados/credenciales vigentes,
dirección de contrato, rol receptor y vínculo nodo/terminal desde el registro independiente.

Probar con HTTP real la aceptación y el commit, identidad errónea, certificado no confiable,
revocación, terminal ajena, nodo de otra tienda, límites, JSON inválido y redacción. La
identidad de máquina no concede permisos humanos. Las operaciones administrativas de alta,
revocación y revisión identifican actor, terminal, UTC y motivo mediante aplicación/auditoría.

El cliente de prueba puede entregar directamente para verificar la frontera; el worker de
segundo plano, su política de backoff y su arranque automático pertenecen a 10.04.

## Corte 3: aplicación recuperable y discrepancias

1. Procesar trabajo durable acotado, separado de la recepción. Un fallo tras ACK conserva
   la tarea; reiniciar recupera dependencias y consumidores pendientes. La recepción de una
   dependencia no prueba que sus efectos estén aplicados: comprobar la condición real.
2. Definir atomicidad entre efecto y marca de procesamiento. Reutilizar el consumidor de
   inventario donde respete autoridad/procedencia; adaptar su composición transaccional sin
   transacciones anidadas accidentales. Cierre después del efecto y antes de marcar progreso
   debe ser recuperable sin duplicar movimientos ni auditoría.
3. Mantener movimientos, costo, moneda y lote originales conforme D5/ADR-0026. Congelar
   costo conocido al vender con evidencia de la referencia autoritativa; conservar `null`
   explícito. No completar un evento antiguo con el promedio del momento de recepción.
4. Ante stock insuficiente, conservar venta válida y discrepancia durable única, con evento,
   líneas afectadas, códigos y evidencia mínima. Diferenciar dependencia ausente, conflicto de
   identidad, falta de stock y fallo transitorio. Probar que no se aplica media venta cuando
   la política conserve el consumo transaccional de venta completa.
5. Proporcionar lectura/revisión y resolución autorizadas conforme D5. Reintentar explícitamente
   tras corregir la causa; cerrar una discrepancia no borra su evidencia ni inventa stock.
6. Para caja/fiscalidad, consumir proyecciones de lectura. No invocar `CompleteSale`,
   `ReturnSale`, apertura/cierre de turno o impresora a partir de un hecho remoto. El
   seguimiento de devolución necesita el contrato/flujo LAN aprobado antes de sus efectos.
   Compras, aprobaciones de conteo y devoluciones requieren conexión para iniciarse; una
   interrupción con efectos iniciados conserva la intención pendiente de conciliación.
   Especificar y probar cada paso local/remoto y su recuperación antes de habilitar el flujo.
7. Conservar origen comercial y autoría; un nuevo movimiento autoritativo del coordinador
   tiene procedencia propia y correlación al hecho que lo causó. No atribuir su ownership a
   la terminal ni reenviar hechos ajenos como si fueran propios.

## Corte 4: referencias, bootstrap y múltiples terminales

Implementar productores y consumidores explícitos para el conjunto cerrado en el corte 0.
Todo cambio autoritativo y su evento se confirman juntos. Los POS no pueden mutar el maestro
del coordinador, aunque conserven permisos locales de administrador.

La carga inicial usa DTOs versionados del módulo, con corte consistente y progreso
reanudable; no copia archivos SQLite ni tablas. La terminal confirma la aplicación completa
de las dependencias antes de habilitar los flujos que las necesitan. Cambios concurrentes
posteriores al corte se entregan una vez por destino sin huecos; una carga parcial no
sustituye el snapshot vigente ni se presenta como catálogo completo.

Estado de entrega por destino según D7, con payload único, claims y generación propios,
incluidos consumidores locales si constituyen entregas independientes. Conservar la semántica
de ADR-0022 en el caso de una sola salida. Un ACK de terminal A no confirma B; retirar B
o cambiar el coordinador requiere una operación explícita y no modifica hechos históricos.

Verificar localmente caja derivada de venta sin depender del envío LAN. El inventario POS
es proyección: no ejecutar también la salida autoritativa y sumar ambos saldos. La
composición de venta/caja/inventario debe tener un recorrido documentado para standalone y
LAN; no puede depender del publisher de red para completar un efecto local obligatorio.

## Criterios de aceptación

- [ ] CA-03-01: el ADR y los contratos cubren decisiones de activación; ninguna regla pendiente
  está implementada por suposición.
- [x] ~~CA-03-02~~: dos entregas concurrentes idénticas generan una custodia durable y el mismo
  resultado; ID con contenido distinto se rechaza sin sobrescritura.
- [x] ~~CA-03-03~~: rollback, SQLite ocupado y reinicio no producen ACK falso ni pierden
  trabajo; un ACK perdido permite reentrega tras reabrir ambas bases.
- [x] ~~CA-03-04~~: autenticación, dirección, rol, nodo/terminal y autoridad se verifican incluso
  en duplicados; emisor revocado o ajeno no obtiene aceptación.
- [x] ~~CA-03-05~~: un agregado creado offline puede registrar autoridad conforme D4 y entregar;
  conflicto o autoridad ausente no adopta al primer emisor.
- [x] ~~CA-03-06~~: cuarentena conserva entradas autenticadas incompatibles con límites, sin
  filtraciones ni ACK falso; conserva evidencia de conflicto sin destruir el original.
- [x] ~~CA-03-07~~: dependencias y atrasos sobreviven al reinicio; no retroceden proyecciones ni
  se declaran aplicados por el mero hecho de estar recibidos.
- [x] ~~CA-03-08~~: efecto y progreso son recuperables; reentrega no duplica stock, caja, auditoría
  ni impresión. Proyecciones remotas no mutan agregados cuyo dueño es la terminal.
- [x] ~~CA-03-09~~: dos ventas offline sobre la última unidad conservan validez; el coordinador
  no queda negativo y crea una discrepancia única con resolución auditable.
- [ ] CA-03-10: devoluciones y operaciones de stock cumplen D5/ADR-0026, incluidos lote/costo
  original, conexión inicial, estado pendiente visible y recuperación entre cada paso sin
  duplicar efectos. El snapshot de costo al vender no cambia por una compra posterior;
  costo desconocido no se convierte a cero ni se completa al sincronizar.
- [ ] CA-03-11: cada referencia necesaria tiene productor/contrato/consumidor probado; las
  versiones v1 publicadas siguen aceptando las fixtures originales.
- [ ] CA-03-12: bootstrap interrumpido y cambios durante el corte no dejan referencias
  parciales activas ni huecos; una nueva terminal recibe un estado coherente.
- [x] ~~CA-03-13~~: con coordinador y dos terminales, el ACK de una no confirma la otra y la
  terminal desconectada no bloquea la entrega a su vecina.
- [x] ~~CA-03-14~~: pruebas de upgrade/reapertura conservan historia, claims y resultado de
  custodia; no se reinterpretan publicaciones históricas como ACK de red.
- [x] ~~CA-03-15~~: API de operadores sigue en loopback; solo el transporte técnico aprobado se
  expone; no se registran bodies, PINs, claves, tokens, PII ni stacks públicos.
- [ ] CA-03-16: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
  y `git diff --check` aprobados; documentación, escenarios e índices reflejan lo probado.

## Superficies previstas y cierre

- `packages/core/src/application/events/`, puertos y casos de uso de módulos afectados:
  autoridad, recepción, consumo, referencias y discrepancias.
- `packages/shared/src/sync/`: contratos serializables y exports públicos, sin negocio.
- `packages/drivers/db/`: inbox, autoridad, progreso, entrega por destino y migraciones.
- Drivers de seguridad/transporte y `apps/server`: adaptadores, provisión y composición.
- Arquitectura, ADR complementario, FS-004–FS-008 y escenario adicional si la coordinación
  aprobada introduce fallos que no caben en las fichas existentes.

No se marca 10.03 completa al terminar solo el endpoint. El corte de referencias y todos
los criterios del alcance confirmado deben quedar cerrados antes de ejecutar 10.04.

## Estado de implementación, 2026-09-06

Implementado y probado:

- **Corte 1.** `sync_inbox_event`, `sync_inbox_work`, `sync_aggregate_authority` y
  `sync_quarantine` (migración 0028). `ReceiveSyncEvent` verifica identidad, origen declarado,
  terminal y autoridad **antes** de consultar el duplicado, y confirma deduplicación,
  clasificación, custodia y trabajo pendiente en una sola transacción. La clave única arbitra
  la concurrencia y quien pierde la carrera relee y compara. Autoridad inmutable por trigger;
  cuarentena con identidad propia y evidencia acotada a emisor, código y tamaño.
- **Corte 2.** `POST /sync/v1/events` y `POST /sync/v1/aggregates` en un listener técnico
  separado, sobre HTTPS con autenticación mutua y TLS 1.3. Registro confiable `sync_node`
  (migración 0029) con alta y revocación auditadas desde la API de operadores en loopback.
  Configuración incompleta falla cerrado. El mapeo HTTP quedó fijado: 200 aceptación o
  duplicado, 422 rechazo permanente, 503 indisponibilidad y `application/problem+json` sin
  identidad de evento para todo fallo de transporte.
- **Corte 3, inventario.** `ProcessSyncInbox` reclama trabajo acotado, revalida el claim,
  confirma efecto y progreso en la misma transacción y comprueba que la dependencia esté
  **aplicada**, no solo recibida. Ante stock insuficiente conserva la venta, no aplica media
  salida y registra una discrepancia única por evento y consumidor (migración 0030), con
  reintento y cierre autorizados; solo evidencia de aplicación permite cerrarla.
- **Corte 4, entrega por destino.** `sync_delivery` (migración 0031) con claim, generación,
  presupuesto de ciclo y resultado independientes por `(eventId, destinationNodeId)`. El
  payload se conserva una vez y `outbox_event.status` deja de ser autoridad de entrega.

No implementado; no debe presentarse como disponible:

- **Corte 0 y corte 4, referencias.** Catálogo, precios, impuestos, categorías, unidades,
  métodos de pago, políticas operativas y tasas confirmadas ya tienen contrato, productor,
  consumidor y carga inicial reanudable. Concesiones y disponibilidad siguen abiertas; por
  eso CA-03-01, CA-03-11 y CA-03-12 no se cierran todavía.
- **Corte 3, consumidores restantes.** Caja, fiscalidad y ventas del coordinador conservan
  custodia sin consumidor: sus hechos quedan recibidos y **no** se declaran aplicados.
- **Corte 3, coordinación LAN de stock.** Compras, aprobaciones de conteo y devoluciones no
  tienen todavía sus pasos, permisos, estados ni compensaciones implementados, de modo que
  CA-03-10 permanece abierto y esos flujos no se habilitan.
- **Costo del corte 3.** `SaleCompleted.v1` no transporta el snapshot de costo del origen. La
  salida sincronizada se registra con costo **desconocido** en lugar de tomar el promedio
  vigente del coordinador, conforme D4. La versión de contrato que lo transporte depende de la
  distribución de referencias de costo, todavía abierta.
- **CA-03-03 cerrado.** `sync-reception.integration.test.ts` mantiene un segundo writer con
  `BEGIN IMMEDIATE`: la recepción responde `SYNC_RECEIVER_UNAVAILABLE` y deja inbox y trabajo
  vacíos mientras SQLite está ocupado.
