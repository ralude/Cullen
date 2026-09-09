# V0.1.02: Demo en entorno limpio

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** En curso. El tramo reproducible automáticamente quedó verificado el 2026-09-09; el
  recorrido interactivo y sus capturas siguen pendientes.
- **Entrada:** ~~V0.1.01 cerrada~~ (entregada; su casilla del primer run remoto sigue abierta).
- **Guion:** [Guion de la demo en entorno limpio](./guion-demo-entorno-limpio.md).

## Objetivo

Demostrar que otra persona puede ejecutar Cullen desde un clon limpio en Windows y completar el
recorrido principal sin hardware fiscal.

## Tareas

- [ ] Preparar una VM o estación Windows limpia sin reutilizar `.data`, dependencias globales ni
  secretos de desarrollo.
- [x] Seguir únicamente el README: clonar, instalar con lockfile, preparar el perímetro de datos,
  provisionar el administrador y cargar configuración operativa y catálogo de ejemplo.
  *(Verificado salvo la provisión del administrador, que exige un TTY.)*
- [ ] Arrancar servidor y desktop y comprobar ingreso, enrolamiento de credencial y recuperación
  de sesión.
- [ ] Completar una jornada demostrable: abrir caja, vender, emitir documento simulado, consultar
  kardex/reportes y cerrar caja.
- [ ] Reiniciar los procesos y verificar que la operación persiste y que las pantallas continúan
  identificando la fiscalidad como `SIMULACION`.
- [x] Registrar comandos, tiempos aproximados, incidencias y evidencia visual sin datos sensibles.
  *(El guion fija los comandos y el registro; las capturas dependen del recorrido interactivo.)*

## Criterio de salida

El golden path se completa siguiendo documentación pública, sin conocimiento del historial del
chat, sin modificar el código y sin conectar impresoras fiscales. Cualquier paso implícito se
corrige en la documentación antes de continuar.

## Lo verificado el 2026-09-09

Sobre un clon limpio del commit candidato, en un directorio nuevo, sin reutilizar `.data` ni
material de desarrollo del árbol original:

| Paso del README | Resultado |
| --- | --- |
| `git clone` + `pnpm install --frozen-lockfile` | instala 360 paquetes sin tocar el lockfile |
| `pnpm lint` | verde |
| `pnpm typecheck` | verde en los diez proyectos |
| `pnpm test` | 1.212 pruebas en 191 archivos, verdes |
| `pnpm build:artifacts` | servidor y escritorio compilan |
| `prepare-development-storage` | crea y restringe `db`, `backups` y `keys` |
| `bootstrap-operations:dev` | caja, métodos de pago, descuento máximo e IGTF activados |
| `seed:products` | 5 productos, 3 categorías, 1 unidad |
| `pnpm --filter @supermarket/server dev` | escucha en `http://127.0.0.1:3000` |
| API sin sesión | responde `401` con `AUTHENTICATION_FAILED`, sin stack trace |

## Hallazgos y correcciones aplicadas

Los tres son pasos implícitos que el README daba por sabidos; los tres quedaron corregidos antes
de continuar, como exige el criterio de salida.

1. **`openssl` no figuraba entre los requisitos.** `pnpm pipeline` falla las tres pruebas de
   `generate-lan-material.test.ts` si el intérprete no lo alcanza, y el README solo pedía Node y
   pnpm. Es exactamente el fallo que el cronograma había atribuido a «el host no tiene OpenSSL».
   Ahora el README lo declara, con su ubicación habitual en Windows.
2. **`bootstrap-admin:dev` exige un TTY.** El script rechaza una shell no interactiva con
   «PIN provisioning requires an interactive local terminal», por decisión deliberada: el PIN no
   debe llegar por una tubería ni quedar en el historial. El README decía «pide … en el terminal»
   sin declarar el requisito; ahora sí.
3. **La instalación reproducible es `pnpm install --frozen-lockfile`.** El README abría con
   `pnpm install`, que puede resolver dependencias fuera del lockfile. El quickstart usa la forma
   congelada, igual que el pipeline de CI.

## Lo que falta y por qué no lo cubre esta sesión

El resto del recorrido —ingreso, cambio de PIN, enrolamiento, jornada completa, reinicio y las
seis capturas— exige una persona frente a una estación Windows limpia. No es una limitación de
herramientas que convenga sortear: la provisión del administrador **está diseñada** para no
completarse sin un TTY, y una captura de la interfaz real no puede fabricarse desde el árbol de
trabajo sin dejar de ser evidencia.

El [guion](./guion-demo-entorno-limpio.md) deja ese recorrido como una lista de comandos y
verificaciones con su registro de incidencias, para que la ejecución sea comprobable y no
improvisada.

## Evidencia requerida

Commit probado, versión de Windows/Node/pnpm, salida del pipeline, guion ejecutado y capturas del
inicio de sesión, venta, documento simulado, inventario y reportes.
