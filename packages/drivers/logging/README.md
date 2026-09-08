# @supermarket/driver-logging

Driver para logs técnicos estructurados y auditoría de negocio. Aislará Pino, rotación, redacción de secretos y correlation IDs.

La auditoría de negocio no se debe reemplazar por logs de consola.

## Redacción disponible

`createRedactionOptions()` devuelve la configuración de redacción que consume el logger Pino de
`apps/server`: censura por posición las cabeceras que registra el framework y, por nombre de
campo, cualquier secreto dentro del objeto registrado —a cualquier profundidad y sin tocar la
configuración cuando aparece un campo nuevo con un nombre conocido—.

`describeError()` describe un error para el log técnico sin registrarlo crudo: tipo, código
estable, mensaje seguro y la cadena de causas ya redactada. El stack queda en el log técnico y
nunca en la respuesta al cliente.

La lista de nombres sensibles aplica `docs/architecture/10-logs.md`. Un requisito diagnóstico
que necesite un dato excluido debe aprobarse antes de ampliarla.
