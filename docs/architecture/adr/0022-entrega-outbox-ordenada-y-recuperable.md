# ADR-0022: Entrega outbox ordenada y recuperable

- Estado: Aceptado
- Fecha: 2026-09-05
- Complementa: ADR-0005 y ADR-0009

## Contexto

El outbox local ya conserva eventos e intentos, pero su relay podía reclamar varias versiones
del mismo agregado y aceptar resultados tardíos de un intento cuyo lease había sido sustituido.
Eso permite adelantar hechos del agregado o sobrescribir el estado de una reclamación vigente.

La Fase 10 todavía no ha definido el protocolo ni el receptor remoto. Esta sub-fase necesita
cerrar primero las garantías locales de la cola sin duplicar el payload en otra tabla.

## Decisión

`outbox_event` es la cola durable de una única salida configurada. En esa salida,
`PUBLISHED` significa que el publisher confirmó la entrega a su destino durable. Una llamada
local, una escritura en un socket o un consumidor distinto no constituye esa confirmación.

La entrega es al menos una vez. El relay publica fuera de la transacción SQLite y el receptor
debe deduplicar por `eventId`. Si se pierde la confirmación después de que el destino aceptó el
evento, el mismo evento puede enviarse de nuevo.

La selección aplica estas reglas:

- el grupo ordenado es `(originNodeId, aggregateType, aggregateId)`;
- solo la menor `aggregateVersion` no publicada del grupo es elegible;
- si hay más de un evento de la misma versión, `eventId` establece el orden determinista;
- se reclama como máximo una entrada de cada grupo por lote;
- una cabecera en retry futuro o con lease vigente bloquea sus sucesores, mientras otros
  agregados pueden avanzar;
- no se exige continuidad numérica porque el outbox contiene hechos seleccionados.

El contador durable `attempts` es la generación del claim. Reclamar incrementa la generación
y fija el lease en la misma transacción. Revalidar, confirmar y reprogramar comparan
`eventId`, estado `PROCESSING` y generación. Un resultado de una generación sustituida no
modifica la vigente. La recuperación ocurre al vencer el lease; el arranque no reinicia las
filas en proceso.

Las filas históricas conservan su estado. Esta decisión no activa un relay en producción ni
define qué historia se enviará cuando se conecte el transporte. Si aparecen dos destinos
durables independientes, cada uno necesitará su propio estado de entrega sin duplicar el
payload; una sola columna `status` no puede representar ambas confirmaciones.

## Consecuencias

- No se agrega una tabla `sync_queue` ni una dependencia nueva.
- Una versión fallida bloquea únicamente su agregado.
- Un lease puede vencer durante una publicación y causar reentrega, pero no permite que una
  respuesta tardía sobrescriba un claim posterior.
- Un fallo del publisher y un fallo al guardar la confirmación permanecen distinguibles.
- La compatibilidad completa, el aislamiento de contratos desconocidos, el destino de red,
  la autenticación y la deduplicación receptora quedan en 10.02 y 10.03.
- El backoff existente sigue siendo un mecanismo técnico acotado; su política definitiva y
  el agotamiento pertenecen a 10.04.
