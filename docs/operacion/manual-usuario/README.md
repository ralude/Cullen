# Manual de uso de Cullen

Este manual explica cómo usar la aplicación en el día a día de la tienda. Está escrito para quien
atiende una caja, recibe mercancía o administra el comercio. No hace falta saber nada de
computación para seguirlo.

<!-- solo-repositorio -->
> **Para leer o imprimir:** [`manual-de-uso-cullen.pdf`](./manual-de-uso-cullen.pdf). Es el
> documento completo, con portada y numeración.
>
> Los archivos `.md` de esta carpeta son la **fuente** desde la que se genera. Si corriges algo en
> ellos, vuelve a generar el PDF con `pnpm manual:pdf` en el mismo cambio, para que no queden
> diciendo cosas distintas. Este recuadro no sale en el PDF: va dirigido a quien lee el
> repositorio.
<!-- /solo-repositorio -->


> **Este sistema opera en modo simulado.** Las facturas, notas y reportes X y Z que emite son
> ejercicios de práctica: no tienen validez fiscal ni legal, aunque se vean como los de verdad. La
> aplicación lo dice en pantalla con el rótulo **SIMULACIÓN**, y ese rótulo no se puede quitar.

## Cómo está organizado

| Capítulo | Para quién | Qué cubre |
|---|---|---|
| [1 · Primeros pasos](./01-primeros-pasos.md) | Todos | Entrar, cambiar tu PIN, activar tu credencial, moverte por la aplicación y entender por qué no ves algunas pantallas |
| [2 · Caja](./02-caja.md) | Cajero y jefe de cajas | Abrir el turno, vender, cobrar, facturar, cerrar con arqueo y consultar el catálogo |
| [3 · Inventario](./03-inventario.md) | Depósito y compras | Existencia, movimientos, recepciones, ajustes, proveedores y conteos |
| [4 · Administración](./04-administracion.md) | Administrador del comercio | Dejar la tienda lista para vender: configuración, tasas de cambio, operadores y roles |
| [5 · Supervisión y gerencia](./05-supervision-y-gerencia.md) | Jefe de cajas y gerencia | Reportes, cierres y estado de la sincronización entre estaciones |
| [6 · Cuando algo no sale como esperabas](./06-cuando-algo-falla.md) | Todos | Qué significa cada aviso y qué hacer a continuación |
| [Glosario](./glosario.md) | Todos | Las palabras que la aplicación usa, explicadas |
| [Anexo técnico](./anexo-tecnico.md) | Quien administra | Códigos, correspondencias y datos para escalar un problema |

## Tu recorrido, según lo que haces

Cada persona usa una parte distinta. Estos son los cinco recorridos habituales, con lo que **no**
vas a ver en la barra lateral si ese es tu caso. No verlo no es una falla: es que tu usuario no
tiene habilitada esa tarea.

**Si atiendes una caja** — lee los capítulos [1](./01-primeros-pasos.md) y
[2](./02-caja.md). Trabajas en **Venta**, **Caja** y **Catálogo**. Probablemente no veas
**Config.**, **Identidad**, **Proveedores** ni **Sync**.

**Si eres jefe de cajas** — lee [1](./01-primeros-pasos.md), [2](./02-caja.md) y
[5](./05-supervision-y-gerencia.md). A lo anterior sumas **Reportes**, para revisar cierres y
diferencias, y las autorizaciones que un cajero no puede dar por sí mismo.

**Si trabajas en depósito o compras** — lee [1](./01-primeros-pasos.md) y
[3](./03-inventario.md). Trabajas en **Inventario**, **Proveedores** y **Conteos**. Puede que no
veas **Venta** ni **Caja**.

**Si administras el comercio** — lee [1](./01-primeros-pasos.md) y
[4](./04-administracion.md), y ten a mano el [6](./06-cuando-algo-falla.md). Trabajas en
**Config.**, **Tasas** e **Identidad**. Eres quien habilita a los demás: si un cajero no puede
abrir su turno, la respuesta suele estar en tu capítulo.

**Si eres gerencia** — lee [1](./01-primeros-pasos.md) y
[5](./05-supervision-y-gerencia.md). Trabajas sobre todo en **Reportes**, y en **Sync** cuando
quieras saber si lo que ves está al día.

## Cómo leer un capítulo

Todos tienen la misma forma, para que puedas saltar directo a lo que necesitas:

**Para qué sirve** → **Cuándo la vas a usar** → **Cómo llegar** → **Qué ves** → **Paso a paso** →
**Qué pasa si sale mal**.

Los nombres de botones, campos y pantallas van **en negrita** y con el texto exacto que aparece en
tu pantalla. Si lo que lees no coincide con lo que ves, avísale a quien administra la estación:
puede que el manual esté desactualizado.

---

*Este manual describe la aplicación tal como está hoy. Una pantalla que no está aquí no existe
todavía, y una función que el manual no menciona no está disponible.*
