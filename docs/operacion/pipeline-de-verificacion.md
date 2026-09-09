# Pipeline de verificación

Este documento fija **con qué versiones** se reproduce la validación del repositorio, en local y
en el runner remoto, para que el resultado de un commit no dependa de la máquina del autor.

- **Workflow:** [`.github/workflows/pipeline.yml`](../../.github/workflows/pipeline.yml).
- **Origen normativo:** [V0.1.01 — CI reproducible](../cronograma/release-v0.1-portafolio/1-ci-reproducible.md).
- **Regla de validación:** [`AGENTS.md`](../../AGENTS.md), sección «Validación global».

## Versiones requeridas

| Herramienta | Versión | Dónde se fija |
| --- | --- | --- |
| Node.js | 24.18.0 | `NODE_VERSION` del workflow |
| pnpm | 11.17.0 | `packageManager` de `package.json` y `PNPM_VERSION` del workflow |
| Sistema operativo | Windows | `windows-latest` en el workflow; Windows es la plataforma objetivo del nodo y del escritorio |
| OpenSSL | 3.x alcanzable en el `PATH` | paso «Asegurar OpenSSL en el PATH» |

Una versión mayor distinta de Node o pnpm puede producir un árbol de dependencias diferente al del
lockfile. Si hace falta subirlas, se cambian en el workflow y en este documento en el mismo hito.

## Por qué OpenSSL

[`generate-lan-material.ts`](../../apps/server/src/generate-lan-material.ts) envuelve el `openssl`
del sistema en lugar de sumar una dependencia de criptografía: Node no emite certificados X.509 y
`AGENTS.md` prohíbe agregar dependencias sin necesidad concreta. Si `openssl` no está alcanzable,
la herramienta falla con `OPENSSL_NOT_AVAILABLE` y las tres pruebas de
`generate-lan-material.test.ts` no completan la emisión TLS.

Eso **no** es una prueba a omitir por entorno: el workflow localiza `openssl` —el de Git for
Windows si no está ya en el `PATH`—, imprime su versión y falla la ejecución si no aparece.
Después ejecuta ese archivo en un paso propio, para que el log muestre las tres pruebas como
evidencia explícita antes de la suite completa.

En Windows local, el `openssl` de Git for Windows vive en
`C:\Program Files\Git\usr\bin\openssl.exe`. Si el intérprete que lanza `pnpm test` no lo tiene en
su `PATH`, esas tres pruebas fallan aunque el sistema sí tenga OpenSSL instalado.

```powershell
# Comprobación previa a ejecutar la suite
openssl version
```

## Etapas del pipeline

El workflow corre en cada `pull_request` contra `main`, en cada `push` a `main` y a demanda con
`workflow_dispatch`. Sus etapas son las mismas que se ejecutan en local:

```bash
pnpm install --frozen-lockfile   # instalación determinista; el store solo es caché
pnpm lint
pnpm typecheck
pnpm test
pnpm build:artifacts
```

`pnpm pipeline` agrupa lint, typecheck y pruebas para el ciclo local; el runner las ejecuta por
separado para que cada una aparezca como su propio paso en el log.

## Caché del store

El store de pnpm se cachea por el hash de `pnpm-lock.yaml`. Es **caché, no fuente**: la
instalación usa `--frozen-lockfile`, de modo que un store restaurado nunca puede introducir una
dependencia que el lockfile no declare. Un fallo de caché solo cuesta tiempo de descarga.

## Coverage

El pipeline no fija un umbral de coverage. Poner un número antes de medir la línea base convierte
el umbral en una cifra arbitraria que se ajusta al resultado en vez de gobernarlo. Medir esa línea
base y decidir el umbral pertenece al [gate de piloto en tienda](../cronograma/gate-piloto-release.md),
que ya lo enumera entre sus tareas.

## Fuera de alcance

Construir el MSI de WiX, firmarlo o publicarlo. El release `v0.1.0` distribuye código fuente;
[`packaging/`](../../packaging/README.md) y el gate de piloto conservan esa responsabilidad.
