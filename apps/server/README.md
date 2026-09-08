# @supermarket/server

Aplicacion Fastify para el nodo standalone o LAN.

## Comandos

- `pnpm --filter @supermarket/server dev`: inicia el servidor con watch.
- `pnpm --filter @supermarket/server start`: inicia el servidor en `127.0.0.1:3000`.
- `pnpm --filter @supermarket/server test`: ejecuta las pruebas del servidor.
- `pnpm --filter @supermarket/server typecheck`: verifica TypeScript.
- `pnpm seed:products -- --database <ruta> --currency <ABC>
  --tax-rate-basis-points <entero>`: aplica migraciones y genera el catálogo
  básico de ejemplo en una base local explícita.

El seed agrega tres categorías, una unidad y cinco productos con IDs y barcodes
estables. Es repetible y transaccional. La moneda y la tasa se indican al
ejecutarlo porque el proyecto no presupone valores fiscales ni regulatorios.

Ejemplo para una base de demostración; sustituye la moneda y la tasa por las
que decidas probar:

```bash
pnpm seed:products -- --database ./supermarket-demo.sqlite --currency USD --tax-rate-basis-points 0
```

El servidor expone salud y contratos autenticados bajo `/api/v1`. La
composición de negocio reside en el proceso Fastify y el renderer no abre la
base de datos.

El comando `dev` carga una identidad de nodo local y no secreta desde
`config/node-identity.development.json`. El comando `start` conserva la
identidad provisionada en `%ProgramData%\SupermarketPlatform\node-identity.json`
o en la ruta indicada mediante `NODE_IDENTITY_PATH`.

## Acceso inicial y usuarios de prueba

Una base local nueva no contiene usuarios ni credenciales predeterminadas. Por
eso la pantalla de inicio no permite entrar hasta provisionar el primer
administrador. En desarrollo, desde `apps/server`, ejecuta:

```bash
npm run bootstrap-admin:dev
```

El comando solicita de forma interactiva el código del operador, el nombre
visible y un PIN numérico de 6–12 dígitos. Usa la misma base
`supermarket-node.sqlite` y la misma identidad local que `npm run dev`.

Para un nodo instalado se usa `npm run bootstrap-admin`; ese comando exige la
identidad provisionada en `%ProgramData%` o mediante `NODE_IDENTITY_PATH`.

Las pruebas automatizadas crean temporalmente el fixture `OP001`, con nombre
visible `Operador` y PIN `123456`, dentro de bases SQLite en memoria. Ese
usuario se destruye al terminar cada prueba, no se inserta en
`supermarket-node.sqlite` y no constituye una credencial de desarrollo o
producción.

## Configuración operativa mínima

Autenticarse no basta para operar caja ni venta: el nodo necesita una caja del
terminal actual, métodos de pago y las políticas de descuento e IGTF. Sin ellas,
abrir un turno falla con `CASH_REGISTER_NOT_FOUND` y cobrar falla con
`POLICY_NOT_CONFIGURED`. Desde `apps/server`:

```bash
npm run bootstrap-operations:dev -- --database ./supermarket-node.sqlite \
  --currency USD --discount-max-basis-points 1500 \
  --igtf-basis-points 300 --igtf-payment-methods CARD --igtf-currencies USD
```

Desde la aplicación, `POST /api/v1/config/cash-registers` (pantalla Configuración, permiso
`config.cash_register.manage`) registra cajas adicionales para la terminal que las declara; este
comando sigue siendo la vía para dejar el nodo operativo antes del primer ingreso.

El comando crea una caja (`--cash-register-id`, `--cash-register-name`) cuyo
terminal y nodo se toman de la misma identidad que usa el servidor, los métodos
de pago `CASH` y `CARD` en la moneda indicada, y activa una versión de cada
política. Es repetible: si la política activa ya tiene esa configuración no crea
una versión nueva, y si cambia desactiva la anterior y añade la siguiente sin
borrar historia.

Ningún valor fiscal o comercial tiene default: la tasa de IGTF, el tope de
descuento y la moneda se indican al ejecutarlo. Una tasa de IGTF mayor que cero
exige `--igtf-payment-methods` y `--igtf-currencies`, porque sin ambas listas
nunca se aplicaría. Para un nodo instalado se usa `npm run bootstrap-operations`
con la identidad de `%ProgramData%` o `NODE_IDENTITY_PATH`.

Detén el servidor antes de ejecutar este comando o el seed: SQLite admite un
solo proceso dueño por nodo y, con el servidor activo, fallan con
`DATABASE_NODE_LOCKED`.

`SERVER_HOST` y `SERVER_PORT` permiten cambiar el bind y el puerto para desarrollo. El valor por defecto es loopback (`127.0.0.1`) para el modo standalone.

## Interfaz servida por el nodo

`RENDERER_DIST_PATH` publica el paquete compilado del renderer en `/app`. Es lo
que usa la terminal instalada: la ventana de Electron pide `<nodo>/app/` en vez
de abrir el paquete desde el disco, de modo que interfaz y API comparten origen
y la cookie de sesión `SameSite=Strict` viaja en cada llamada. Sin esa variable
el nodo arranca igual y `/app` no existe, que es el caso de desarrollo: ahí el
renderer lo sirve `electron-vite` y reenvía `/api` a este nodo.
