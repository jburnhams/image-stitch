import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pngsuiteDir = path.join(__dirname, '..', 'pngsuite', 'png');
const dist = await import(path.join(__dirname, '..', 'dist', 'png-concat.js'));
const concat = dist.concat;

const imgs = [
  fs.readFileSync(path.join(pngsuiteDir, 'basn2c08.png')),
  fs.readFileSync(path.join(pngsuiteDir, 'basn0g08.png')),
  fs.readFileSync(path.join(pngsuiteDir, 'basn6a08.png')),
  fs.readFileSync(path.join(pngsuiteDir, 'basn4a08.png'))
];

(async () => {
  const result = await concat({ inputs: imgs, layout: { width: 100 } });
  fs.writeFileSync(path.join(__dirname, '..', 'debug-example5-output.png'), result);
  console.log('Wrote debug output to debug-example5-output.png, size:', result.length);
})();
