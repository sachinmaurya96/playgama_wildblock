import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function readPolicy() {
  const policy = JSON.parse(await readFile(path.join(root, 'playgama.release.json'), 'utf8'));
  if (policy.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(policy.gameSlug)) throw new Error('Invalid release policy/slug');
  // Owned output names are intentional. Never recursively delete configurable arbitrary paths.
  if (policy.distDir !== 'dist' || policy.releaseDir !== 'release') throw new Error('Only owned dist/ and release/ output directories are allowed');
  for (const dir of ['dist', 'release']) {
    try { if ((await lstat(path.join(root, dir))).isSymbolicLink() || await realpath(path.join(root, dir)) !== path.join(await realpath(root), dir)) throw new Error(`Unsafe output directory: ${dir}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (!Array.isArray(policy.targets) || policy.targets.length !== 1 || policy.targets[0] !== 'playgama') throw new Error('Only Playgama is audited. Review partner criteria before selecting additional targets.');
  if (JSON.stringify(policy.languages) !== '["en"]' || policy.orientation !== 'landscape') throw new Error('Policy must match the complete English/landscape game');
  if (![policy.maxUncompressedBytes, policy.zipTargetBytes].every((n) => Number.isSafeInteger(n) && n > 0) || policy.maxUncompressedBytes > 300000000) throw new Error('Invalid byte limits');
  if (typeof policy.enforceZipTarget !== 'boolean' || policy.safeFileNames !== true) throw new Error('Invalid release flags');
  return policy;
}
export function safeName(name) {
  return name.split('/').every((s) => s !== '.' && s !== '..' && /^[A-Za-z0-9._-]+$/.test(s)) && !name.startsWith('/') && !name.includes('\\');
}
export async function collectFiles(dir, relative = '') {
  const files = [];
  for (const name of (await readdir(path.join(dir, relative))).sort()) {
    const rel = relative ? `${relative}/${name}` : name;
    const stat = await lstat(path.join(dir, rel));
    if (stat.isSymbolicLink()) throw new Error(`Symlink in artifact: ${rel}`);
    if (stat.isDirectory()) files.push(...await collectFiles(dir, rel));
    else if (stat.isFile()) files.push({ name: rel, bytes: stat.size });
    else throw new Error(`Unsupported file: ${rel}`);
  }
  return files;
}
export async function validateArtifact(policy) {
  policy ??= await readPolicy();
  const dir = path.join(root, policy.distDir), files = await collectFiles(dir);
  const names = new Set(files.map((f) => f.name)), folded = new Set();
  const warnings = [];
  for (const f of files) {
    if (!safeName(f.name) || folded.has(f.name.toLowerCase())) throw new Error(`Unsafe/case-colliding filename: ${f.name}`);
    folded.add(f.name.toLowerCase());
    if (/(^|\/)(node_modules|src|tests|\.git|\.env[^/]*|\.DS_Store)(\/|$)|\.(map|pem|key|tsx|ts)$/.test(f.name)) throw new Error(`Private/source file in artifact: ${f.name}`);
  }
  for (const required of ['index.html', 'playgama-bridge-config.json', 'playgama-bridge.js', 'THIRD-PARTY-NOTICES.txt', 'licenses/playgama-bridge.txt']) if (!names.has(required)) throw new Error(`Missing ${required}`);
  const html = await readFile(path.join(dir, 'index.html'), 'utf8');
  const sdkTags = [...html.matchAll(/<script[^>]*src=["']([^"']*playgama-bridge\.js[^"']*)["']/g)];
  if (sdkTags.length !== 1 || sdkTags[0][1] !== './playgama-bridge.js') throw new Error('Expected exactly one local Bridge runtime script');
  if (/\/src\/|localhost|127\.0\.0\.1|@vite\/client|<base\s/i.test(html)) throw new Error('Development/root URL in production HTML');
  const rawConfig = await readFile(path.join(dir, 'playgama-bridge-config.json'));
  const config = JSON.parse(rawConfig);
  // Validate the exact supported project subset against the current official config docs.
  if (Object.keys(config).join() !== 'advertisement' || Object.keys(config.advertisement).sort().join() !== 'interstitial,minimumDelayBetweenInterstitial,rewarded' || config.advertisement.minimumDelayBetweenInterstitial !== 90) throw new Error('Unexpected SDK config shape');
  for (const [kind, expected] of [['interstitial', 'return_to_menu'], ['rewarded', 'starlight_scarf']]) {
    if (JSON.stringify(config.advertisement[kind]) !== JSON.stringify({ placements: [{ id: expected }] })) throw new Error(`Invalid ${kind} placements`);
  }
  function reference(from, ref) {
    if (/^(data:|blob:|https?:|#|\/\/)/i.test(ref)) return;
    if (ref.startsWith('/')) throw new Error(`Root asset URL in ${from}: ${ref}`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(ref.split(/[?#]/)[0])));
    if (!names.has(target)) throw new Error(`Missing/case-mismatched asset in ${from}: ${ref}`);
  }
  for (const ref of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) reference('index.html', ref[1]);
  const externalUrls = new Set();
  for (const f of files.filter((f) => /\.(js|css|html|json|webmanifest)$/.test(f.name))) {
    const data = await readFile(path.join(dir, f.name), 'utf8');
    if (f.name.endsWith('.css')) for (const ref of data.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) reference(f.name, ref[1]);
    if (f.name === 'manifest.webmanifest') { const manifest = JSON.parse(data); for (const icon of manifest.icons ?? []) reference(f.name, icon.src); }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|G-[A-Z0-9]{10}["']|googletagmanager\.com|google-analytics\.com|cdn\.segment\.com|api\.amplitude\.com/.test(data)) throw new Error(`Secret/third-party analytics marker in ${f.name}`);
    // The SDK contains platform adapters, browser diagnostics and documentation URLs.
    if (f.name !== 'playgama-bridge.js' && /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[\/"']|forceMock|__PLAYGAMA_TEST__/.test(data)) throw new Error(`Development/test marker in ${f.name}`);
    if (f.name !== 'playgama-bridge.js') for (const url of data.matchAll(/https?:\/\/[^\s"'`<>\\)]+/g)) externalUrls.add(url[0].slice(0, 180));
  }
  if (externalUrls.size) warnings.push('Bundle URL strings need human review; not every string is an outbound request. See the integration audit.');
  const uncompressedBytes = files.reduce((n, f) => n + f.bytes, 0);
  if (uncompressedBytes > policy.maxUncompressedBytes) throw new Error(`Uncompressed artifact exceeds ${policy.maxUncompressedBytes} bytes`);
  return { status: 'PASS', uncompressedBytes, fileCount: files.length, configHash: hash(rawConfig), files, largestFiles: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8), externalUrlStrings: [...externalUrls].sort(), warnings };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await validateArtifact(); console.log(JSON.stringify(result, null, 2)); }
  catch (e) { console.error(`FAIL: ${e.message}`); process.exitCode = 1; }
}
