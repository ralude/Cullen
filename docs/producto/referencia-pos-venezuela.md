# Referencia: funcionalidades consolidadas en puntos de venta venezolanos

- **Tipo:** investigación de producto. **No es una especificación ni amplía el alcance
  aprobado**: cada característica que se quiera incorporar necesita su spec, su decisión y su
  lugar en el [cronograma](../cronograma/README.md).
- **Fecha:** 2026-09-23. Fuentes públicas, enlazadas al final. Lo que no confirman se marca
  **sin confirmar**.
- **Relacionado:** [Pagos en caja](../cronograma/pagos-en-caja/README.md),
  [Alcance por nivel de entrega](./alcance-entregas.md).

## Criterio

Una característica entra en esta lista si **varios sistemas o proveedores del mercado la ofrecen
como estándar**, o si **una norma vigente la exige**. No alcanza con que un solo producto la
publicite. Para cada una se registra qué hace hoy Cullen, verificado contra el código, y una
propuesta con su destino.

Nada de esto es asesoría tributaria o legal. Lo normativo se verifica con un profesional antes de
convertirlo en regla, como exige [ADR-0021](../architecture/adr/0021-mvp-referencia-no-certificado.md).

## Resumen

| # | Característica | Cullen hoy | Prioridad propuesta | Destino |
|---:|---|---|---|---|
| 1 | Cobro en USD y VES en la misma venta | Mecánica lista; multimoneda bloqueada (D-001, D-002) | **Alta** | Pagos en caja, E1 |
| 2 | Vuelto calculado, también en otra moneda o por pago móvil | No existe: el lote debe ser exacto | **Alta** | Pagos en caja, decisión DA-2 |
| 3 | Integración con el punto de venta bancario | No: la tarjeta es un método manual | **Alta** | Pagos en caja, etapa nueva |
| 4 | Verificación de pago móvil | No | **Alta** | Pagos en caja, E2–E3 |
| 5 | Tasa BCV del día obtenida por el sistema | **Sí**: sugerencia BCV con `EXCHANGE_RATE_PROVIDER=bcv` y confirmación humana; aviso de tasa de un día anterior en Caja desde la etapa ET | — | Entregado |
| 6 | IGTF por método de pago | Sí (ADR-0031); bloquea la factura (D-003) | Alta | Decisión fiscal de D-003 |
| 7 | Compra a cuotas (Cashea, Krece, Lysto, Chollo) | No | Media | Pagos en caja, E5–E6 |
| 8 | Códigos de balanza con peso variable | No | Media | Paquete nuevo: catálogo y venta |
| 9 | Total a pagar en bolívares a tasa BCV visible para el cliente | En la barra de cobro desde la etapa ET, con tasa, fuente y vigencia; no en el ticket ni en las etiquetas | Media (ticket y etiquetas) | Etiquetas: requiere verificación normativa |
| 10 | Arqueo por moneda y por denominación | Por método y moneda, sin denominación | Media | Caja |
| 11 | Libro de ventas y reportes para declarar IVA e IGTF | No | Media | Reportes, con asesoría |
| 12 | Facturación por imprenta digital | No; la máquina fiscal está suspendida (Fase 8) | Por decidir | ADR nuevo |
| 13 | Retenciones de IVA de clientes contribuyentes especiales | No | Baja en caja | Fuera del punto de venta |
| 14 | Cliente con RIF o cédula en la factura | **Sí** (ADR-0018) | — | Ya existe |
| 15 | Operación sin red ni coordinador | **Sí** (ADR-0008) | — | Ya existe |
| 16 | Sin precio distinto por medio de pago | **Sí**: no hay recargos ni descuentos por método | — | Se conserva como restricción |

## Detalle

### 1 · Cobro en USD y VES en la misma venta

**Consolidada.** Los POS locales dirigidos a bodegas y mercados anuncian como base el «cobro
multimoneda simultáneo» con tasa BCV —SiraPOS, FrixPOS, Clarito, NOA—. Los administrativos
grandes, como Gálac, toman la tasa BCV desde el propio sistema.

