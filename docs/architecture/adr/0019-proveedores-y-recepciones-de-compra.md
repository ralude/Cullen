# ADR-0019: Proveedores y evidencia de recepciones de compra

- Estado: Aceptado. Las reglas fiscales, documentales y de ciclo de vida quedaron
  aprobadas el 2026-09-04; su implementación se reparte entre 9B.03 (maestro
  `Supplier`) y 9B.04 (`PurchaseReceipt` durable con costo).
- Fecha: 2026-09-04
- Actualizado: 2026-09-04 con las decisiones de negocio aprobadas que cierran
  9B.03

## Contexto

La sub-fase 9B.03 debe convertir al proveedor en una entidad persistida y dejar
de aceptar un `supplierId` opaco sin validación. Las reglas de negocio aprobadas
exigen identidad fiscal única, estados operativos, auditoría de cambios
sensibles, conservación histórica y un snapshot del proveedor en cada recepción
completada.

La arquitectura vigente presenta dos contradicciones:

1. `docs/cronograma/fase-09b-perfiles/9b.03-proveedores.md` exige un agregado
   `Supplier`, pero `05-agregados.md` solo reconoce `PurchaseOrder` como raíz del
   módulo `purchasing`.
2. La recepción actual no es una entidad ni un agregado. `ReceivePurchase`
   registra directamente un movimiento de `StockItem` y usa `receiptId` como
   referencia externa, por lo que no existe un lugar durable donde sellar el
   snapshot del proveedor, el documento de origen o el estado `COMPLETED`.

Además, la regla aprobada indica que una recepción completada conserva costos
inmutables. El costo y su método de valoración pertenecen expresamente a 9B.04 y
se implementan con el default reemplazable de ADR-0016. Crear en 9B.03 una
recepción `COMPLETED` sin costo incumpliría la regla; agregar el costo después
mutaría evidencia ya completada.

## Decisiones de negocio ya aprobadas

- `Supplier` tiene un ID técnico inmutable y un código humano generado por
  Cullen, independiente de su identidad fiscal.
- La identidad fiscal se compone de país, tipo, valor capturado y valor
  normalizado. La unicidad usa `(country, type, normalizedValue)`.
- Los estados son `ACTIVE`, `BLOCKED` e `INACTIVE`; solo `ACTIVE` puede usarse
  en una nueva recepción.
- No existe borrado físico de un proveedor con historia.
- Los cambios sensibles generan auditoría de negocio con actor, UTC, campo,
  valor anterior, valor nuevo y motivo cuando corresponda.
- La identidad fiscal de un proveedor con recepciones completadas solo puede
  corregirse para la misma entidad legal mediante permiso privilegiado, motivo
  y auditoría. Un contribuyente distinto requiere otro proveedor.
- Una recepción completada conserva un snapshot inmutable del proveedor y de
  su documento de origen; editar el maestro no reescribe historia.

## Decisión arquitectónica

### Fronteras de agregado

`Supplier` pasa a ser raíz de agregado del módulo `purchasing`. Protege su
identidad, código, estado y reglas de edición. El repositorio garantiza la
unicidad fiscal dentro de la misma transacción y permite consultar si existe
historia completada antes de corregir la identidad.

`PurchaseReceipt` será una raíz separada del mismo módulo cuando se implemente
el documento completo. Contendrá su ID técnico, proveedor, snapshot, documento
de origen, líneas y estado. `StockItem` seguirá siendo la raíz de inventario;
ningún agregado modificará internamente al otro.

El caso de uso de recepción coordinará las raíces mediante puertos y una sola
`UnitOfWork`: o se confirma toda la evidencia y el movimiento de inventario, o
no se confirma nada. La idempotencia existente se conserva. Cuando el producto
todavía no tenga `StockItem`, su ID lo genera la aplicación; nunca el renderer.

### Separación entre 9B.03 y 9B.04

Para no adelantar costos ni crear recepciones históricamente incompletas, 9B.03
implementaría únicamente el maestro `Supplier`, su auditoría, sus consultas y
la validación de que el proveedor referenciado por la recepción actual existe y
está `ACTIVE`. El documento durable `PurchaseReceipt`, el snapshot completo y
su transición a `COMPLETED` entrarían en 9B.04 junto con el costo aprobado por
ADR-0016.

