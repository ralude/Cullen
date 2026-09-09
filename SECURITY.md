# Política de seguridad

## Alcance y estado del proyecto

Cullen es un **MVP de referencia no certificado**. No ha corrido un piloto en una tienda real, el
[gate de piloto en tienda](./docs/cronograma/gate-piloto-release.md) sigue abierto y la fiscalidad
opera con un driver simulado rotulado `SIMULACION`. Publicamos el código para que se lea y se
ejecute; **no lo despliegues sobre datos reales de un comercio.**

Aun así, la seguridad del código sí se toma en serio: la Fase 11 entregó administración de
identidad, autorización auditable, transporte con autenticación mutua, protección de datos en
reposo y redacción de logs, y una auditoría de cierre corrigió sus trece hallazgos con su prueba.
Un reporte de vulnerabilidad es bienvenido.

## Versiones soportadas

Solo la rama `main` y el último tag publicado. No hay ramas de mantenimiento ni backports.

| Versión | Soporte |
| --- | --- |
| `main` y último tag | ✅ |
| Cualquier versión anterior | ❌ |

## Cómo reportar

**No abras un issue público, una discusión ni una pull request para una vulnerabilidad.**

Usa el canal privado de GitHub: en la pestaña **Security** del repositorio,
**Report a vulnerability**. Crea un aviso privado visible solo para quien mantiene el proyecto y
para ti, y permite coordinar la corrección antes de que exista una descripción pública.

Si ese canal no está disponible para tu cuenta, abre un issue **sin detalles técnicos** —solo
«quiero reportar un problema de seguridad, necesito un canal privado»— y se te dará uno. Un issue
así nunca debe contener el detalle del problema.

## Qué incluir

- Qué componente afecta: `core`, un driver, el servidor Fastify, el escritorio Electron, el
  empaquetado o la sincronización LAN.
- Cómo reproducirlo, con el commit o el tag exacto.
- Qué garantía se rompe: autorización, ownership por nodo, integridad de la auditoría, protección
  del material en reposo, idempotencia, aislamiento del renderer.
- Impacto y precondiciones: qué necesita quien ataca (¿sesión válida?, ¿acceso a la LAN?,
  ¿Administrador local en la máquina?).

## Qué **no** incluir

Nunca pegues en un reporte —ni en un issue, ni en una captura— un PIN, contraseña, token de
sesión, cookie, clave, certificado privado, respaldo, contenido de `.data` ni datos de una persona
o un comercio real. Describe la clase de problema y cómo llegar a él; si hace falta material
sensible para reproducirlo, dilo en el aviso privado y se acuerda cómo entregarlo.

## Qué esperar

Es un proyecto de una sola persona, sin SLA: no hay compromiso de tiempo de respuesta ni programa
de recompensas. Lo que sí se compromete es el trato del reporte —acuse de recibo, evaluación,
corrección o rechazo explicado por escrito— y el crédito en las notas de la versión si quien
reporta lo desea.

## Límites ya declarados

Reportar algo que ya está documentado como decisión explícita no es un hallazgo nuevo, aunque
discutir la decisión sí es bienvenido:

- **El archivo SQLite operativo no se cifra en reposo.**
  [ADR-0029](./docs/architecture/adr/0029-proteccion-de-datos-en-reposo.md) D7.1: con un servicio
  desatendido, la clave viviría en la misma máquina que quien ya tiene Administrador local, así
  que cifrarlo compraría una promesa, no una protección. Lo que sí se protege: hashes de PIN,
  tokens, secretos y respaldos, más la ACL del directorio de datos verificada al arrancar.
- **El MSI se construye sin firmar.** No hay certificado de firma de código; por eso el release
  `v0.1.0` distribuye código fuente y no adjunta el instalador.
- **La fiscalidad es simulada.** `FiscalPrinterFake` no habla con hardware real y no pretende
  cumplimiento normativo.
