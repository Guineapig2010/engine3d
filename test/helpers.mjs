import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadStlPositions(rel) {
  const buf = fs.readFileSync(path.join(root, rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const g = new STLLoader().parse(ab);
  return g.attributes.position.array;
}