Mientras tanto, 9B.03 no presentará el `receiptId` actual como una recepción
persistida ni permitirá editar evidencia histórica: seguirá siendo solo la
referencia del movimiento ya existente. Esta separación es la opción mínima
que respeta el orden de fases y no inventa un costo.

### Complemento LAN del 2026-09-06

La coordinación LAN está complementada por
[ADR-0026, D3](./0026-lan-operativa-y-recuperacion-entre-nodos.md), decidido y aún no
implementado: completar compras requiere conexión al coordinador y una interrupción con
efectos iniciados conserva intención pendiente de conciliación. Cada nodo confirma sus
efectos en su transacción; la atomicidad anterior sigue vigente para standalone y no se
extiende a dos SQLite. El origen de `PurchaseReceipt` permanece fijo.

### Identificadores y códigos

El ID técnico usa el generador de aplicación aprobado por ADR-0003. El código
humano sigue el formato `SUP-000001`, es inmutable y se asigna
transaccionalmente. En Fase 9B su unicidad solo puede garantizarse dentro del
nodo dueño; la autoridad y reconciliación multi-nodo pertenecen a Fase 10.

El número del documento del proveedor nunca se reutiliza como ID técnico de la
recepción. Cuando exista `PurchaseReceipt`, el documento de origen conservará
`type`, `number`, `controlNumber?`, `issuedAt?` y `currency?`.

### Auditoría y protección de datos

La evidencia de cambios sensibles se escribe en `audit_log`, no en logs
técnicos. Los resúmenes antes/después pueden contener datos fiscales y quedan
protegidos por la política de auditoría; la lectura operativa de ADR-0013 no los
proyecta. Los logs técnicos solo usan IDs y códigos de error.

## Reglas aprobadas el 2026-09-04

### 1. Identidad fiscal

**Venezuela (`VE`/`RIF`).** La canonicalización elimina los separadores
admitidos y pasa a mayúsculas. La representación normalizada es una letra
seguida de nueve dígitos, limitada a los prefijos que el producto soporta
explícitamente (`V`, `E`, `J`, `P`, `G`, `C`). La unicidad sigue siendo
`(country, type, normalizedValue)`.

**No se implementa checksum como validación bloqueante** mientras el proyecto no
tenga una fuente oficial verificable del SENIAT que defina el algoritmo. No se
infieren ni se copian algoritmos comunitarios como requisito normativo. Si esa
fuente se obtiene, el checksum se incorpora mediante un ADR o cambio explícito;
hasta entonces, un RIF estructuralmente correcto se acepta aunque un algoritmo
de terceros lo rechazaría, y así está fijado por prueba.

**Fuera de Venezuela.** No se implementan validadores tributarios específicos de
otros países. El modelo inicial es: `country` en ISO 3166-1 alpha-2, identidad
genérica `TAX_ID`, `value` no vacío, normalización determinista y conservadora
(Unicode, mayúsculas y eliminación de espacios, conservando el resto de la
puntuación), unicidad `(country, type, normalizedValue)` y ausencia de checksum
o reglas por país. Validadores como `NIT` o `CUIT` podrán añadirse después sin
cambiar la identidad de `Supplier`; hasta entonces un tipo distinto del admitido
por país se rechaza con `SUPPLIER_TAX_TYPE_INVALID`.

El código de país se valida por forma (dos letras). El proyecto no incorpora el
registro ISO completo, de modo que un código de dos letras inexistente se
acepta; queda declarado como limitación conocida.

### 2. Dirección fiscal

La dirección fiscal sigue siendo **opcional al crear el maestro**. Es
**obligatoria antes de completar una `PurchaseReceipt` venezolana** cuando el
documento de origen sea `INVOICE` o `DELIVERY_NOTE`. Esa exigencia se evalúa en
aplicación cuando 9B.04 implemente la recepción durable; nunca en React.

Su representación mínima evaluable es `FiscalAddress { countryCode, addressLine }`
con ambos campos no vacíos. Estado, municipio, ciudad y código postal quedan
opcionales y no se modelan todavía. En 9B.03 la dirección viaja completa o no
viaja: no existe media dirección ni en el contrato, ni en el dominio, ni en la
tabla.

