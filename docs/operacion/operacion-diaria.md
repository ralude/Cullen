# Operación diaria

> **Esta guía se convirtió en el [Manual de uso de Cullen](./manual-usuario/README.md).**
>
> Su recorrido de jornada —abrir la caja, vender, cobrar, facturar, anular, devolver, cerrar con
> arqueo y leer el inventario— vive ahora ahí, escrito para quien atiende una caja y no para quien
> lee este repositorio. Esta ruta se conserva para que los enlaces existentes sigan funcionando.
>
> **Para leer o imprimir:**
> [`manual-de-uso-cullen.pdf`](./manual-usuario/manual-de-uso-cullen.pdf).

La absorción es de [12B.10](../cronograma/fase-12b-manual-usuario/12b.10-absorcion-y-verificacion.md),
por la decisión D2 de la [Fase 12B](../cronograma/fase-12b-manual-usuario/README.md). Se hizo para
que no queden dos descripciones de la misma venta contradiciéndose en el primer cambio de interfaz.

## Dónde quedó cada cosa

| Lo que esta guía recorría | Dónde está ahora |
|---|---|
| Ingresar, y por qué no se ven todas las pantallas | [1 · Primeros pasos](./manual-usuario/01-primeros-pasos.md) |
| Abrir la caja, movimientos de efectivo, cerrar con arqueo | [2 · Caja](./manual-usuario/02-caja.md) |
| Vender, cobrar, facturar, anular y devolver | [2 · Caja](./manual-usuario/02-caja.md) |
| Inventario, kardex, recepciones, ajustes y conteos | [3 · Inventario](./manual-usuario/03-inventario.md) |
| Lo que hay que configurar antes del primer día | [4 · Administración](./manual-usuario/04-administracion.md) |
| Cierres, reportes y reportes X y Z | [5 · Supervisión y gerencia](./manual-usuario/05-supervision-y-gerencia.md) |
| Qué hacer cuando algo falla | [6 · Cuando algo no sale como esperabas](./manual-usuario/06-cuando-algo-falla.md) |
| Códigos de permiso, códigos de error y correlación | [Anexo técnico](./manual-usuario/anexo-tecnico.md) |

Los pasos de arranque de una base nueva —administrador inicial, configuración operativa y catálogo
de ejemplo— no son del operador y siguen fuera del manual: están en
[el README](../../README.md#cómo-ejecutarlo) y en
[la instalación de una estación](./instalacion-estacion.md).

## La regla que esta guía declara

Esta única regla **no se movió al manual**, porque gobierna la implementación y no el trabajo de
quien opera la caja. Dos documentos normativos la citan desde acá, así que se conserva aquí:

> Todos los totales, impuestos y el IGTF los calcula el nodo. La pantalla nunca hace aritmética de
> negocio: no determina totales, impuestos ni la validez de un lote de pagos.

La [enmienda del 2026-09-11 de ADR-0031](../architecture/adr/0031-base-del-igtf-en-pagos-mixtos.md#enmienda-2026-09-11-la-pantalla-puede-sugerir-el-importe-gravado)
la precisa sin cambiarla de fondo: precargar un importe que el cajero puede corregir —el saldo
pendiente, o el bruto con el impuesto incluido— es **sugerir, no decidir**. El nodo recalcula el
lote recibido y rechaza con un error visible lo que no cuadre.

La citan [ADR-0031](../architecture/adr/0031-base-del-igtf-en-pagos-mixtos.md) y el
[rediseño de la pantalla de venta](../cronograma/rediseno-pantalla-de-venta.md).

## Documentos relacionados

- [Manual de uso de Cullen](./manual-usuario/README.md): el destino de esta guía.
- [Catálogo de ejemplo](./seed-de-catalogo-de-ejemplo.md): qué siembra la seed y qué no.
- [Escenarios de fallo](../failure-scenarios/README.md): qué garantiza el sistema cuando algo se
  interrumpe a mitad de una operación.
- [Alcance por entrega](../producto/alcance-entregas.md).
