# Notas de versión — `v0.1.0`

- **Estado:** publicadas el 2026-09-10 como cuerpo del release de GitHub de
  [V0.1.04](./4-publicacion.md), sobre el commit etiquetado.
- **Qué distribuye:** código fuente. **No** se adjunta el MSI, porque se construye sin firmar.
- **Licencia:** [Apache 2.0](../../../LICENSE).

> **Esto es un MVP de referencia no certificado.** La fiscalidad opera con un driver simulado
> rotulado `SIMULACION`. No hay integración con impresoras fiscales reales, no ha corrido un
> piloto en una tienda y el [gate de piloto en tienda](../gate-piloto-release.md) sigue abierto.
> No lo despliegues sobre datos reales de un comercio.

## Qué es

Cullen es una plataforma de punto de venta e inventario para supermercados, construida
**offline-first** para las condiciones del comercio minorista venezolano: varias monedas
simultáneas con tasas volátiles, conectividad intermitente, impresoras fiscales que fallan a mitad
de una operación y auditoría obligatoria. Monorepo TypeScript con DDD táctico y arquitectura
hexagonal: dominio puro, casos de uso con puertos y adaptadores intercambiables.

## Capacidades entregadas

| Área | Qué opera |
| --- | --- |
| Caja | apertura de turno, venta multimoneda, cobro con IGTF y descuento por política versionada, devolución con reintegro, cierre con arqueo y esperado negativo autorizado |
| Inventario | kardex, costos y margen, ajustes, conteos físicos con diferencia congelada, proveedores y recepciones de compra |
| Fiscal | documento simulado con evidencia recuperable en cuatro ejes independientes; recuperación determinista y *fail-closed* |
| Identidad | administración de usuarios y permisos, PIN con cambio obligatorio, enrolamiento local de credencial, autorización auditable en la capa de aplicación |
| Sincronización LAN | outbox durable con orden por agregado, protocolo de eventos entre nodos, receptor con autenticación mutua, operación offline y reconexión |
| Reportes | ventas e inventario con exportación CSV, arqueos e historia de venta |
| Operación | instalación como servicio de Windows supervisado, respaldo cifrado, emisión y rotación de material TLS de la LAN |

La interfaz deriva navegación y controles de los **permisos efectivos de la sesión**: un perfil no
ve una acción que el servidor le rechazaría.

## Lo arquitectónicamente destacable

- **Dinero entero, nunca `float`.** `Money` guarda unidades menores enteras con su código de
  moneda y opera con `BigInt`. Sumar dos monedas distintas es un error de dominio.
- **Ownership por nodo sin *last-write-wins*.** Cada agregado tiene un `originNodeId` inmutable
  respaldado por *triggers*; si el ownership no se resuelve, la mutación se rechaza en vez de
  adivinar.
- **Entrega *at-least-once* sin efectos duplicados**, verificada en **once escenarios de corte de
  red** con un coordinador y dos terminales sobre tres archivos SQLite independientes y
  *listeners* reales.
- **Idempotencia por intención**, no por reintento: misma clave y mismo *fingerprint* devuelven la
  misma respuesta; misma clave con otro contenido falla con `IDEMPOTENCY_KEY_CONFLICT`.
- **Invariantes defendidos en dos capas:** las reglas viven en el dominio y las críticas tienen
  además **125 triggers** en SQLite.
- **Fronteras impuestas por el linter:** `eslint.config.js` prohíbe por capa; `core/domain` no
  puede importar Fastify, Drizzle, Electron ni React y el build falla si alguien lo intenta.
- **Datos en reposo con el límite escrito:** PIN con scrypt y sal individual, token solo como
  SHA-256, respaldos y secretos sellados con AES-256-GCM, ACL del directorio verificada al
  arrancar. El archivo SQLite operativo **no** se cifra, por decisión explícita de
  [ADR-0029](../../architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.1.

## Verificación

1.282 pruebas en 198 archivos, 31 ADR y 44 migraciones forward-only con checksum SHA-256.
TypeScript estricto con `exactOptionalPropertyTypes`. El pipeline —lint, typecheck, suite completa
y compilación de artefactos— corre en GitHub Actions sobre `windows-latest` en cada pull request y
cada cambio de `main`.

## Limitaciones conocidas

- **Referencia no certificada.** Ningún artefacto, texto ni pantalla afirma cumplimiento fiscal.
- **`FiscalPrinterFake`.** No hay soporte de modelos reales: la Fase 8 está suspendida por
  dependencia externa —hardware, protocolo del fabricante y laboratorio de certificación—.
- **Sin piloto.** No ha operado en una tienda; el gate de piloto conserva sus requisitos.
- **Sin instalador publicado.** El MSI de WiX se construye pero no se firma, así que no se adjunta.
- **Windows.** Es la plataforma objetivo del nodo y del escritorio; no hay otra probada.
- **Sin promesa de uso comercial**, soporte garantizado ni SLA.
- **Fase 12 no está hecha.** El rendimiento no se ha medido contra presupuestos declarados.
- **Pago en una moneda distinta a la de la venta.** La pantalla de venta no envía la tasa de
  cambio, así que ese cobro no es alcanzable; ver [defectos conocidos](../defectos-conocidos.md).

## Qué sigue

- [Fase 12](../fase-12-optimizacion/README.md) — optimización medida de comunicación HTTP local,
  SQLite y mantenibilidad estructural, con evidencia BEFORE/AFTER. 12.04 sigue suspendida con la
  Fase 8.
- [Fase 12B](../fase-12b-manual-usuario/README.md) — manual de usuario no técnico de las doce
  pantallas. Documental, independiente de la Fase 12.
- [Post-MVP](../evolucion-post-mvp.md) — almacenes por sucursal (13), plataforma central
  PostgreSQL (14), sincronización SQLite–PostgreSQL (15), web app interna (16), sistema de diseño
  propio (16B) y validación con despliegue gradual (17). Ninguna está iniciada.

Los defectos de `v0.1.x` se corrigen sin adelantar fases futuras; una capacidad nueva sigue el
[cronograma](../README.md) y sus fuentes normativas.