**Cullen hoy:** las fichas de cobro ya aceptan varios métodos, pero un pago en otra moneda falla
con `EXCHANGE_RATE_REQUIRED` porque la pantalla no envía la tasa (D-001). Corregirlo exige antes
decidir la escala de cada moneda (D-002).

**Propuesta:** la etapa E1 de la [spec de pagos](../cronograma/pagos-en-caja/spec-pagos-multiples.md).
Es la brecha más visible para una tienda venezolana.

### 2 · Vuelto calculado, también en otra moneda

**Consolidada.** Los POS locales calculan el vuelto de un pago mixto, por ejemplo mitad en
dólares y mitad en pago móvil. La banca ofrece además el **vuelto por pago móvil** desde el
punto: Banco Exterior lo presta sin costo adicional al de las tarifas BCV, y la API C2P de los
agregadores lo emite para cuentas jurídicas.

**Cullen hoy:** `Sale.registerPayments` exige un lote exacto. El cajero registra solo lo que la
venta se queda y el vuelto no deja rastro, ni en la venta ni en el arqueo.

**Propuesta:** modelar el vuelto como un **pago de salida explícito**, con método, moneda y tasa,
y no como un sobrepago tolerado: así el efectivo esperado en cada moneda sigue cuadrando. Es la
decisión DA-2 de la spec. El vuelto por C2P es una variante posterior que depende del contrato
bancario del comercio.

### 3 · Integración con el punto de venta bancario

**Consolidada.** La plataforma **Merchant Server / VPOS de MegaSoft** es el camino habitual.
Gálac (Administrativo 24.1), Saint y a2Cash documentan su integración. Credicard ofrece
«puntos de venta integrados a sus cajas registradoras y sistemas administrativos». El banco
habilita el servicio y entrega un ID de terminal virtual. En la PC de la caja se instala un
agente que, según la guía de Saint, escucha en `http://localhost:8085`.

**Cullen hoy:** una tarjeta es un método de pago manual. El cajero cobra en el punto y escribe el
importe en Cullen, sin vínculo entre los dos.

**Propuesta:** un puerto `CardTerminal` en aplicación y un adaptador para el agente MegaSoft en
`packages/drivers/hardware`, que ya existe para periféricos locales. La aprobación del banco
—referencia, lote, autorización— viaja como la `PaymentReference` de la etapa E2. Es una etapa
nueva del paquete de pagos con **dependencia externa**: el contrato del agente se obtiene con el
servicio habilitado. Tiene el mismo riesgo que la Fase 8 y no debe planificarse como si el
contrato fuera conocido.

### 4 · Verificación de pago móvil

**Consolidada.** Hay APIs bancarias, como la búsqueda de pagos móviles de Mercantil, y
agregadores como Pabilo, que cubren los bancos principales. a2Cash configura el pago móvil
dentro del mismo VPOS.

**Propuesta:** ya planificada en las etapas E2 y E3 del
[plan](../cronograma/pagos-en-caja/plan-pago-movil-y-cashea.md). Si se adopta el VPOS del punto
3, conviene verificar si el mismo agente cubre el pago móvil antes de contratar un segundo
proveedor.

### 5 · Tasa BCV del día obtenida por el sistema

**Consolidada y exigida.** Gálac y los POS locales traen la tasa BCV sin intervención. Del lado
normativo, el precio en divisas es referencial: lo que se cobra en bolívares es ese precio por la
**tasa oficial BCV vigente**, y no se admite otro indicador. La SUNDDE publicó a fines de 2025 un
formato obligatorio con código QR para exhibir la tasa, y pide que los parámetros de los sistemas
de facturación estén actualizados **antes de abrir**.

**Cullen hoy:** **ya lo cubre.** Con `EXCHANGE_RATE_PROVIDER=bcv`, el nodo sugiere el dólar
oficial mediante `BcvExchangeRateProvider` (`packages/drivers/exchange-rate`), solo cuando
alguien la pide desde Tasas, y conserva el valor como entero con escala. Quien opera la revisa y
la registra, como fija [ADR-0014](../architecture/adr/0014-tasas-de-cambio-sugerencia-y-confirmacion.md).
El endpoint es `ve.dolarapi.com`, un servicio de terceros que **republica** la tasa del BCV: no
es el BCV.

