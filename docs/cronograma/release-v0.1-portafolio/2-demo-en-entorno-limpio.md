# V0.1.02: Demo en entorno limpio

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** ~~Cerrada~~ el 2026-09-10 sobre `fce95e6`, con el recorrido completo y sus siete
  capturas.
- **Entrada:** ~~V0.1.01 cerrada~~.
- **Guion:** [Guion de la demo en entorno limpio](./guion-demo-entorno-limpio.md).

## Objetivo

Demostrar que otra persona puede ejecutar Cullen desde un clon limpio en Windows y completar el
recorrido principal sin hardware fiscal.

## Tareas

- [x] Preparar una VM o estación Windows limpia sin reutilizar `.data`, dependencias globales ni
  secretos de desarrollo.
  *(Clon nuevo en carpeta nueva, con `.data` y administrador recién creados. **No** fue una VM ni
  un usuario nuevo, así que Node, pnpm, Git y la caché de Electron ya presentes en la máquina no
  se pusieron a prueba. Es la limitación que queda en pie.)*
- [x] Seguir únicamente el README: clonar, instalar con lockfile, preparar el perímetro de datos,
  provisionar el administrador y cargar configuración operativa y catálogo de ejemplo.
  *(Verificado salvo la provisión del administrador, que exige un TTY.)*
- [x] Arrancar servidor y desktop y comprobar ingreso, enrolamiento de credencial y recuperación
  de sesión.
- [x] Completar una jornada demostrable: abrir caja, vender, emitir documento simulado, consultar
  kardex/reportes y cerrar caja.
- [x] Reiniciar los procesos y verificar que la operación persiste y que las pantallas continúan
  identificando la fiscalidad como `SIMULACION`.
- [x] Registrar comandos, tiempos aproximados, incidencias y evidencia visual sin datos sensibles.

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

## El recorrido interactivo, el 2026-09-10

Lo que faltaba —ingreso, cambio de PIN, enrolamiento, jornada completa, reinicio y las capturas—
exigía una persona frente a la estación, y así se hizo. La provisión del administrador **está
diseñada** para no completarse sin un TTY, y una captura de la interfaz real no puede fabricarse
desde el árbol de trabajo sin dejar de ser evidencia.

| Paso | Resultado |
| --- | --- |
| `pnpm pipeline` sobre el clon | 1.282 pruebas en 198 archivos, verdes en 59 s |
| Ingreso, cambio de PIN y enrolamiento | completados; la sesión se recupera al reabrir la ventana |
| Proveedor y dos recepciones | 20 unidades de dos productos, con su motivo |
| Turno, venta, cobro y cierre | dos cafés y tres aguas: 12,00 + 1,92 de IVA = 13,92 |
| Documento fiscal | `INV-000001`, emitido y rotulado `SIMULACIÓN` |
| Kardex | entrada de 20 y salida de 2; saldo 18 |
| Reinicio de nodo y terminal | mismo saldo y mismos movimientos |

Cuatro hallazgos, todos corregidos antes de la corrida definitiva y verificados por ella: el
binario de Electron que `pnpm install` dejó de traer, la seed que no crea existencias, los
formularios de recepción escondidos bajo el kardex, y los motivos que el sistema escribía en
inglés dentro de una interfaz en español. Están en la tabla de incidencias del
[guion](./guion-demo-entorno-limpio.md#incidencias), con lo que se vio y qué se cambió.

## Evidencia

El [registro de la ejecución](./guion-demo-entorno-limpio.md#registro-de-la-ejecución) tiene el
commit, las versiones, la duración y el resultado del pipeline. Seis de las siete capturas se
publicaron en el [README](../../../README.md#el-recorrido-en-seis-pantallas); la séptima —el
kardex intacto después de reiniciar— es evidencia de esta etapa y no va al README, porque para un
lector sería casi idéntica a la sexta.
