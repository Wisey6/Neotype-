import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

for (const path of ["/index.html", "/customizer.html", "/banners.html", "/corflute.html", "/success.html", "/custom-stickers-brisbane.html"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(B + path, { waitUntil: "networkidle" });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(700);
  const m = await p.evaluate(() => {
    const links = [...document.querySelectorAll(".footer-social a")];
    return {
      n: links.length,
      hrefs: links.map(a => a.getAttribute("href")),
      rels: links.map(a => a.getAttribute("rel")),
      visible: links.every(a => a.getBoundingClientRect().height > 0),
      labels: links.map(a => a.getAttribute("aria-label")),
    };
  });
  check(path.padEnd(32) + "two visible social links", m.n === 2 && m.visible, m.hrefs.join("  "));
  check(path.padEnd(32) + 'rel includes "me"', m.rels.every(r => /\bme\b/.test(r)) && m.rels.every(r => /noopener/.test(r)));
  check(path.padEnd(32) + "each has an aria-label", m.labels.every(Boolean));
  if (OUT && path === "/index.html") await p.screenshot({ path: `${OUT}/09-footer-social.png` });
  await ctx.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