**Propuesta:** falta un aviso al **abrir turno** cuando la tasa vigente no es del día hábil en
curso. Una tasa que caducó en silencio sería la falla más cara en una inspección. Conviene
además confirmar con operación si un intermediario es fuente aceptable o si debe consultarse la
publicación del propio BCV.

### 6 · IGTF por método de pago

**Consolidada y exigida.** El 3 % se aplica a los pagos en moneda distinta al bolívar: efectivo
en divisas, transferencias internacionales y criptoactivos valuados a tasa BCV. **No** se aplica
al pago en bolívares con tarjeta, salvo para contribuyentes especiales. La base incluye el IVA.

**Cullen hoy:** la política por método y moneda de ADR-0031 ya permite ese mapa. El pendiente
es D-003: una venta con IGTF no se puede facturar.

**Propuesta:** la decisión fiscal que cierra D-003 es requisito de cualquier tienda que reciba
dólares. La regla «la base incluye el IVA» coincide con cómo Cullen calcula el IGTF sobre el
total, pero debe confirmarla un asesor tributario.

### 7 · Compra a cuotas

**Consolidada.** Cashea lidera. Krece se especializa en teléfonos, Lysto en compras pequeñas
—de 50 a 150 USD en cuatro cuotas— y Chollo en compras grandes. Las cadenas de supermercados Gama,
Central Madeirense y Forum aceptan Cashea como medio de pago principal.

**Propuesta:** las etapas E5 y E6 del plan, con un matiz: el puerto
`ThirdPartyFinancingProvider` y el método con `settlement: EXTERNAL` deben diseñarse para
**cualquier** financiador, no para Cashea en particular. Cashea es el primer adaptador, no el
modelo.

### 8 · Códigos de balanza con peso variable

**Consolidada.** Es estándar en supermercados. La balanza etiquetadora imprime un EAN-13 que
empieza con **2**: lleva el código del producto en la balanza y el peso o el precio. El POS lo
reconoce y convierte en la cantidad vendida. Los códigos que no empiezan con el prefijo
venezolano 759 no son GS1 oficiales. Los de balanza son de uso interno y no chocan con él.

**Cullen hoy:** las cantidades ya son escaladas (`quantityScale` en la unidad de medida), así que
vender 1,254 kg es representable. Lo que falta es interpretar el código.

**Propuesta:** un intérprete de códigos de balanza en catálogo, **configurable** en prefijo,
longitud del código de producto y si lleva peso o precio embebido. Los fabricantes difieren y
el comercio elige el formato al configurar la balanza. El precio embebido exige decidir quién
manda si difiere del precio del catálogo. Es una decisión de negocio, no un detalle del
intérprete.

### 9 · Total en bolívares a tasa BCV visible para el cliente

**Consolidada, con reglas en movimiento.** La doble expresión de precios se exige desde 2021,
pero en febrero de 2025 la SUNDDE ordenó retirar etiquetas con doble precio en algunas cadenas y
reiteró que las **promociones en divisas son ilegales**. El principio estable es este: el precio
en divisas es referencial y se cobra en bolívares a tasa BCV.

**Propuesta:** mostrar en la barra de cobro el total en la moneda de venta y su equivalente en
bolívares, con la tasa, su fuente y su vigencia, como ya exige `AGENTS.md` para toda conversión.
Hacer lo mismo en el ticket. Las etiquetas de góndola quedan fuera hasta que un profesional
confirme el formato vigente.

### 10 · Arqueo por moneda y por denominación

**Práctica habitual**, pero la evidencia pública es débil: guías generales y sistemas de otros
países. **Sin confirmar** como estándar venezolano. Su utilidad sí es clara con efectivo en dos
monedas.

**Cullen hoy:** `Shift` ya arquea por método y moneda y rechaza el cierre con esperados
negativos. No registra denominaciones.

**Propuesta:** un desglose **opcional** por denominación al declarar el efectivo, guardado con el
cierre. No cambia el saldo esperado ni la regla de arqueo. Prioridad media, detrás del vuelto:
sin vuelto registrado, el efectivo en dólares no cuadra con o sin denominaciones.

### 11 · Libro de ventas y reportes para declarar

**Consolidada** en los administrativos: el libro de ventas registra cada factura con su IVA, y
los contribuyentes especiales llevan además el control del IGTF.

