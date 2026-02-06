import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ---------------- PATH SETUP ---------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = path.join(__dirname, "src");
const BUILD = path.join(__dirname, "build");

const PAGES = path.join(SRC, "pages");
const TEMPLATE = path.join(SRC, "templates", "page.html");
const LAYOUT = path.join(SRC, "layout");
const SEO = path.join(SRC, "seo");
const ASSETS = path.join(SRC, "assets");

/* ---------------- UTILS ---------------- */
const read = p => fs.readFileSync(p, "utf8");
const readJSON = p => JSON.parse(read(p));

function cleanDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
}

function minifyHTML(html) {
  const placeholders = [];
  let index = 0;

  // Protect blocks that must not be touched
  html = html.replace(
    /<(script|style|pre|code)([\s\S]*?)<\/\1>/gi,
    match => {
      const key = `___BLOCK_${index}___`;
      placeholders.push(match);
      index++;
      return key;
    }
  );

  // Remove HTML comments (safe)
  html = html.replace(/<!--(?!\[if|\s*\/?ko)[\s\S]*?-->/g, "");

  // Collapse whitespace
  html = html
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

  // Restore protected blocks
  placeholders.forEach((block, i) => {
    html = html.replace(`___BLOCK_${i}___`, block);
  });

  return html;
}

function buildPdfViewer(pageName, totalPages = 20) {
  let out = `<div class="pdf-viewer">\n`;

  for (let i = 1; i <= totalPages; i++) {
    const index = String(i).padStart(2, "0"); // 01, 02, ...
    out += `  <div class="page">
    <img src="https://materials.pinnacleblooms.org/Assets/${pageName}-${index}.jpg"
         loading="lazy"
         alt="Page ${i}">
  </div>\n`;
  }

  out += `</div>\n`;
  return out;
}

function injectBeforeLastBlock(html, injection) {
  const marker = 'class="react-renderer node-card block block-card last-block"';

  const lastIndex = html.lastIndexOf(marker);
  if (lastIndex === -1) {
    console.warn("⚠️ last-block not found, PDF viewer not injected");
    return html;
  }

  return (
    html.slice(0, lastIndex) +
    injection +
    "\n" +
    html.slice(lastIndex)
  );
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  for (const file of fs.readdirSync(src)) {
    const s = path.join(src, file);
    const d = path.join(dest, file);
    fs.statSync(s).isDirectory()
      ? copyDir(s, d)
      : fs.copyFileSync(s, d);
  }
}

/* ---------------- SEO BUILDER (INDEX.JSON ONLY) ---------------- */
function buildSEO(page = "index") {
  let out = "";

  const pageSchemaPath = path.join(SEO, "pages", `${page}.json`);

  if (!fs.existsSync(pageSchemaPath)) {
    console.error(`❌ SEO ERROR: ${page}.json not found, falling back to index.json`);
    return buildSEO("index"); // graceful fallback
  }

  console.log(`✅ SEO loaded from ${page}.json`);

  const pageData = readJSON(pageSchemaPath);

  /* ---------------- TITLE & DESCRIPTION ---------------- */
  if (pageData.pageInfo?.title) {
    out += `<title>${pageData.pageInfo.title}</title>\n`;
    console.log("📝 Title injected");
  }

  if (pageData.pageInfo?.description) {
    out += `<meta name="description" content="${pageData.pageInfo.description}">\n`;
    console.log("📝 Meta description injected");
  }

  /* ---------------- META TAGS ---------------- */
  pageData.meta?.dublinCore?.forEach(m => {
    out += `<meta name="${m.name}" content="${m.content}">\n`;
  });

  pageData.meta?.openGraph?.forEach(m => {
    out += `<meta property="${m.property}" content="${m.content}">\n`;
  });

  if (pageData.meta) {
    console.log("🏷️ Meta tags injected (Dublin Core + OpenGraph)");
  }

  /* ---------------- CRITICAL CSS ---------------- */
  if (pageData.components?.criticalCSS) {
    out += `<style>${pageData.components.criticalCSS}</style>\n`;
    console.log("🎨 Critical CSS injected");
  }

  /* ---------------- PRELOAD LINKS ---------------- */
  if (pageData.components?.preload?.length) {
    pageData.components.preload.forEach(link => {
      out += `<link ${Object.entries(link)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")}>\n`;
    });
    console.log(`🚀 Preload links injected (${pageData.components.preload.length})`);
  }

  /* ---------------- GLOBAL JSON-LD ---------------- */
  const globalDir = path.join(SEO, "global");
  if (fs.existsSync(globalDir)) {
    for (const file of fs.readdirSync(globalDir)) {
      if (!file.endsWith(".json")) continue;
      const schema = readJSON(path.join(globalDir, file));
      out += `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>\n`;
      console.log(`🌍 Global JSON-LD injected → ${file}`);
    }
  }

  /* ---------------- PAGE JSON-LD (GRAPH) ---------------- */
  if (pageData.jsonLd) {
    out += `<script type="application/ld+json">\n`;
    out += JSON.stringify(pageData.jsonLd, null, 2);
    out += `\n</script>\n`;
    console.log("📊 Page JSON-LD injected (@graph)");
  }

  /* ---------------- TRACKING / DATALAYER ---------------- */
  if (pageData.tracking) {
    out += `<script>\n`;
    out += `window.dataLayer = window.dataLayer || [];\n`;
    out += `window.dataLayer.push(${JSON.stringify(pageData.tracking, null, 2)});\n`;
    out += `</script>\n`;
    console.log("📈 Tracking / dataLayer injected");
  }

  return out;
}

/* ---------------- BUILD START ---------------- */
console.log("🚀 Build started");

cleanDir(BUILD);

/* COPY ASSETS */
copyDir(ASSETS, path.join(BUILD, "assets"));
console.log("✔ Assets copied");

/* LOAD TEMPLATE PARTS */
const template = read(TEMPLATE);
const header = read(path.join(LAYOUT, "header.html"));
// const footer = read(path.join(LAYOUT, "footer.html"));
const footerDesktop = read(path.join(LAYOUT, "footer.html"));
const footerMobile  = read(path.join(LAYOUT, "footer.mobile.html"));

/* BUILD PAGES */
for (const file of fs.readdirSync(PAGES)) {
  if (!file.endsWith(".html")) continue;

  console.log(`\n🔨 Building page → ${file}`);

  const content = read(path.join(PAGES, file));
   const pageName = file.replace(".desktop.html", "").replace(".mobile.html", "");

   const footer = file.endsWith(".mobile.html")
    ? footerMobile
    : footerDesktop;
  //  const pdfViewer = buildPdfViewer(pageName);
  //  const contentWithPdf = injectBeforeLastBlock(content, pdfViewer);

  const finalHtml = template
    .replace("{{SEO}}", buildSEO(pageName))
    .replace("{{HEADER}}", header)
    .replace("{{CONTENT}}", content)
    .replace("{{FOOTER}}", footer);

  //fs.writeFileSync(path.join(BUILD, file), finalHtml);
  const minifiedHtml = minifyHTML(finalHtml);
fs.writeFileSync(path.join(BUILD, file), minifiedHtml);
  console.log(`✔ Built ${file}`);
}

console.log("\n✅ Build complete");
