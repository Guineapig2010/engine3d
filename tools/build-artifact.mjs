// Builds a single self-contained HTML file (all JS/CSS inlined, example STLs
// embedded as base64) — handy for hosting as one page. Run after `vite build`:
//   npm run build && node tools/build-artifact.mjs [out.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const jsFile = /<script type="module" crossorigin src="\.\/([^"]+)"/.exec(html)[1];
const cssFile = /<link rel="stylesheet" crossorigin href="\.\/([^"]+)"/.exec(html)[1];
const js = fs.readFileSync(path.join(dist, jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(dist, cssFile), 'utf8');
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[^>]*><\/script>/g, '').trim();
const stl = {};
for (const f of fs.readdirSync(path.join(root, 'public/examples'))) {
  if (f.endsWith('.stl')) stl['examples/' + f] = fs.readFileSync(path.join(root, 'public/examples', f)).toString('base64');
}
const out = `<title>Rocket Flight Lab</title>
<meta name="description" content="Load any STL model rocket, fit real A–F motors and launch it from a detailed pad and controller.">
<style>
${css}
</style>
${body}
<script>window.__EXAMPLE_STL = ${JSON.stringify(stl)};</script>
<script type="module">
${js}
</script>
`;
const target = process.argv[2] || path.join(dist, 'rocket-flight-lab.html');
fs.writeFileSync(target, out);
console.log(`Wrote ${target} (${(out.length / 1e6).toFixed(2)} MB)`);
