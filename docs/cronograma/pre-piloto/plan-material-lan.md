# Plan de ejecución: material TLS de la LAN

- Fecha: 2026-09-09.
- Estado: **entregado el 2026-09-09** con una autoridad interna; la PKI de un despliegue real
  sigue siendo una decisión abierta del gate.
- Decisiones: [ADR-0026](../../architecture/adr/0026-lan-operativa-y-recuperacion-entre-nodos.md)
  exige autenticación mutua; [ADR-0029 D9](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md)
  fija la rotación.

## Línea base verificada

El transporte LAN ya exigía mTLS y fallaba cerrado ante material incompleto, y el arranque ya
rechazaba material en claro con `SECRET_MATERIAL_NOT_SEALED`. Lo que no existía era **cómo
obtener el material**: no había autoridad, ni emisión, ni procedimiento de alta de una terminal.
El runbook de rotación cubría reemplazar material vigente, no emitirlo por primera vez.

Ya estaba resuelto y no hubo que tocarlo: `SYNC_LISTENER_TLS_CLIENT_CA_PATHS` y
`SYNC_CLIENT_TLS_CA_PATHS` aceptan una lista, así que el nodo confía en la autoridad vieja y la
nueva a la vez y el relevo de CA no corta la LAN.

## Cortes

1. **Emisión.** `generate-lan-material` envuelve el `openssl` del sistema: autoridad interna,
   una clave y un certificado por nodo, SAN por IP u hostname, uso `serverAuth` y `clientAuth`
   porque un nodo escucha y entrega con la misma identidad.
2. **Runbooks.** [Emisión de material LAN](../../operacion/emision-material-lan.md) para el alta
   inicial y de una terminal nueva; la [rotación](../../operacion/rotacion-material-protegido.md)
   la enlaza.

## Decisiones tomadas

- **Autoridad interna, no dependencia npm.** Node no emite X.509 y AGENTS.md prohíbe sumar
  dependencias sin necesidad concreta; se envuelve `openssl` y se falla con código estable si no
  está.
- **El material sale en claro y se sella localmente.** La clave que protege un archivo vive en el
  almacén del nodo que lo usará y no viaja, así que el sellado no puede ocurrir en la máquina
  que emite.
- **`ca.key` no vive en ninguna estación en operación.** Quien la tiene puede emitir un nodo.

## Criterios de aceptación

Evidencia: `apps/server/src/generate-lan-material.test.ts`.

- [x] CA-PP-18: existe una emisión reproducible de autoridad y material por nodo, con vigencia y
  nombres declarados.
- [x] CA-PP-19: cada certificado verifica contra su autoridad, responde por los nombres
  declarados y no por otros, y sirve a las dos puntas del mTLS.
- [x] CA-PP-20: cada nodo tiene su propia clave privada.
- [x] CA-PP-21: el arranque rechaza el material en claro y lo acepta una vez sellado, probado
  contra la configuración real de listener y cliente.
- [x] CA-PP-22: existe un runbook de emisión inicial y de alta de una terminal, con el borrado
  del material en claro y la verificación por **aplicación** y no por ACK de custodia.
- [ ] CA-PP-23: la PKI del despliegue real queda decidida. **Abierto**: si la instalación tiene
  PKI corporativa, reemplaza a la autoridad interna; sigue en el gate de piloto.
- [x] CA-PP-24: `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes.

## Fuera de alcance

La distribución del material a cada estación y su custodia, que son operación. El reemplazo
coordinado de certificados vigentes, que ya tiene su runbook con la dependencia de confianza
explícita. La emisión automática por ACME o una CA en línea: añadiría una superficie de red para
una operación que en una tienda ocurre una vez cada dos años.
