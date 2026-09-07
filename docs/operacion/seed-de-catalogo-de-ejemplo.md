# Seed de catálogo de ejemplo

Genera un catálogo mínimo para probar el sistema sin cargar datos a mano: tres categorías, una
unidad de medida y cinco productos con su código de barras y su precio.

Está pensada para **bases de prueba**. No es una carga inicial de producción ni un migrador de
catálogos existentes: lee lo mismo cada vez y sobrescribe los cinco productos que le pertenecen.

- **Implementación:** [`apps/server/src/seed-products.ts`](../../apps/server/src/seed-products.ts)
- **Prueba:** [`apps/server/src/seed-products.test.ts`](../../apps/server/src/seed-products.test.ts)

## Cómo ejecutarla

```bash
pnpm --filter @supermarket/server seed:products \
  --database ./supermarket-node.sqlite \
  --currency USD \
  --tax-rate-basis-points 1600
```

Salida al terminar:

```
Seed listo: 5 productos, 3 categorías y 1 unidad de medida.
```

Las tres opciones son obligatorias; no hay valores por defecto, para que la moneda y el impuesto
del catálogo de prueba sean una decisión explícita y no un supuesto heredado.

| Opción | Qué recibe | Reglas |
|---|---|---|
| `--database` | Ruta al archivo SQLite del nodo | Se resuelve a ruta absoluta. `:memory:` se rechaza: una base que desaparece al terminar no deja catálogo que usar |
| `--currency` | Código ISO-4217 de tres letras | Se normaliza a mayúsculas y se aplica al precio de los cinco productos |
| `--tax-rate-basis-points` | Entero no negativo en puntos base | `1600` es 16 %; `0` es exento. No admite decimales ni valores negativos |

Si falta una opción o el valor no es válido, el comando escribe la causa y la línea de uso, y
termina con código de salida `1` sin haber escrito nada:

```
No se pudo generar el catálogo de ejemplo: Falta la opción requerida --database.
Uso: pnpm seed:products -- --database <ruta> --currency <ABC> --tax-rate-basis-points <entero>
```

No hace falta que el archivo exista: la seed aplica las migraciones pendientes antes de escribir,
así que funciona sobre una base nueva y sobre una ya migrada.

## Qué crea

Todo se escribe en **una sola transacción**: o queda el catálogo completo, o no queda nada.

**Categorías:** Alimentos básicos, Bebidas, Lácteos.

**Unidad de medida:** `UN` — Unidad, con escala de cantidad `0`, es decir, sin decimales.

**Productos**, todos con la unidad `UN`, la moneda y el impuesto que pasaste por opción:

| Producto | Categoría | Código de barras | Precio (unidades menores) |
|---|---|---|---|
| Arroz blanco 1 kg | Alimentos básicos | `DEMOARROZ001` | 180 |
| Harina de maíz 1 kg | Alimentos básicos | `DEMOHARINA001` | 140 |
| Café molido 250 g | Alimentos básicos | `DEMOCAFE001` | 450 |
| Agua mineral 1 L | Bebidas | `DEMOAGUA001` | 100 |
| Leche UHT 1 L | Lácteos | `DEMOLECHE001` | 250 |

El precio va en **unidades menores enteras**, nunca en decimales de punto flotante
([ADR-0003](../architecture/adr/0003-sqlite-dinero-identificadores.md) y `Money`). Con una moneda
de dos decimales, `180` es 1,80. Cambiar `--currency` no reconvierte el monto: reetiqueta el mismo
entero con otra moneda, que es justo lo que se quiere en un catálogo de prueba.

Cada producto queda además con un código de barras activo y una entrada de historial de precio
atribuida a `seed:example-products`, con fecha fija `2026-09-02T00:00:00Z`.

## Por qué se puede repetir

Todos los identificadores están fijos en el código, así que ejecutar la seed dos veces con las
mismas opciones deja exactamente el mismo catálogo: cinco productos, no diez. La prueba
automatizada lo verifica ejecutándola dos veces seguidas y contando las filas.

Eso la hace segura para reconstruir un entorno de prueba sin borrar la base antes.

## Lo que la seed no hace

Es un catálogo, no un entorno completo. Conviene tenerlo claro antes de buscar el problema en
otro sitio:

- **No crea existencias.** `stock_items` queda vacío: los productos existen pero no tienen
  inventario, así que todavía no se pueden vender. Para tener saldo hay que registrar una
  recepción de compra por el flujo normal.
- **No crea usuarios, sucursales ni métodos de pago.** Eso lo hacen
  `bootstrap-admin` (administrador inicial) y `bootstrap-operations` (datos operativos).
- **No escribe ledger, outbox ni auditoría.** Persiste directamente por los repositorios, así que
  no genera eventos de negocio ni hechos de integración.

Esa última consecuencia importa en LAN: **el catálogo sembrado no viaja solo a las terminales.**
Para distribuirlo hay que publicarlo desde el coordinador con
`POST /api/v1/sync/references/catalog/bootstrap` (permiso `sync.reference.publish`), que lee el
estado vigente de los maestros —incluido lo que sembró la seed— y lo publica con los mismos
contratos que un cambio ordinario.

## Cuidado al repetirla con otras opciones

Guardar un producto reemplaza su fila y **reescribe** sus códigos de barras y su historial de
precio. Repetir la seed cambiando `--currency` o `--tax-rate-basis-points` no agrega un precio
nuevo: sobrescribe el de esos cinco productos y descarta cualquier historial que otros flujos
hubieran registrado para ellos.

Además, la seed **no pasa por los casos de uso de catálogo**: no emite un evento de cambio de
precio ni avanza la versión del producto, que se queda en `1`. Como el consumidor de referencias
solo aplica una publicación cuya versión sea mayor que la ya aplicada, una terminal que ya
recibió la versión `1` **ignoraría** el catálogo resembrado con otra moneda. Los dos nodos
quedarían mostrando precios distintos sin ningún error visible.

Por eso: úsala sobre bases de prueba y, si necesitas cambiar la moneda o el impuesto, parte de una
base limpia en lugar de resembrar encima. Para cambiar el precio de un producto real está
`ChangeProductPrice`, que sí registra el hecho, avanza la versión y se distribuye.
