import { readFile, writeFile, mkdir, rm, rename, readdir, lstat, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { zipSync, unzipSync } from 'fflate';
import { root, readPolicy, validateArtifact, safeName, hash } from './validate-playgama.mjs';

const output = path.join(root, 'release');
const report = { status: 'FAIL', buildTime: new Date().toISOString(), checks: [], warnings: [], manualQA: 'MANUAL REQUIRED' };
let policy, stage;
async function command(label, args, executable = process.execPath) {
  const check = { name: label, status: 'NOT RUN' }; report.checks.push(check);
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { process.stdout.write(chunk); tail = (tail + chunk).slice(-6000); });
    child.on('error', (e) => { check.status = 'FAIL'; check.error = e.message; reject(e); });
    child.on('close', (code) => { check.status = code === 0 ? 'PASS' : 'FAIL'; if (code === 0) resolve(); else { check.error = tail; reject(new Error(`${label} failed (${code})`)); } });
  });
}
async function capture(executable, args) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }); let result = '';
    child.stdout.on('data', (chunk) => { result += chunk; });
    child.on('error', () => resolve(null)); child.on('close', (code) => resolve(code === 0 ? result.trim() : null));
  });
}
async function licenses() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const packages = new Set(), queue = Object.keys(pkg.dependencies);
  while (queue.length) {
    const name = queue.shift(); if (packages.has(name)) continue;
    packages.add(name);
    const p = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    queue.push(...Object.keys(p.dependencies ?? {}));
  }
  await mkdir(path.join(root, 'dist', 'licenses'), { recursive: true });
  const notices = ['WildBlocks dependency notices', '', 'Playgama Bridge is shipped unmodified as a separate, replaceable playgama-bridge.js.', 'Bridge source and releases: https://github.com/Playgama/bridge', 'License: LGPL-3.0-or-later. The LGPL applies to Bridge; no game source is packaged.', ''];
  for (const name of [...packages].sort()) {
    const location = path.join(root, 'node_modules', name);
    const p = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
    const candidates = (await readdir(location)).filter((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    if (!candidates.length && name !== '@react-three/fiber') throw new Error(`Missing dependency license: ${name}`);
    const text = name === '@react-three/fiber' ? await readFile(path.join(root, 'licenses/react-three-fiber.txt'), 'utf8') : (await Promise.all(candidates.map((f) => readFile(path.join(location, f), 'utf8')))).join('\n\n');
    const slug = name === '@playgama/bridge' ? 'playgama-bridge' : name.replace(/^@/, '').replace(/\//g, '-');
    await writeFile(path.join(root, 'dist', 'licenses', `${slug}.txt`), text);
    notices.push(`${name} ${p.version} — ${p.license ?? 'see license'} — licenses/${slug}.txt`);
  }
  await writeFile(path.join(root, 'dist', 'THIRD-PARTY-NOTICES.txt'), notices.join('\n') + '\n');
}
async function writeReports() {
  const md = [
    `# WildBlocks release — ${report.status}`, '',
    `Built: ${report.buildTime}. Targets: ${(report.targets ?? []).join(', ')}. SDK: ${report.sdkVersion ?? 'unknown'}.`, '',
    ...(report.artifact ? [`Upload: \`${report.artifact}\``, `ZIP: ${report.compressedBytes} bytes. Uncompressed: ${report.uncompressedBytes} bytes. Files: ${report.fileCount}.`, `SHA-256: \`${report.artifactHash}\``, ''] : ['No upload-ready artifact was generated.', '']),
    ...report.checks.map((c) => `- ${c.status}: ${c.name}`), '',
    ...report.checks.filter((c) => c.status === 'FAIL' && c.error).flatMap((c) => [`Failed check output (${c.name}):`, '', '```text', c.error.replace(/\u001b\[[0-9;]*m/g, ''), '```', '']),
    ...(report.error ? [`Failure: ${report.error}`, ''] : []),
    ...report.warnings.map((w) => `- Warning: ${w}`), '',
    `Initial menu transfer: ${report.initialLoadTransferBytes ?? 'NOT RUN'} bytes (local HTTP, identity encoding, cold cache; not a real mobile speed measurement).`, '',
    'MANUAL REQUIRED: Playgama QA Tool initialization/readiness, host ads and cloud saves, desktop/iOS/Android devices, content/asset rights and metadata. See docs/PLAYGAMA-SUBMISSION.md.',
    'NOT RUN: live ad fill/revenue, partner acceptance, real-device FPS, legacy browser/OS compatibility.',
    'NOT APPLICABLE: partner targets, banners, purchases, analytics.', '',
  ].join('\n');
  for (const [name, data] of [['release-report.json', JSON.stringify(report, null, 2) + '\n'], ['release-report.md', md]]) {
    const temp = path.join(output, `${name}.tmp`); await writeFile(temp, data); await rename(temp, path.join(output, name));
  }
}
try {
  policy = await readPolicy();
  await mkdir(output, { recursive: true });
  for (const name of await readdir(output)) if ((name.startsWith(`${policy.gameSlug}-`) && name.endsWith('-playgama.zip')) || /^release-report\.(json|md)$/.test(name)) await rm(path.join(output, name), { force: true });
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run through npm run release so the current npm CLI is available cross-platform.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || major === 20 && minor < 19) throw new Error('Node >=20.19 is required');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('Unsafe game version');
  Object.assign(report, { game: pkg.name, version: pkg.version, nodeVersion: process.version, npmVersion: await capture(process.execPath, [npmCli, '--version']), sdkVersion: JSON.parse(await readFile(path.join(root, 'node_modules/@playgama/bridge/package.json'), 'utf8')).version, targets: policy.targets, sourceVerificationDate: '2026-10-07', commit: await capture('git', ['rev-parse', 'HEAD']) });
  stage = path.join(output, '.staging'); await rm(stage, { recursive: true, force: true }); await mkdir(stage);
  await rm(path.join(root, 'dist'), { recursive: true, force: true });
  await command('TypeScript (project tsconfig)', [npmCli, 'run', 'typecheck']);
  await command('Gameplay and platform integration tests', [npmCli, 'test']);
  await command('Game data validation', [npmCli, 'run', 'validate:data']);
  await command('Production Vite build', [npmCli, 'run', 'build']);
  await licenses();
  const validated = await validateArtifact(policy);
  Object.assign(report, validated); report.status = 'FAIL';
  report.warnings.push('Existing development-only Vitest/mocker/tinypool audit advisories require a separately tested major tooling upgrade; these dependencies are excluded from the upload ZIP.');
  report.checks.push({ name: 'Static SDK/config/assets/sizes validation', status: 'PASS' });
  await command('Built nested-path and iframe browser tests', [npmCli, 'run', 'test:playgama']);
  const smoke = JSON.parse(await readFile(path.join(root, 'test-results', 'playgama-transfer.json'), 'utf8'));
  report.initialLoadTransferBytes = smoke.initialLoadTransferBytes;
  report.runtimeResources = smoke.runtimeResources;
  const entries = {};
  for (const f of validated.files) entries[f.name] = new Uint8Array(await readFile(path.join(root, 'dist', f.name)));
  const zip = zipSync(entries, { level: 9 });
  if (zip.byteLength > policy.zipTargetBytes) {
    if (policy.enforceZipTarget) throw new Error(`ZIP exceeds project budget of ${policy.zipTargetBytes} bytes`);
    report.warnings.push(`ZIP exceeds optional ${policy.zipTargetBytes}-byte target`);
  }
  const name = `${policy.gameSlug}-${pkg.version}-playgama.zip`, pending = path.join(stage, name);
  await writeFile(pending, zip);
  const finalBytes = await readFile(pending), extracted = unzipSync(finalBytes);
  const extraction = await mkdtemp(path.join(os.tmpdir(), 'wildblocks-release-'));
  try {
    if (Object.keys(extracted).length !== validated.files.length) throw new Error('ZIP entry count mismatch');
    const caseNames = new Set();
    for (const [file, bytes] of Object.entries(extracted)) {
      if (!safeName(file) || caseNames.has(file.toLowerCase()) || !entries[file] || hash(bytes) !== hash(entries[file])) throw new Error(`ZIP content/path mismatch: ${file}`);
      caseNames.add(file.toLowerCase());
      await mkdir(path.dirname(path.join(extraction, file)), { recursive: true }); await writeFile(path.join(extraction, file), bytes);
      if (hash(await readFile(path.join(extraction, file))) !== hash(entries[file])) throw new Error(`Extracted file mismatch: ${file}`);
    }
  } finally { await rm(extraction, { recursive: true, force: true }); }
  report.checks.push({ name: 'ZIP readback, safe entries and extracted file hashes', status: 'PASS' });
  Object.assign(report, { artifact: `release/${name}`, artifactHash: hash(finalBytes), compressedBytes: finalBytes.byteLength, status: 'PASS' });
  await rename(pending, path.join(output, name));
  await writeReports();
  console.log(`\nUpload ${report.artifact} (${report.compressedBytes} ZIP bytes; ${report.uncompressedBytes} uncompressed bytes). Manual host QA remains.`);
} catch (e) {
  if (report.artifact && policy) await rm(path.join(root, report.artifact), { force: true }).catch(() => {});
  delete report.artifact; delete report.artifactHash;
  report.status = 'FAIL'; report.error = e.stack ?? String(e);
  console.error(`\nRELEASE FAILED: ${e.message}\nDetails: release/release-report.md and release/release-report.json`);
  // Even an unsafe policy cannot redirect this failure report elsewhere.
  try {
    let safe = true;
    try { safe = !(await lstat(output)).isSymbolicLink(); } catch (err) { if (err.code !== 'ENOENT') safe = false; }
    if (safe) { await mkdir(output, { recursive: true }); await writeReports(); }
  } catch { /* retain the original failure */ }
  process.exitCode = 1;
} finally { if (stage) await rm(stage, { recursive: true, force: true }); }
