# @supermarket/desktop

Aplicacion Electron con renderer React y preload seguro. El sistema se presenta
al usuario con el nombre comercial **Cullen**: la marca aparece en el titulo de
la ventana, en el acceso por PIN y en la barra lateral del shell.

## Comandos

- `pnpm --filter @supermarket/desktop dev`: inicia Electron con el renderer React en desarrollo.
- `pnpm --filter @supermarket/desktop build`: compila main, preload y renderer.
- `pnpm --filter @supermarket/desktop start`: abre el resultado compilado; requiere ejecutar `build` antes.
- `pnpm --filter @supermarket/desktop test`: ejecuta el smoke test del renderer sin hardware.

Durante desarrollo y preview, el servidor Fastify debe estar disponible en
`127.0.0.1:3000`; Vite reenvía `/api` al mismo origen para conservar la cookie
de sesión segura. El renderer recupera la sesión, muestra el acceso por PIN y
presenta el shell navegable con estados de carga y conexión.

## Ventana instalada

Fuera de desarrollo, la ventana **no** carga el paquete desde el disco: pide
`<nodo>/app/` al nodo local, que sirve la interfaz compilada. Interfaz y API
comparten así el mismo origen, que es lo que hace válidas las rutas relativas
`/api/v1/...` y la cookie de sesión `SameSite=Strict`. Cargada como `file://`,
ninguna llamada llegaba con credenciales.

Para probarlo sin instalador, con el paquete ya compilado:

```bash
pnpm --filter /desktop build
RENDERER_DIST_PATH=../desktop/out/renderer pnpm --filter /server dev
pnpm --filter /desktop start
```

`CULLEN_NODE_URL` cambia el nodo al que apunta la ventana; por defecto es
`http://127.0.0.1:3000`. Si el nodo no responde, la ventana muestra una página
propia con reintento en lugar del error del navegador.

El preload solo expone información diagnóstica mínima mediante
`contextBridge`. El negocio continúa transportándose por HTTP/Fastify; no se
agregan handlers IPC de negocio.
