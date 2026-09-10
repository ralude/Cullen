# Guion de la demo en entorno limpio

- **Etapa:** [V0.1.02 — Demo en entorno limpio](./2-demo-en-entorno-limpio.md).
- **Commit del guion:** el candidato a `v0.1.0`.
- **Qué prueba:** que otra persona ejecuta Cullen desde un clon limpio en Windows y completa el
  recorrido principal **sin hardware fiscal**.
- **Qué no prueba:** cumplimiento fiscal, compatibilidad con una impresora real ni aptitud para
  operar una tienda. Toda representación conserva `SIMULACION`.

El guion se sigue **solo con documentación pública**: este archivo y el
[README](../../../README.md). Si un paso obliga a leer código o a recordar una conversación, eso
es un hallazgo y se corrige en la documentación antes de continuar.

## Preparación de la estación

- [ ] Windows sin `.data`, sin dependencias globales del proyecto y sin secretos de desarrollo
      reutilizados. Una VM recién creada es lo más limpio.
- [ ] Node.js 24.x, pnpm 11.17.0, Git y `openssl` alcanzable en el `PATH`.
- [ ] Una terminal **interactiva**: el paso 2 pide el PIN sin eco y exige un TTY.

```powershell
node --version      # v24.x
pnpm --version      # 11.17.0
openssl version     # OpenSSL 3.x
```

## Recorrido

Siete pasos y siete capturas, que no se corresponden uno a uno: los tres primeros se
demuestran con la salida del terminal, que va al registro del final, y el paso 6 produce
cuatro imágenes.

Las capturas tienen **dos destinos distintos** y conviene no mezclarlos:

| | Qué prueba | Adónde va |
| --- | --- | --- |
| Capturas 1 a 6 | qué hace la aplicación | al README, en [V0.1.03](./3-documentacion-portafolio.md) |
| Captura 7 | que lo hecho **sobrevive** a un reinicio | evidencia de esta etapa; no va al README, porque para un lector sería casi idéntica a la 3 |

Cada paso anota el comando, lo que debe verse y qué se captura.

### 1. Clonar, instalar y verificar

```powershell
git clone https://github.com/ralude/Cullen.git cullen
cd cullen
pnpm install --frozen-lockfile
pnpm pipeline
```

- [ ] La instalación no modifica `pnpm-lock.yaml`.
- [ ] `pnpm pipeline` termina en verde. Las tres pruebas de `generate-lan-material.test.ts`
      **pasan**; si fallan, falta `openssl` en el `PATH` y no se continúa.
- [ ] Anotar duración aproximada y versión de Windows.

### 2. Perímetro de datos y administrador inicial

```powershell
pnpm --filter @supermarket/server prepare-development-storage
pnpm --filter @supermarket/server bootstrap-admin:dev
```

- [ ] El primer comando reporta `Protected:` para `db`, `backups` y `keys`.
- [ ] El segundo pide código, nombre y PIN de 6–12 dígitos, y responde
      `Administrador creado: <id>`.
- [ ] **El PIN no se escribe en este documento, ni en una captura, ni en el historial de la
      shell.** Usar un PIN de demostración desechable.

### 3. Configuración operativa y catálogo

```powershell
pnpm --filter @supermarket/server bootstrap-operations:dev -- `
  --database ./.data/db/node.sqlite --currency USD `
  --discount-max-basis-points 1500 --igtf-basis-points 300 `
  --igtf-payment-methods CARD --igtf-currencies USD

pnpm --filter @supermarket/server seed:products -- `
  --database ./.data/db/node.sqlite --currency USD --tax-rate-basis-points 1600
```

- [ ] «Configuración operativa lista» con caja, métodos de pago, descuento máximo e IGTF.
- [ ] «Seed listo: 5 productos, 3 categorías y 1 unidad de medida.»
- [ ] Ambos comandos se ejecutan con el servidor **detenido**; con el nodo activo fallan con
      `DATABASE_NODE_LOCKED`, que es la garantía de un solo proceso dueño haciendo su trabajo.

### 4. Arrancar el nodo y la terminal

En dos terminales separadas:

```powershell
pnpm --filter @supermarket/server dev        # nodo Fastify + SQLite
pnpm --filter @supermarket/desktop dev       # terminal Electron + React
```

- [ ] El nodo reporta `Server listening at http://127.0.0.1:3000`.
- [ ] La terminal descarga el binario de Electron —unos 100 MB— la primera vez que se ejecuta
      en la máquina. Tarda y no imprime progreso: no es un cuelgue. Los arranques siguientes
      lo encuentran en caché y no descargan nada.
- [ ] **Captura 1 — ingreso:** la pantalla de ingreso con el rótulo fiscal visible.

### 5. Ingreso, credencial y sesión

- [ ] Entrar con el código y el PIN del administrador.
- [ ] Recorrer el cambio de PIN obligatorio y el enrolamiento de credencial.
- [ ] Cerrar y reabrir la terminal: la sesión se recupera o se vuelve a pedir, sin estado
      ambiguo.
- [ ] **Captura 2 — inicio:** la pantalla principal con la barra lateral y el estado de conexión.

### 6. Una jornada demostrable

Sigue [la guía de operación diaria](../../operacion/operacion-diaria.md).

- [ ] Abrir caja con su monto inicial.
- [ ] Vender: agregar productos del catálogo de ejemplo, cobrar y completar.
- [ ] Emitir el documento **simulado** y verificar que la pantalla lo identifica como tal.
- [ ] Consultar kardex e informes de ventas e inventario.
- [ ] Cerrar caja con su arqueo.
- [ ] **Captura 3 — venta**, **Captura 4 — documento simulado**, **Captura 5 — inventario**,
      **Captura 6 — reportes.**

### 7. Persistencia tras reinicio

Es la afirmación más fuerte de todo el recorrido y la única que una imagen puede probar por
sí sola: lo que se vendió sigue ahí después de apagar y volver a encender.

- [ ] Detener nodo y terminal, y volver a arrancarlos.
- [ ] La venta, el turno cerrado y el movimiento de inventario siguen ahí.
- [ ] El rótulo fiscal sigue diciendo `SIMULACION` en todo el recorrido.
- [ ] **Captura 7 — después del reinicio:** la misma venta y el mismo saldo de inventario que
      mostraron las capturas 3 y 5, ya con los procesos reiniciados.

## Higiene de la evidencia

Ninguna captura ni anotación puede contener PIN, token de sesión, cookie, clave, certificado
privado, ruta de material protegido ni datos de una persona o un comercio real. Si una pantalla
los muestra, se recorta o se repite el paso con datos de demostración.

## Registro de la ejecución

| Dato | Valor |
| --- | --- |
| Commit probado | |
| Windows | |
| Node.js / pnpm / OpenSSL | |
| Duración aproximada | |
| Resultado de `pnpm pipeline` | |

### Incidencias

Una fila por paso que no salió como dice el guion, con lo que se vio y qué documentación se
corrigió.

| Paso | Qué ocurrió | Corrección |
| --- | --- | --- |
| 4 | `electron-vite dev` abortó con `Error: Electron uninstall`. El binario no estaba: Electron 44 dejó de declarar `postinstall` y publica su instalador como ejecutable aparte, así que `pnpm install` ya no lo trae. La máquina de desarrollo lo tenía de una versión anterior y enmascaraba el defecto. | `apps/desktop` invoca `install-electron` antes de `dev` y `start`. Queda fuera de `build`, que no necesita el binario —CI ya lo demuestra en verde sobre un runner limpio—, para no cargar al pipeline una descarga de 100 MB. El README lo explica en el paso 5. |
