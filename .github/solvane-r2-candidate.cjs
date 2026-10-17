// Offline, immutable source hydration. Never moves a branch or writes credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const out = path.resolve(process.env.R2_OUT || path.join(process.env.RUNNER_TEMP || '/tmp', 'solvane-r2'));
fs.mkdirSync(out, { recursive: true });
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const blob = b => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const json = (name, x) => fs.writeFileSync(path.join(out, name), JSON.stringify(x, null, 2) + '\n');
const partSHAs = ['4768182033b3f30d9c5e51628947108e15bca8f8','47df87f7fb03607bc5b3468258fb1702507812d8','92daca988366d6b84e52679b8ca5530e8f86a16f','9616a32988597dfeef6f0b9c342afa2412919b65','a6dac88f5ce8919bb6b2b172dbbe8d1143148206','a868d63968667681eb2368b2cc2270091520e7d2'];
const media = ['authoring/solvane/street-kit.blend','public/models/solvane/street-kit.glb','public/models/solvane/street-kit.bin','public/models/solvane/street-kit.manifest.json'];
function payload() {
  const pieces = partSHAs.map((sha, i) => {
    const p = fs.readFileSync(`.github/solvane-r2-transfer/part-${String(i + 1).padStart(2, '0')}.br`);
    if (blob(p) !== sha) throw Error('Transfer blob identity mismatch');
    return p;
  });
  const compressed = Buffer.concat(pieces);
  if (compressed.length !== 32484 || sha256(compressed) !== '6a37d41185d731975e2f5b770dfb6b06848d4f4f3bc0f15265831a3fe0fe5d96') throw Error('Compressed identity mismatch');
  const bytes = zlib.brotliDecompressSync(compressed, { maxOutputLength: 122292 });
  if (bytes.length !== 122292 || sha256(bytes) !== '1cd3d3acf004e3e44fd8ffb51fbb014e39ad4ae7f81065ab504626d50e040c46') throw Error('Source identity mismatch');
  const p = JSON.parse(bytes);
  if (p.schema !== 1 || Object.keys(p.baseBlobs).length !== 16) throw Error('Unexpected source schema');
  for (const f of Object.keys(p.baseBlobs)) {
    if (!/^(authoring\/solvane\/|src\/|tests\/|scripts\/solvane-r2-browser-review.mjs$|e2e\/fixtures\/horizon-session.ts$|docs\/production\/SOLVANE_R2_REFERENCE_LEDGER.md$)/.test(f) || f.includes('..') || !/^[\w./-]+$/.test(f)) throw Error(`Unsafe source path ${f}`);
  }
  return p;
}
function identity() {
  const hashes = {};
  for (const folder of ['src','public','e2e','scripts','authoring/solvane']) {
    function walk(p) { for (const d of fs.readdirSync(p, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const f = `${p}/${d.name}`;
      if (d.isDirectory()) walk(f);
      else if (d.isFile() && d.name !== 'supplied-player-lods.bin.gz') hashes[f] = sha256(fs.readFileSync(f));
    }}
    walk(folder);
  }
  json(process.env.R2_IDENTITY_NAME || 'source-identity.json', { checkoutCommit: git('rev-parse','HEAD'), workingTreeChanges: git('status','--porcelain'), sourceAndAssetSHA256: hashes, notHardwarePerformance: true });
}
if (process.argv[2] === 'apply') {
  const p = payload();
  if (git('status','--porcelain')) throw Error('Hydration requires a clean checkout');
  for (const [f, expected] of Object.entries(p.baseBlobs)) {
    if (expected === null ? fs.existsSync(f) : !fs.existsSync(f) || fs.lstatSync(f).isSymbolicLink() || blob(fs.readFileSync(f)) !== expected) throw Error(`Concurrent source change: ${f}`);
  }
  for (const f of media) if (fs.existsSync(f)) throw Error(`Native output already exists: ${f}`);
  const patch = path.join(out, 'source.patch');
  fs.writeFileSync(patch, p.patch);
  git('apply','--check','--index',patch);
  git('apply','--index',patch);
  const actual = git('diff','--cached','--name-only').split('\n').sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(p.baseBlobs).sort())) throw Error('Patch path-set mismatch');
  json('base.json', { checkoutCommit: git('rev-parse','HEAD'), sourceBaseCommit: p.baseCommit, baseBlobs: p.baseBlobs });
} else if (process.argv[2] === 'pack') {
  const p = payload();
  for (const [f, expected] of [[media[1], p.glbSHA256],[media[2],p.transportSHA256]]) if (sha256(fs.readFileSync(f)) !== expected) throw Error(`Non-reproducible native export: ${f}`);
  const m = JSON.parse(fs.readFileSync(media[3]));
  if (m.sha256 !== p.glbSHA256 || m.gzip.sha256 !== p.transportSHA256 || Object.keys(m.templates).length !== 6) throw Error('Native manifest mismatch');
  git('add','--',...media);
  const paths = [...Object.keys(p.baseBlobs), ...media].sort();
  if (JSON.stringify(git('diff','--cached','--name-only').split('\n').sort()) !== JSON.stringify(paths)) throw Error('Unexpected staged files');
  const files = paths.map(f => { const b = fs.readFileSync(f); return { path: f, baseBlob: p.baseBlobs[f] ?? null, sha256: sha256(b), blob: blob(b), bytes: b.length }; });
  execFileSync('tar', ['-czf',path.join(out,'candidate-files.tar.gz'),'--',...paths]);
  json('candidate-manifest.json', { schema:1, checkoutCommit:git('rev-parse','HEAD'), sourceBaseCommit:p.baseCommit, files, archiveSHA256:sha256(fs.readFileSync(path.join(out,'candidate-files.tar.gz'))), notReleaseApproval:true });
  identity();
} else if (process.argv[2] === 'identity') identity();
else throw Error('Expected apply, pack, or identity');
