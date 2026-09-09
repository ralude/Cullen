# V0.1.01: CI reproducible

- **Release:** [v0.1 de portafolio](./README.md).
- **Estado:** Pendiente.
- **Entrada:** V0.1.00 cerrada.

## Objetivo

Hacer que un runner remoto reproduzca la validación del repositorio sin depender de la máquina
del autor ni de equipos fiscales.

## Tareas

- [ ] Crear un workflow de GitHub Actions para `windows-latest`, plataforma objetivo del desktop.
- [ ] Fijar Node.js 24 y pnpm 11, usar `pnpm install --frozen-lockfile` y conservar el store solo
  como caché, nunca como fuente de dependencias no declaradas.
- [ ] Instalar o localizar OpenSSL en el runner y demostrar que
  `generate-lan-material.test.ts` ejecuta sus tres pruebas; no omitirlas por entorno.
- [ ] Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build:artifacts` en cada pull
  request y cambio de `main`.
- [ ] Publicar el resultado y los logs del workflow como checks de GitHub. No fijar un umbral de
  coverage arbitrario sin medir primero la línea base.
- [ ] Documentar localmente las versiones necesarias para reproducir el mismo pipeline.

## Criterio de salida

Un commit nuevo no puede presentarse como candidato `v0.1.0` si cualquiera de los cuatro checks
falla. Las pruebas de material LAN pasan con OpenSSL de software; no requieren impresoras ni una
red física.

## Fuera de alcance

Construir el MSI con WiX, firmarlo o publicarlo. Esas tareas pertenecen a distribución binaria y
al gate de piloto; el release inicial publica el código fuente.
