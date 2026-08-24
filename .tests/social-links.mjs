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

  /* Both links used to be two grey words on the bottom line of the footer,
     under a full page of links — present, and effectively unfindable. They are
     now in the header on every page and the footer pair are real buttons. */
  const h = await p.evaluate(() => {
    const links = [...document.querySelectorAll(".nav-social a")];
    const foot = [...document.querySelectorAll(".footer-social a")];
    const r = (a) => a.getBoundingClientRect();
    return {
      nav: links.length,
      navLabelled: links.every(a => a.getAttribute("aria-label")),
      navHrefs: links.map(a => a.getAttribute("href")),
      navTarget: Math.min(...links.map(a => Math.min(r(a).width, r(a).height))),
      footTarget: Math.min(...foot.map(a => r(a).height)),
      footNamed: foot.every(a => /instagram|facebook/i.test(a.textContent)),
      label: (document.querySelector(".footer-social-h") || {}).textContent || ""
    };
  });
  check(path.padEnd(32) + "the header carries both, on every page", h.nav === 2 && h.navLabelled, h.navHrefs.join("  "));
  check(path.padEnd(32) + "header icons are a real tap target", h.navTarget >= 40, Math.round(h.navTarget) + "px");
  check(path.padEnd(32) + "footer buttons clear the 44px floor", h.footTarget >= 44, Math.round(h.footTarget) + "px");
  check(path.padEnd(32) + "and are named, not icon-only", h.footNamed && /follow/i.test(h.label), h.label);

  if (OUT && path === "/index.html") {
    await p.screenshot({ path: `${OUT}/09-footer-social.png` });
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await p.locator("header").screenshot({ path: `${OUT}/09-header-social.png` }).catch(() => {});
  }
  await ctx.close();
}

/* On a phone the header is logo + follow + CTA + burger, which is too much, so
   the icons drop out below 700px. The footer buttons have to still be there —
   otherwise the links vanish entirely on the device most people use. */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(B + "/index.html", { waitUntil: "networkidle" });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(600);
  check("phone: the header icons step aside".padEnd(32) + " ", await p.locator(".nav-social a").first().isHidden());
  check("phone: the footer buttons remain".padEnd(32) + " ", await p.locator(".footer-social a").first().isVisible());
  check("phone: still a 44px target".padEnd(32) + " ",
    (await p.locator(".footer-social a").first().boundingBox()).height >= 44);
  check("phone: nothing spills sideways".padEnd(32) + " ",
    await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await ctx.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
