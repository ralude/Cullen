/**
 * Genera el PDF del manual de usuario a partir de sus archivos Markdown.
 *
 * El Markdown es la fuente: se revisa en un pull request como cualquier otro
 * cambio. El PDF es el entregable, porque quien opera una caja no lee un
 * repositorio. Este script los mantiene sincronizados.
 *
 * No agrega dependencias: convierte el Markdown con un lector propio del
 * subconjunto que el manual usa, e imprime con el Electron que el proyecto ya
 * instala para la terminal de escritorio.
 *
 * Uso:  <electron> scripts/build-manual-pdf.mjs
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'docs', 'operacion', 'manual-usuario');
const OUTPUT = join(SOURCE, 'manual-de-uso-cullen.pdf');

/** El orden del PDF. El índice del manual no gobierna la impresión. */
const CHAPTERS = [
  { file: 'README.md', id: 'portada-indice', skipTitle: true },
  { file: '01-primeros-pasos.md', id: 'cap-01' },
  { file: '02-caja.md', id: 'cap-02' },
  { file: '03-inventario.md', id: 'cap-03' },
  { file: '04-administracion.md', id: 'cap-04' },
  { file: '05-supervision-y-gerencia.md', id: 'cap-05' },
  { file: '06-cuando-algo-falla.md', id: 'cap-06' },
  { file: 'glosario.md', id: 'glosario' },
  { file: 'anexo-tecnico.md', id: 'anexo' }
];

const ANCHORS = new Map(CHAPTERS.map(({ file, id }) => [file, id]));

const escapeHtml = (text) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Identificador de un título, sin acentos, igual que el ancla que lo apunta. */
const slug = (text) => text.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

/**
 * Un enlace a otro archivo del manual se vuelve un salto dentro del PDF. Uno
 * que apunta fuera —al cronograma, a un runbook— pierde el enlace y conserva
 * el texto: en papel no lleva a ninguna parte y subrayarlo engaña.
 */
const resolveLink = (href) => {
  const [file, fragment] = href.split('#');
  const name = file.replace('./', '');
  if (ANCHORS.has(name)) return '#' + ANCHORS.get(name);
  /**
   * El ancla se recalcula con la misma regla con la que se generó el `id` del
   * título. Copiar el fragmento tal cual rompe todo enlace con acento, que en
   * un manual en español son casi todos.
   */
  if (file === '' && fragment !== undefined) return '#' + slug(fragment.replace(/-/g, ' '));
  return null;
};

/**
 * Una captura se incrusta en el PDF: el archivo tiene que poder enviarse o
 * imprimirse sin arrastrar una carpeta de imágenes al lado. El texto
 * alternativo viaja en el `alt` y se conserva íntegro en el Markdown fuente.
 */
const embedImage = (alt, source) => {
  const file = join(SOURCE, source.replace('./', ''));
  if (!existsSync(file)) throw new Error('Falta la captura: ' + source);
  const data = readFileSync(file).toString('base64');
  return `<figure class="captura"><img alt="${alt}" src="data:image/png;base64,${data}"></figure>`;
};

const inline = (text) => {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
    const target = resolveLink(href);
    return target === null ? label : `<a href="${target}">${label}</a>`;
  });
  return html;
};

/**
 * Quita los bloques dirigidos a quien navega el repositorio. Dentro del PDF,
 * decirle al lector dónde está el PDF y cómo regenerarlo es ruido: ese lector
 * ya lo tiene abierto y no va a correr un comando.
 */
const stripRepositoryOnly = (markdown) =>
  markdown.replace(/<!-- solo-repositorio -->[\s\S]*?<!-- \/solo-repositorio -->\r?\n?/g, '');