### 3. Documento de origen — implementa 9B.04

Los tipos iniciales son `INVOICE` y `DELIVERY_NOTE`, donde el segundo cubre la
orden de entrega o guía de despacho. `PURCHASE_ORDER` **no** es un tipo de
documento de origen: una relación con `PurchaseOrder` se modela por separado
mediante su ID.

Forma conceptual mínima: `SourceDocument { type, number, series?, controlNumber?, issuedAt }`.
Al completar una recepción el documento de origen es obligatorio. La unicidad
normal es `supplierId + type + normalizedSeries + normalizedNumber`, y cuando
exista `controlNumber` también se impide un número de control duplicado para ese
proveedor. No pueden existir dos recepciones `COMPLETED` efectivas para el mismo
documento del proveedor. Una recepción de reemplazo puede reutilizar el
documento solo si referencia explícitamente una recepción previa `REVERSED`.

### 4. Corrección y reverso — implementa 9B.04

El ciclo de vida es `DRAFT -> COMPLETED -> REVERSED`. En `DRAFT` la recepción se
corrige según permisos. Después de `COMPLETED` son inmutables el proveedor, el
snapshot, el documento de origen, las líneas, las cantidades, los costos y la
fecha efectiva: no se hacen updates destructivos sobre evidencia completada.

La reversión exige permiso y motivo, referencia la recepción original, conserva
la recepción y los movimientos originales, crea movimientos de inventario
compensatorios, escribe auditoría, outbox e idempotencia con los patrones
vigentes y es atómica. No se permite revertir si el efecto dejaría el inventario
en un estado inválido según los invariantes vigentes; ese caso exige después un
flujo explícito de conciliación/ajuste o devolución a proveedor.

En el primer alcance no hay correcciones parciales de una recepción
`COMPLETED`. La corrección posterior es `original -> REVERSED` más una recepción
nueva `COMPLETED` con `replacesReceiptId` apuntando a la original. La valoración
y el costo de los movimientos compensatorios se resuelven junto con ADR-0016. Una
devolución física al proveedor no es una corrección de recepción y no usa este
flujo.

### 5. Estados del proveedor

- `ACTIVE`: proveedor operativo; admite nuevas operaciones.
- `BLOCKED`: vigente pero suspendido temporalmente; no admite operaciones
  nuevas, exige motivo, puede volver a `ACTIVE` y conserva todo el historial.
- `INACTIVE`: relación comercial retirada o no habitual; no admite operaciones
  nuevas, queda fuera de los selectores operativos por defecto, conserva todo el
  historial y puede reactivarse mediante una transición explícita y auditada.

Toda operación que vaya a producir efectos durables comprueba nuevamente que el
proveedor sigue `ACTIVE` dentro de su transacción. No basta con que lo estuviera
cuando se abrió la pantalla.

### Normalización y códigos disponibles en 9B.03

El código `SUP-000001` es único dentro del nodo durante 9B. La autoridad global
y los conflictos entre nodos siguen diferidos a Fase 10.
## Consecuencias

- `Supplier` deja de ser texto libre y obtiene una frontera de consistencia
  explícita sin acoplar inventario a tablas de compras.
- 9B.03 puede cerrarse sin invadir el método de costeo de 9B.04: implementa la
  identidad fiscal, la dirección estructurada y los estados; deja documentados y
  sin código el documento de origen y el ciclo de vida de la recepción.
- El checksum del RIF queda como brecha declarada, no como validación silenciosa.
  Un RIF estructuralmente correcto se acepta aunque un algoritmo de terceros lo
  rechazaría.
- La recepción completa y su snapshot quedan deliberadamente pendientes hasta
  que puedan sellarse con costos, no como una garantía parcialmente cumplida.
- Deben actualizarse `04-entidades.md`, `05-agregados.md` y
  `06-casos-de-uso.md` al aceptar el ADR, antes de escribir código.
- La futura recepción requiere una prueba transaccional de rollback para evitar
  documento sin movimiento o movimiento sin documento.
