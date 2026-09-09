# Paquete de trabajo pre-piloto

- **Estado:** En ejecución desde el 2026-09-09; empaquetado, respaldo operativo y material LAN
  entregados. La validación en tienda real y la firma siguen abiertas.
- **Índice:** [Cronograma](../README.md)
- **Gate que sirve:** [Gate de piloto y release](../gate-piloto-release.md)

## Qué es y qué no es

Recoge los entregables del gate de piloto que dejaron de ser sólo una lista de verificación y
ahora tienen plan, código y prueba: instalar la estación, respaldarla y emitir su material de
LAN.

**No es una fase.** No reabre la Fase 11 —completada el 2026-09-08—, no renumera nada y no
adelanta la Fase 12. No cierra el gate: el gate lo cierra una instalación piloto verificada, con
la Fase 8 reanudada y completada.

Existe porque el estado y el orden de fases viven en el cronograma, y este trabajo no pertenece
a ninguna fase abierta: es capacidad de despliegue que el gate ya exigía y que hasta ahora sólo
estaba declarada como brecha.

## Planes

- [Empaquetado del nodo](./plan-empaquetado-nodo.md) — servicio de Windows, bundle, MSI y la
  prueba del arranque empaquetado que cierra CA-11.03-09.
- [Respaldo operativo](./plan-respaldo-operativo.md) — cadencia del servicio, CLI y ensayo de
  restauración automatizado.
- [Material TLS de la LAN](./plan-material-lan.md) — autoridad interna, emisión y sellado.

## Decisión que los gobierna

[ADR-0030](../../architecture/adr/0030-empaquetado-y-runtime-del-nodo.md), aceptado el
2026-09-09: el nodo es un servicio de Windows independiente supervisado por WinSW, distribuido
en un MSI de WiX que aplica la ACL que ADR-0029 D7.2 exige; el servidor se compila a un bundle
con runtime Node embebido; la firma de ejecutables queda diferida.

## Fuera de alcance

Firma de ejecutables; validación del MSI en hardware de tienda real; chaos tests de energía,
LAN, Electron y dispositivo fiscal; PKI corporativa si reemplaza a la autoridad interna;
calificación del hardware fiscal, que sigue suspendida con la
[Fase 8](../fase-08-integracion-serial/README.md). Nada de esto se presenta como cubierto.
