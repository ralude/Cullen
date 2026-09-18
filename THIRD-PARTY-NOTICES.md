# Avisos de terceros

Cullen se publica bajo [Apache 2.0](./LICENSE). Este archivo reúne el material de terceros que el
repositorio redistribuye con su propia licencia: no forma parte del producto, no entra en el
instalador y ninguna de sus piezas participa del pipeline —los proyectos de vitest se declaran uno
por uno por paquete, la suite de arquitectura solo recoge `tests/**` y el lint deja fuera las skills
instaladas—. Se conserva aquí porque redistribuirlo obliga a conservar su aviso.

## `.agents/skills/security-audit/`

Skill de auditoría de seguridad de Cloudflare, instalada desde
[`cloudflare/security-audit-skill`](https://github.com/cloudflare/security-audit-skill).
[`skills-lock.json`](./skills-lock.json) fija su origen, la ruta de su punto de entrada y el hash de
la versión que está en el árbol, de modo que la copia es verificable contra upstream.

Licencia MIT, obtenida del repositorio de origen el 2026-09-17 y reproducida íntegra como exige su
propio texto:

```
MIT License

Copyright (c) 2025-2026 Cloudflare, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