/** Lector del subconjunto de Markdown que el manual usa. */
const renderMarkdown = (markdown, { skipTitle }) => {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let index = 0;
  let firstHeadingSeen = false;

  const flushTable = () => {
    const rows = [];
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      rows.push(lines[index].trim());
      index += 1;
    }
    if (rows.length < 2) return;
    const cells = (row) => row.slice(1, -1).split('|').map((cell) => cell.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    out.push('<table><thead><tr>');
    for (const cell of head) out.push(`<th>${inline(cell)}</th>`);
    out.push('</tr></thead><tbody>');
    for (const row of body) {
      out.push('<tr>');
      for (const cell of row) out.push(`<td>${inline(cell)}</td>`);
      out.push('</tr>');
    }
    out.push('</tbody></table>');
  };

  const flushList = (ordered) => {
    const marker = ordered ? /^(\s*)\d+\.\s+(.*)$/ : /^(\s*)[-*]\s+(.*)$/;
    out.push(ordered ? '<ol>' : '<ul>');
    while (index < lines.length) {
      const match = marker.exec(lines[index]);
      if (!match) break;
      let text = match[2];
      index += 1;
      while (index < lines.length && /^\s{2,}\S/.test(lines[index])
        && !marker.test(lines[index])) {
        text += ' ' + lines[index].trim();
        index += 1;
      }
      out.push(`<li>${inline(text)}</li>`);
    }
    out.push(ordered ? '</ol>' : '</ul>');
  };

  const flushQuote = () => {
    const inner = [];
    while (index < lines.length && lines[index].startsWith('>')) {
      inner.push(lines[index].replace(/^>\s?/, ''));
      index += 1;
    }
    const body = renderMarkdown(inner.join('\n'), { skipTitle: false });
    const isPlaceholder = inner.join(' ').includes('Captura pendiente');
    out.push(`<blockquote class="${isPlaceholder ? 'placeholder' : 'callout'}">${body}</blockquote>`);
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '') { index += 1; continue; }
    if (trimmed === '---') { index += 1; continue; }

    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (image) { out.push(embedImage(image[1], image[2])); index += 1; continue; }

    if (trimmed.startsWith('|')) { flushTable(); continue; }
    if (trimmed.startsWith('>')) { flushQuote(); continue; }
    if (/^\s*[-*]\s+/.test(line)) { flushList(false); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { flushList(true); continue; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      index += 1;
      if (level === 1 && !firstHeadingSeen) {
        firstHeadingSeen = true;
        if (skipTitle) continue;
      }
      out.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== ''
      && !/^\s*([-*]|\d+\.)\s+/.test(lines[index])
      && !lines[index].trim().startsWith('|')
      && !lines[index].trim().startsWith('>')
      && !/^#{1,4}\s/.test(lines[index].trim())
      && lines[index].trim() !== '---') {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return out.join('\n');
};

const STYLE = `
  @page { size: A4; }
  :root { --ink: #1b1b1b; --soft: #5b5b5b; --rule: #d8d4cc; --accent: #7a1f1f; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: var(--ink); font-size: 10.5pt; line-height: 1.55; margin: 0;
  }
  h1, h2, h3, h4 { font-family: 'Segoe UI', Calibri, sans-serif; line-height: 1.25; }
  h1 {
    font-size: 21pt; margin: 0 0 4mm; padding-bottom: 3mm;
    border-bottom: 2px solid var(--accent);
  }
  /**
   * El salto de página lo decide el capítulo, no cada título. Un capítulo como
   * «Caja» abre con tres pantallas —Caja, Venta, Catálogo— y romper antes de
   * cada una dejaba la presentación sola en una página casi vacía.
   */
  section.chapter h1:not(:first-child) { margin-top: 12mm; }
  h2 { font-size: 14pt; margin: 8mm 0 2mm; color: var(--accent); }
  h3 { font-size: 11.5pt; margin: 6mm 0 1.5mm; }
  h4 { font-size: 10.5pt; margin: 4mm 0 1mm; color: var(--soft); }
  h1, h2, h3, h4 { break-after: avoid; }
  p { margin: 0 0 2.6mm; orphans: 2; widows: 2; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1.2mm; }
  a { color: var(--accent); text-decoration: none; }
  code {
    font-family: Consolas, 'Courier New', monospace; font-size: 9pt;
    background: #f2efe9; padding: 0.3mm 1mm; border-radius: 1mm;
  }
  table {
    width: 100%; border-collapse: collapse; margin: 0 0 4mm;
    font-size: 9.5pt; break-inside: avoid;
  }
  th, td {
    border: 0.3mm solid var(--rule); padding: 1.6mm 2.2mm;
    text-align: left; vertical-align: top;
  }
  th { background: #f4f1eb; font-family: 'Segoe UI', Calibri, sans-serif; font-size: 9pt; }
  blockquote { margin: 0 0 4mm; break-inside: avoid; }
  blockquote.callout {
    border-left: 1.2mm solid var(--accent); background: #faf7f2;
    padding: 2.5mm 4mm; }
  blockquote.callout p:last-child, blockquote.placeholder p:last-child { margin-bottom: 0; }
  figure.captura { margin: 0 0 4mm; break-inside: avoid; }
  figure.captura img {
    width: 100%; height: auto; display: block;
    border: 0.3mm solid var(--rule); border-radius: 1mm;
  }
  blockquote.placeholder {
    border: 0.4mm dashed #b9b2a6; background: #fbfaf7; color: var(--soft);
    padding: 3mm 4mm; font-size: 9.5pt; font-style: italic;
  }
  .cover {
    height: 247mm; display: flex; flex-direction: column; justify-content: center;
    text-align: center; break-after: page;
  }
  .cover .mark { font-family: 'Segoe UI', Calibri, sans-serif; font-size: 40pt; letter-spacing: 1mm; }
  .cover .subject { font-size: 15pt; margin-top: 3mm; color: var(--soft); }
  .cover .rule { width: 40mm; height: 1mm; background: var(--accent); margin: 8mm auto; }
  .cover .note { font-size: 10pt; color: var(--soft); max-width: 120mm; margin: 0 auto; }
  .cover .stamp {
    margin-top: 12mm; font-family: 'Segoe UI', Calibri, sans-serif; font-size: 9pt;
    letter-spacing: 0.6mm; color: var(--accent); border: 0.4mm solid var(--accent);
    padding: 2mm 4mm; display: inline-block; align-self: center;
  }
  .cover .date { margin-top: 14mm; font-size: 9pt; color: var(--soft); }
  section.chapter { break-before: page; }
  section.chapter:first-of-type { break-before: auto; }
`;

const buildHtml = () => {
  const parts = [];
  for (const chapter of CHAPTERS) {
    const path = join(SOURCE, chapter.file);
    if (!existsSync(path)) throw new Error('Falta el archivo del manual: ' + chapter.file);
    const markdown = stripRepositoryOnly(readFileSync(path, 'utf8'));
    const body = renderMarkdown(markdown, { skipTitle: chapter.skipTitle === true });
    parts.push(`<section class="chapter" id="${chapter.id}">${body}</section>`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const cover = `
    <div class="cover">
      <div class="mark">Cullen</div>
      <div class="subject">Manual de uso</div>
      <div class="rule"></div>
      <p class="note">
        Cómo usar la aplicación en el día a día de la tienda: atender una caja,
        recibir mercancía y administrar el comercio.
      </p>
      <div class="stamp">MODO SIMULACIÓN · SIN VALIDEZ FISCAL</div>
      <p class="date">Generado el ${today}</p>
    </div>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Cullen · Manual de uso</title><style>${STYLE}</style></head>
    <body>${cover}${parts.join('\n')}</body></html>`;
};

const footer = `
  <div style="width:100%;font-size:7.5pt;font-family:'Segoe UI',Calibri,sans-serif;
    color:#777;padding:0 14mm;display:flex;justify-content:space-between;">
    <span>Cullen · Manual de uso · SIMULACIÓN</span>
    <span class="pageNumber"></span>
  </div>`;

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const html = buildHtml();
  const htmlPath = join(app.getPath('temp'), 'cullen-manual.html');
  writeFileSync(htmlPath, html, 'utf8');

  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  await window.loadFile(htmlPath);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const pdf = await window.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { top: 0.75, bottom: 0.75, left: 0.85, right: 0.85 },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: footer
  });

  writeFileSync(OUTPUT, pdf);
  process.stdout.write('PDF generado: ' + OUTPUT + ' (' + Math.round(pdf.length / 1024) + ' KB)\n');
  app.quit();
}).catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  app.exit(1);
});
