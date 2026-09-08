# Plan de ejecución 9.02: Pantalla de venta

- **Sub-fase:** [9.02 Pantalla de venta](./9.02-pantalla-venta.md)
- **Estado del plan:** Ejecutado; decisiones de estación documentadas
- **Prerrequisito:** [9.01 Base React](./9.01-base-react.md) completada
- **Disciplina visual:** Ponytail `full`, limitada a presentación
- **Modo fiscal permitido:** `SIMULACION` mediante `FiscalPrinterFake`

## Resultado esperado

El operador inicia o recupera una venta, agrega productos por barcode, modifica
líneas, solicita descuentos autorizados, registra un lote atómico de pagos y
completa la venta desde el renderer. React presenta el DTO devuelto por la API;
no calcula IVA, IGTF, descuentos, conversiones, saldo ni elegibilidad de pago.

## Línea base comprobada

- La API ya publica inicio, consulta por ID, alta/baja de líneas, descuento,
  pagos mixtos, finalización y anulación bajo `/api/v1/sales`.
- Cada mutación exige `Idempotency-Key`; descuento y anulación conservan sus
  permisos y auditoría en aplicación.
- `SaleResponse` ya contiene subtotal, descuento, base imponible, IVA, IGTF,
  total, pagos y saldo en unidades menores enteras.
- El renderer todavía no conoce la venta actual, el turno abierto, métodos de
  pago ni una configuración de moneda de la estación.
- `GetSale` recupera una venta conocida y valida ownership, pero no descubre
  una venta draft cuyo ID se haya perdido.
- Al abrir este plan, el repositorio no tenía todavía un runner E2E de
  navegador/Electron; las pruebas del renderer usaban Vitest en entorno Node y
  render estático. La decisión aplicada y la evidencia vigente se registran más
  abajo.

## Decisiones de frontera

### Estado y recuperación

- Guardar únicamente el ID de la venta activa en almacenamiento web local,
  asociado a `originNodeId` y `terminalId`; el agregado permanece en SQLite y
  siempre se vuelve a consultar por HTTP.
- Al arrancar o entrar a Venta, consultar ese ID. `DRAFT` se recupera;
  `COMPLETED`, `VOIDED` o `SALE_NOT_FOUND` limpian la referencia local.
- Persistir también la clave de una mutación mientras su resultado sea
  incierto. Un reintento de la misma intención reutiliza la clave; una nueva
  intención genera otra con Web Crypto.
- Esta solución cubre reinicio normal del renderer. La pérdida del almacenamiento
  web o una respuesta perdida antes de conocer el ID no puede resolverse con la
  API actual y queda como brecha explícita, no como recuperación garantizada.

### Flujo POS

- El carrito muestra exclusivamente valores de `SaleResponse`; formatear
  unidades menores y cantidades escaladas es presentación, no recálculo.
- Barcode y cantidad se envían a `AddItemToSale`; no se consulta ni incrusta un
  `Product` del dominio en React.
- Quitar línea, aplicar descuento, registrar pagos y completar reemplazan el
  snapshot local con la respuesta completa del servidor.
- Pagos se editan como un lote y se envían juntos. La UI no acepta decimales de
  punto flotante: transforma texto decimal a entero mediante un parser probado
  con la escala visible de la moneda.
- La finalización solo se solicita como intención del operador; la habilitación
  visual no sustituye la validación de estado, exactitud ni política del caso de
  uso.
- La respuesta fiscal del fake, si se incorpora al recorrido posterior, se
  presenta como prueba simulada y nunca como factura legal o emisión en hardware.

### Errores y accesibilidad

- Traducir por `ProblemDetails.code`; nunca inferir comportamiento desde
  `title`, status HTTP o texto técnico.
- Conservar `correlationId` visible para soporte y no mostrar stack, cookies,
  claves de idempotencia ni detalles internos.
- Usar formularios nativos, foco visible, estados `aria-live` y confirmación
  explícita para anulación. No agregar estado global, router ni librería visual.

## Decisiones requeridas antes de implementar

1. Definir una fuente confiable para `shiftId` y la caja asignada a la estación.
   Pedir al operador un ID técnico no constituye una interfaz POS clara.
2. Definir cómo se obtiene la moneda de la venta y la escala de presentación.
   No existe contrato de monedas habilitadas ni configuración de estación.