**Cullen hoy:** reportes operativos y X/Z simulados; no exporta libro de ventas.

**Propuesta:** una exportación del libro de ventas desde los documentos fiscales emitidos, con
formato validado por un contador. Depende de que exista emisión fiscal real (Fase 8) o digital
(punto 12). Antes de eso sería un reporte sin valor legal.

### 12 · Facturación por imprenta digital

**Exigida para quienes la norma alcanza.** La Providencia SNAT/2024/000102, vigente desde marzo
de 2025, regula la emisión de facturas por medios digitales mediante una **imprenta digital
autorizada** por el SENIAT. Es un camino distinto de la máquina fiscal.

**Cambio normativo relevante:** la SNAT/2026/00084 derogó el 2026-08-12 la SNAT/2024/000121,
que exigía sistemas de facturación homologados. El proyecto ya lo registra en
[adaptaciones aprobadas](../cronograma/adaptaciones-aprobadas.md). **Sin confirmar:** si la 102
sigue vigente sin cambios después de esa derogación.

**Propuesta:** evaluar en un ADR si un adaptador de imprenta digital puede ser el **segundo
destino fiscal** del puerto que la Fase 7 ya definió. Importa porque la Fase 8 está suspendida
por falta de hardware y la imprenta digital no lo necesita. No resuelve el caso de quien está
obligado a usar máquina fiscal, que sigue siendo la Fase 8.

### 13 · Retenciones de IVA de clientes contribuyentes especiales

**Exigida, pero no en la caja.** Los contribuyentes especiales retienen el 75 % o el 100 % del IVA
que les facturan sus proveedores y entregan un comprobante. Para un supermercado, eso ocurre
cuando le vende a una empresa. El comprobante llega después de la factura y se concilia en
cuentas por cobrar y en el libro de ventas.

**Propuesta:** fuera del punto de venta. Se registra aquí para que nadie lo lea como un olvido:
pertenece a una integración contable, que el
[alcance por nivel](./alcance-entregas.md) ubica en la plataforma empresarial.

### 14 a 16 · Lo que ya existe

- **RIF o cédula en la factura:** snapshot opcional del cliente según
  [ADR-0018](../architecture/adr/0018-datos-obligatorios-del-cliente.md). Valida la forma y
  deliberadamente no calcula el dígito verificador sin una fuente profesional. Se mantiene.
- **Operación sin red:** cada terminal es autónoma
  ([ADR-0008](../architecture/adr/0008-topologia-offline-por-nodo.md)). En un país con cortes de
  luz e internet es la ventaja más importante y no requiere cambios.
- **Sin precio distinto por medio de pago:** Cullen no tiene recargos ni descuentos por método.
  La SUNDDE declara ilegales las promociones en divisas y Cashea prohíbe cobrar más caro con su
  servicio. **Se conserva como restricción:** ninguna propuesta de esta lista debe
  introducirlos.

## Orden sugerido

1. **Para el piloto:** 1, 2, 5 y 6 —sin ellos una tienda venezolana no cierra un día normal— y
   luego 3 y 4, que dependen de contratos externos. Casi todo cabe en el paquete
   [Pagos en caja](../cronograma/pagos-en-caja/README.md). El vuelto y el punto bancario
   necesitan etapas nuevas en su plan.
2. **Después del piloto:** 7, 8, 9 y 10.
3. **Con decisión normativa propia:** 11 y 12.
4. **Fuera del punto de venta:** 13.

**Choque con el alcance vigente:** [alcance por nivel de entrega](./alcance-entregas.md) ubica
las «integraciones de pagos» en la **plataforma empresarial**, no en el piloto. Los puntos 3, 4
y 7, en su forma integrada, contradicen ese orden si se exigen para el piloto. Para
exigirlos hay que corregir el documento de alcance con una decisión explícita. Sus formas
manuales —referencia declarada, orden escrita por el cajero— no integran nada y caben en el
piloto sin tocarlo.

## Fuentes

Consultadas el 2026-09-23.

