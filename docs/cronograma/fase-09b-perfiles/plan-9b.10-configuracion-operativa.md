# Plan de ejecución 9B.10: Configuración operativa

- **Sub-fase:** [9B.10 Configuración operativa](./9b.10-configuracion-operativa.md)
- **Estado del plan:** ~~Implementado y cerrado 2026-09-05~~
- **Decisión:** [ADR-0021](../../architecture/adr/0021-mvp-referencia-no-certificado.md) permite
  defaults de referencia sin catálogo fiscal hipotético.

## Resultado esperado

Administrar desde la interfaz los maestros que ya existen —métodos de pago, categorías,
unidades y políticas operativas— sin reescribir hechos históricos.

## Línea base comprobada

- Los repositorios de lectura de categorías, unidades, métodos de pago y cajas ya existen.
- `packages/core/src/application/config` ya contiene sucursales, dispositivos y los permisos
  `config.branch.manage` y `config.device.manage`; 9B.10 se amplía en ese módulo y no abre
  `application/operations`.
- `OperationalPolicyWriter` ya es un puerto de aplicación y el bootstrap es su único consumidor
  actual; los casos de uso de políticas se construyen sobre ese puerto.
- IGTF y descuento máximo ya usan políticas versionadas.
- IVA vive como `taxRateBasisPoints` en `Product`; no existe un catálogo global de alícuotas.
- 9B.02 ya publica las lecturas de datos maestros.
- La auditoría reabrió 9B.11: sus lecturas no autorizan en aplicación, `Device` no impide
  duplicados, el renderer fabrica motivos y genera una clave nueva por cada clic.

## Default de referencia

- La tasa IVA permanece en el producto; no se migra a categorías de alícuotas.
- `quantityScale` queda inmutable después del primer uso.
- Las categorías y unidades reutilizan un permiso de catálogo existente o un único permiso
  mínimo, sin crear una jerarquía nueva de roles.
- Un cambio de política publica una versión nueva; nunca muta la vigente.
- Desactivar un maestro conserva la fila y su historia, y solo bloquea nuevas operaciones.
- El motivo de un cambio sensible lo escribe el operador y viaja sin ser sustituido por React.
- La clave de idempotencia pertenece a la intención del formulario y se conserva hasta recibir
  una respuesta definitiva o abandonar esa intención.

## Secuencia outside-in

1. Cerrar las correcciones de 9B.11 que 9B.10 reutilizará: autorización de lecturas, unicidad de
   dispositivo, motivo real e idempotencia por intención.
2. Probar alta, edición y cambio de estado de los maestros existentes con autorización e
   idempotencia.
3. Probar que una política nueva desactiva la anterior y conserva su histórico.
4. Probar que una configuración nueva no altera ventas ni documentos ya emitidos.
5. Probar rechazo de `quantityScale` después de que la unidad tenga historia y rechazo de
   desactivación cuando un agregado vivo usa el maestro.
6. Probar auditoría con actor, terminal, nodo, UTC, motivo aportado por el operador y valores
   antes/después.
7. Publicar los contratos HTTP y la pantalla con controles derivados de permisos efectivos.

## Criterios de aceptación

- [x] ~~Los maestros existentes se administran desde la interfaz con permisos de caso de uso.~~
- [x] ~~Las lecturas administrativas autorizan en aplicación antes de consultar.~~
- [x] ~~Las políticas versionadas conservan su historial.~~
- [x] ~~No existe borrado físico de un maestro con historia.~~
- [x] ~~Los cambios sensibles conservan motivo real, auditoría e idempotencia por intención y no
  reescriben hechos.~~
- [x] ~~La unicidad de dispositivos y el bloqueo de desactivación en uso tienen pruebas de
  aplicación y persistencia; no se asume que exista un precedente reutilizable.~~
- [x] ~~El catálogo futuro de alícuotas no es requisito de salida.~~
- [x] ~~`pnpm test`, `pnpm typecheck` y `pnpm lint` quedan verdes.~~ 591 pruebas / 120 archivos.

## Evidencia de cierre

`OperationalMasterDataStore` hace explícita la consulta de uso vivo e historia; categorías,
unidades y métodos se desactivan sin borrar filas. Los comandos se autorizan antes de tocar el
store, conservan la clave de intención, auditan motivo/actor/terminal/nodo/UTC y publican las
políticas mediante `OperationalPolicyWriter`. La interfaz exige confirmar alcance y nueva
vigencia para descuento e IGTF, ambos rotulados como `SIMULACIÓN`.

## Fuera de alcance

- Catálogo general de alícuotas y taxonomía fiscal por país.
- Administración de identidad, cajas y nuevas capacidades de dispositivos; las correcciones
  de 9B.11 enumeradas arriba sí son prerrequisito.
- Distribución de datos de referencia entre nodos.
