// Shared helpers for the gen-art CLI scripts (retrodiffusion.mjs, pixellab.mjs).
import fs from 'node:fs';
import path from 'node:path';

/** Minimal `--flag value` / `--bool-flag` argv parser. No deps, matches this repo's script style. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Put it in a local .env and \`export $(grep -v '^#' .env | xargs)\`, or export it directly — never commit it (see .gitignore).`);
    process.exit(1);
  }
  return v;
}

export function writeBase64Png(base64, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
  console.log('wrote', outPath);
}

export function readPngAsBase64(inPath) {
  return fs.readFileSync(inPath).toString('base64');
}