- [SiraPOS — POS multimoneda USD/Bs](https://sirapos.com/)
- [FrixPOS — POS para bodegas](https://frixpos.com/)
- [Clarito — dólares y bolívares, tasa BCV sincronizada](https://clarito.app/blog/como-manejar-dolares-y-bolivares-en-tu-negocio)
- [NOA Software](https://softwarenoa.com/)
- [Gálac — Administrativo 24.1 integrado a MegaSoft](https://galac.com/galac-blog/administrativo-24-1-transforma-tu-experiencia-de-cobro-con-nuestro-punto-de-venta-integrado-a-megasoft/)
- [Saint — configuración del VPOS de MegaSoft](https://soporte.saintnet.com/support/solutions/articles/69000812419--como-se-configura-el-vpos-de-mega-soft-)
- [Credicard — VPOS](https://www.credicardenlinea.com.ve/vpos)
- [a2Cash — pago móvil en VPos (boletín)](https://es.scribd.com/document/615906193/Boletin-a2Cash-9-35)
- [Banco Exterior — puntos de venta y vuelto](https://www.bancoexterior.com/personas/canales-digitales/exterior-puntos-de-venta/)
- [BCV — comisiones de puntos de venta](https://www.bcv.org.ve/notas-de-prensa/bcv-fija-comisiones-que-la-banca-cobra-al-comercio-por-operaciones-con-puntos-de)
- [Venezuela a Cuotas — Cashea, Krece, Lysto y Chollo 2026](https://www.venezuelaacuotas.com.ve/2026/01/como-comprar-comida-y-medicinas-a-credito-en-venezuela.html?m=1)
- [Venezuela a Cuotas — Krece vs Cashea](https://www.venezuelaacuotas.com.ve/2026/03/krece-vs-cashea-cual-es-la-mejor-app-para-comprar-a-credito.html)
- [Códigos de barras de balanza (peso variable)](https://helpmybusinesspos.info/como-leer-etiquetas-de-codigo-de-barras-generadas-por-una-bascula-etiquetadora/)
- [759 Códigos de Barras Venezuela](https://759codigosdebarrasvenezuela.company.site/)
- [Efecto Cocuyo — siete respuestas sobre el IGTF](https://efectococuyo.com/economia/impuesto-pagos-con-divisas-igtf-claves/)
- [Gálac — reforma del IGTF](https://galac.com/galac-blog/reforma-del-igtf-impuesto-a-las-transacciones-en-divisas-y-criptomonedas/)
- [Prodavinci — IGTF y pagos en dólares](https://prodavinci.com/igtf-y-pagos-en-dolares-10-preguntas-y-respuestas/)
- [BCV — doble expresión de precios](https://www.bcv.org.ve/notas-de-prensa/amplio-cumplimiento-en-todo-el-comercio-la-doble-expresion-de-precios)
- [El Nacional — formato QR para exhibir la tasa BCV](https://www.elnacional.com/2025/12/el-nuevo-formato-con-codigo-qr-para-exhibir-la-tasa-oficial-del-bcv-en-comercios/)
- [El Informador — SUNDDE y promociones en divisas](https://elinformadorve.com/27/02/2025/destacada/sundde-reitera-ilegalidad-de-promociones-en-divisas-y-supervisa-cobro-a-tasa-bcv/)
- [Alliot Group — precios en moneda extranjera](https://alliottve.com/publicaciones/https-alliottve-com-precios-moneda-extranjera-comerciantes/)
- [Gálac — providencias SENIAT sobre facturación](https://galac.com/galac-blog/providencias-seniat-facturacion/)
- [Acceso a la Justicia — medios digitales para facturar](https://accesoalajusticia.org/regulacion-del-uso-de-medios-digitales-para-la-emision-de-facturas-y-otros-documentos-fiscales/)
- [MOORE Venezuela — derogación de la 121](https://www.moore-venezuela.com/el-seniat-deroga-la-regulacion-de-las-condiciones-y-requisitos-para-los-proveedores-de-sistemas-informaticos-de-facturacion/)
- [Finanzas Digital — SENIAT deroga sistemas homologados](https://finanzasdigital.com/seniat-deroga-norma-sobre-proveedores-de-sistemas-fiscales/)
- [Nayma Consultores — retenciones de IVA](https://naymaconsultores.com/retenciones-de-iva-en-venezuela/)
