# Fase 12B: Manual de usuario no técnico

- **Estado:** Planificada el 2026-09-09; ejecución pendiente.
- **Entrada:** [V0.1.04 — Publicación](../release-v0.1-portafolio/4-publicacion.md) cerrada.
- **Tipo:** fase documental. No entrega código ni cambia comportamiento observable.
- **Destino del entregable:** `docs/operacion/manual-usuario/`.
- **Índice:** [Cronograma maestro](../README.md).

## Propósito

Escribir el manual con el que una persona **sin formación técnica** puede usar todo lo que la
aplicación renderiza: las doce pantallas de la navegación, el ingreso, el cambio de PIN
obligatorio, el enrolamiento de credencial y la barra de estado. Hoy esa persona no tiene ese
documento: [`operacion-diaria.md`](../../operacion/operacion-diaria.md) recorre una jornada de
caja en 178 líneas, cita códigos de permiso y de error en el cuerpo, y deja fuera configuración,
identidad, sincronización, proveedores, conteos y tasas.

El manual describe **lo que la interfaz muestra hoy**, no lo que está planificado. Una pantalla
que no existe en el árbol no entra en el manual, y una capacidad suspendida —la impresión fiscal
real— se nombra como suspendida.

## Por qué es 12B y no una etapa del release

`v0.1.0` publica el proyecto para un lector técnico: README, arquitectura, quickstart y capturas
de la demo, según [V0.1.03](../release-v0.1-portafolio/3-documentacion-portafolio.md). Este manual
se dirige a quien opera una caja, y su lector no lee el repositorio. Son dos documentos con
audiencias distintas; mezclarlos ampliaría una etapa del release que ya tiene su criterio de
salida.