3. Decidir si la recuperación debe sobrevivir también a la pérdida del
   almacenamiento web. Si se exige, primero se publica una query de aplicación
   que liste drafts propiedad del terminal, sin escoger silenciosamente uno.
4. Definir los métodos de pago disponibles para evitar que la UI solicite
   códigos internos a mano; hoy solo existe `findByCode` en aplicación.
5. Aprobar qué nivel constituye E2E para Fase 9. Si se exige interacción real
   con Electron o navegador, 9.02 debe instalar y configurar una sola vez el
   runner mínimo, con necesidad y alcance documentados, para reutilizarlo hasta
   9.07.

Estas decisiones afectan contratos y operación. No se codifican defaults en el
renderer ni se deducen desde los productos de ejemplo.

## Secuencia outside-in

1. Cerrar las decisiones de estación anteriores y actualizar estos criterios.
2. Escribir pruebas del cliente HTTP para path, body, idempotencia, error y
   reemplazo del snapshot de venta.
3. Escribir la prueba del recorrido observable: recuperar o iniciar, agregar
   barcode, mostrar totales del servidor, cobrar y completar.
4. Implementar el controlador de pantalla y el almacenamiento mínimo de ID e
   intención incierta.
5. Implementar la vista POS con HTML semántico y CSS existente.
6. Agregar pruebas de descuento denegado, pago inválido, conexión perdida y
   recuperación tras recrear el renderer.
7. Ejecutar lint, typecheck, tests y build de escritorio; luego actualizar el
   cronograma sin adelantar 9.03.

### Decisiones aplicadas

- La caja y el turno se provisionan desde la pantalla 9.03 y se conservan como
  configuración local explícita; si no existe un turno, la venta queda
  bloqueada con un mensaje de preparación, sin inventar un ID.
- La moneda y su escala se muestran como configuración visible de la estación.
  React solo formatea el DTO y convierte texto decimal a unidades menores; la
  política fiscal continúa en el servidor.
- Las suites con `DesktopApi` o transporte simulado son pruebas de interacción
  o contrato. El gate E2E de la fase es
  `apps/desktop/src/e2e/sale-flow.e2e.test.tsx`: `App` montada, `fetch` real,
  listener Fastify real y SQLite real. No se incorpora un runner Electron
  adicional porque este recorrido no depende de una frontera nativa.
- La pérdida del almacenamiento web sigue siendo una brecha explícita. El
  reinicio normal sí recupera el ID de venta y las claves de intención.

## Criterios de aceptación

Verificados mediante las pruebas del cliente y del renderer: recuperación por
ID, snapshot de venta, líneas, descuento, pagos mixtos, idempotencia, errores
con correlación, finalización/anulación y rotulado fiscal de simulación. La
brecha de pérdida total del almacenamiento web permanece explícita.

- [x] ~~Una venta draft conocida reaparece después de reiniciar el renderer y se
  valida nuevamente contra la API.~~
- [x] ~~El operador puede agregar y quitar líneas por los contratos publicados.~~
- [x] ~~Subtotal, descuentos, IVA, IGTF, total, pagado y saldo coinciden valor por
  valor con `SaleResponse`; React no los recalcula.~~
- [x] ~~Un lote de pagos mixtos conserva moneda y tasa explícita cuando aplica.~~
- [x] ~~Cada retry incierto reutiliza la misma clave y una intención nueva usa una
  clave distinta.~~
- [x] ~~Los errores se traducen por código y muestran el `correlationId`.~~
- [x] ~~Completar o anular limpia la referencia de venta activa.~~
- [x] ~~`SIMULACION` permanece inequívoco durante todo el flujo.~~
- [x] ~~Existe una prueba E2E real del flujo principal con SQLite y Fastify en la
  composición de prueba, sin SQLite, Node ni `core` en el renderer.~~
- [x] ~~`pnpm lint`, `pnpm typecheck`, `pnpm test` y el build de escritorio pasan.~~

## Fuera de alcance

- Apertura o cierre de caja, que pertenecen a 9.03.
- Emisión fiscal real o integración de hardware.
- Reglas de redondeo, impuestos, descuentos o conversión en React.
- WebSocket, modo multi-terminal y sincronización.