Numerarla 12B la ancla al mismo tramo que la Fase 12 sin depender de ella: 12B documenta
comportamiento observable, y Fase 12 se comprometió a preservarlo. La relación operativa está en
[Interacción con la Fase 12](#interacción-con-la-fase-12).

## Decisiones fijadas el 2026-09-09

Se resolvieron antes de planificar, como exige el orden de trabajo del proyecto.

| # | Decisión | Alternativa descartada y por qué |
| --- | --- | --- |
| D1 | El manual lleva **una captura por pantalla**: doce rutas más ingreso, cambio de PIN y enrolamiento. | Solo texto costaba menos mantenimiento pero exige al lector no técnico reconstruir la pantalla mentalmente, que es justo lo que el manual debe evitar. Se acepta el costo de re-capturar cuando la UI cambie, y 12B.03 fija cómo. |
| D2 | El manual **absorbe** `operacion-diaria.md`: su recorrido pasa a ser el capítulo de jornada y la guía actual queda como redirección. | Conservar ambos crea dos descripciones de la misma venta que se contradicen en el primer cambio de UI. La redirección conserva los enlaces existentes. |
| D3 | 12B se ejecuta **después de publicar `v0.1.0`**. | Incluirla en V0.1.03 retrasaría el release y ampliaría una etapa dirigida a otro lector. Ejecutarla en paralelo obligaría a re-verificar el manual contra una UI todavía móvil. |

## Secuencia obligatoria

Los capítulos siguen los grupos que la navegación ya muestra, para que el índice del manual y la
barra lateral coincidan.

1. [12B.01 — Inventario verificable de la interfaz](./12b.01-inventario-de-interfaz.md): fija
   sobre un commit qué pantallas, secciones, acciones y estados existen. Sin este corte,
   «todo lo que renderiza» no es comprobable.
2. [12B.02 — Lenguaje, plantilla y glosario](./12b.02-lenguaje-y-plantilla.md): define el
   registro no técnico, la estructura de capítulo y dónde viven los códigos.
3. [12B.03 — Capturas reproducibles](./12b.03-capturas.md): cómo se generan las quince imágenes
   sin datos reales y cuándo se vuelven a tomar.
4. [12B.04 — Primeros pasos](./12b.04-primeros-pasos.md): ingresar, cambiar el PIN, activar una
   credencial, leer la barra de estado y entender por qué una pantalla no aparece.
5. [12B.05 — Caja](./12b.05-caja.md): Venta, Caja y Catálogo. Absorbe el recorrido de jornada.
6. [12B.06 — Inventario](./12b.06-inventario.md): Inventario, Proveedores y Conteos.
7. [12B.07 — Administración](./12b.07-administracion.md): Configuración, Tasas e Identidad.
8. [12B.08 — Supervisión y gerencia](./12b.08-supervision-y-gerencia.md): Reportes y Sync.
9. [12B.09 — Cuando algo no sale como esperabas](./12b.09-cuando-algo-falla.md): los mensajes de
   error en lenguaje corriente y el anexo técnico.
10. [12B.10 — Absorción, prueba con lector real y cierre](./12b.10-absorcion-y-verificacion.md):
    redirigir la guía anterior y verificar el manual con alguien que no programa.

12B.01 y 12B.02 preceden a todo lo demás: sin inventario no hay cobertura verificable y sin
plantilla cada capítulo inventa su propia forma. 12B.03 puede solaparse con los capítulos, porque
cada captura pertenece al capítulo que la usa. 12B.09 se escribe al final, cuando ya se sabe qué
mensajes aparecieron al recorrer las pantallas. 12B.10 cierra.

## Reglas de escritura

Gobiernan este entregable y son la diferencia entre un manual y una referencia técnica reordenada.

- **El lector no programa.** El cuerpo de un capítulo no contiene códigos de permiso
  (`cash.shift.open`), códigos de error (`CASH_REGISTER_NOT_FOUND`), rutas HTTP, nombres de tabla
  ni identificadores internos. Van al anexo de 12B.09, para quien tenga que escalar un problema.
- **Se describe la pantalla, no la implementación.** El nombre del botón que el usuario ve, el
  atajo que la barra lateral muestra, el orden real de los campos.
- **No se inventan reglas de negocio.** Si el comportamiento de una pantalla no está especificado
  en su sub-fase, ADR o escenario de fallo, se declara la ambigüedad y se resuelve antes de
  escribirlo. Un manual que adivina enseña mal.
- **`SIMULACIÓN` permanece visible.** El manual explica que el rótulo significa que ningún
  documento tiene validez fiscal, y nunca lo presenta como cumplimiento ni como certificación.
- **Nada sensible en el texto ni en las imágenes:** PIN, tokens, cookies, claves, certificados,
  rutas de material protegido, datos de una persona o de un comercio real.
- **Cada instrucción es ejecutable.** Un paso dice qué hacer y qué se ve después. «Configure los
  parámetros» no es un paso.
- **Un hallazgo no se arregla aquí.** Si al escribir aparece un defecto de la interfaz o un
  mensaje incomprensible, se registra como hallazgo con su pantalla y su reproducción; corregirlo
  pertenece a la fase dueña de esa capacidad, no a una fase documental.

## Cobertura exigida

El manual cubre las doce rutas que la navegación declara, en sus cinco grupos, más lo que se ve
antes de entrar y alrededor del área de trabajo.

| Grupo de la navegación | Pantallas | Capítulo |
| --- | --- | --- |
| — (antes de entrar) | Ingreso, cambio de PIN obligatorio, activación de credencial | 12B.04 |
| General | Inicio | 12B.04 |
| Caja | Venta, Caja, Catálogo | 12B.05 |
| Inventario | Inventario, Proveedores, Conteos | 12B.06 |
| Administración | Configuración, Tasas, Identidad | 12B.07 |
| Supervisión y gerencia | Reportes, Sync | 12B.08 |
| Marco de la ventana | Barra lateral con atajos, título y descripción, estado de conexión, rótulo fiscal, operador y salida | 12B.04 |

Un capítulo cubre una pantalla cuando describe sus secciones, sus acciones, sus estados vacíos y
lo que ocurre cuando la acción falla. Enumerar botones sin decir cuándo se usan no es cobertura.

## Los cinco perfiles como recorridos

Además del capítulo por pantalla, el manual abre con un recorrido por perfil, porque nadie usa
las doce pantallas: cajero, jefe de cajas, inventario, administrador y gerencia, tal como los
entregó la [Fase 9B](../fase-09b-perfiles/README.md). Cada recorrido enlaza los capítulos que
ese perfil necesita y dice explícitamente cuáles no verá. Un perfil no es una promesa de
permisos: la navegación muestra lo que la sesión alcanza, y el manual lo explica así.

## Interacción con la Fase 12

12B no depende de 12.01–12.05 ni las bloquea. La relación es en un solo sentido y conviene
dejarla escrita:

- Fase 12 optimiza con comportamiento preservado, y
  [12.05.06](../fase-12-optimizacion/12.05-mantenibilidad-estructural.md) toca explícitamente la
  estructura de `App.tsx` y de la pantalla de inventario, con la aceptación de que «la interacción
  observable permanece igual».
- Mientras eso se cumpla, el manual y sus capturas siguen siendo válidos.
- Si un corte de Fase 12 cambia interacción observable, ese mismo hito actualiza el capítulo y la
  captura afectados. No se acumula deuda documental para un cierre posterior.

## Gate de salida

- [ ] Las diez sub-fases están cerradas y el manual vive publicado en
      `docs/operacion/manual-usuario/`.
- [ ] Cada pantalla del inventario de 12B.01 tiene capítulo, y cada capítulo tiene su captura.
- [ ] Ningún cuerpo de capítulo contiene códigos de permiso, códigos de error, rutas HTTP ni
      identificadores internos; el anexo sí los conserva.
- [ ] Ninguna captura contiene PIN, token, clave, ruta de material protegido ni datos reales.
- [ ] Una persona que no programa completó, solo con el manual, las tareas de verificación de
      12B.10, y lo que falló quedó corregido.
- [ ] `operacion-diaria.md` redirige al manual y no queda ninguna descripción duplicada de la
      venta.
- [ ] Los enlaces resuelven, `pnpm lint` y `git diff --check` están limpios.
- [ ] Los hallazgos de interfaz encontrados al escribir están registrados con su pantalla y su
      fase dueña, sin corregirse dentro de 12B.
- [ ] Ningún texto ni imagen presenta la simulación fiscal como certificación, ni el manual como
      habilitación de una tienda real.

## Fuera de alcance

- Cambiar código, textos de la interfaz, mensajes de error o comportamiento. 12B documenta; no
  corrige.
- Ayuda dentro de la aplicación, tooltips, tour guiado o video. El entregable es un documento.
- Los runbooks de administración —instalación, respaldo, material LAN, rotación, seed—, que
  siguen viviendo en [`docs/operacion/`](../../operacion/operacion-diaria.md) y se dirigen a
  quien administra la estación, no a quien la opera.
- Traducciones, material de capacitación, marketing o soporte.
- Manual de una impresora fiscal real, que depende de la [Fase 8](../fase-08-integracion-serial/README.md)
  suspendida y del [gate de piloto en tienda](../gate-piloto-release.md).
- Pantallas de las Fases 13–17, que no existen.
