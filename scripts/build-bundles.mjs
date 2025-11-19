import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const esmDir = path.join(distDir, 'esm');
const cjsDir = path.join(distDir, 'cjs');
const bundlesDir = path.join(distDir, 'bundles');
const browserDir = path.join(distDir, 'browser');

fs.mkdirSync(bundlesDir, { recursive: true });
fs.mkdirSync(browserDir, { recursive: true });

// Rename CJS artifacts from .js to .cjs
function renameCjsArtifacts() {
  if (!fs.existsSync(cjsDir)) {
    return;
  }

  function processDirectory(dir) {
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);

      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        processDirectory(fullPath);
        continue;
      }

      if (file.endsWith('.map')) {
        continue;
      }

      if (!file.endsWith('.js')) {
        continue;
      }

      const base = file.slice(0, -3);
      const srcPath = fullPath;
      const destPath = path.join(dir, `${base}.cjs`);
      fs.renameSync(srcPath, destPath);

      const mapPath = `${srcPath}.map`;
      if (fs.existsSync(mapPath)) {
        const destMap = path.join(dir, `${base}.cjs.map`);
        const raw = fs.readFileSync(mapPath, 'utf8');
        const json = JSON.parse(raw);
        json.file = `${base}.cjs`;
        fs.writeFileSync(destMap, JSON.stringify(json));
        fs.unlinkSync(mapPath);
      }

      let content = fs.readFileSync(destPath, 'utf8');
      content = content.replace(/require\((['"]\.\.?(?:\/[^'"\\]+)*)\.js(['"])\)/g, 'require($1.cjs$2)');
      content = content.replace(/import\((['"]\.\.?(?:\/[^'"\\]+)*)\.js(['"])\)/g, 'import($1.cjs$2)');
      content = content.replace(/\/\/# sourceMappingURL=.*$/gm, `//# sourceMappingURL=${base}.cjs.map`);
      if (!content.endsWith('\n')) {
        content += '\n';
      }
      fs.writeFileSync(destPath, content);
    }
  }

  processDirectory(cjsDir);
}

// Copy JPEG encoder WASM files
function copyJpegWasmArtifacts() {
  const jpegEncoderWasm = path.join(projectRoot, 'node_modules', 'jpeg-encoder-wasm', 'pkg', 'esm', 'jpeg_encoder_bg.wasm');

  if (!fs.existsSync(jpegEncoderWasm)) {
    console.warn('JPEG encoder WASM missing; skipping copy step.');
    return;
  }

  const targets = [
    path.join(bundlesDir, 'jpeg_encoder_bg.wasm'),
    path.join(browserDir, 'jpeg_encoder_bg.wasm')
  ];

  for (const target of targets) {
    fs.copyFileSync(jpegEncoderWasm, target);
  }
}

// Plugin to handle Node.js built-ins and deep imports
const optionalDependencyStubPlugin = {
  name: 'optional-dependency-browser-stubs',
  setup(build) {
    const optionalDeps = ['pako', 'jpeg-js', 'sharp'];
    const filter = new RegExp(`^(?:${optionalDeps.map((dep) => dep.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})(?:/.*)?$`);

    build.onResolve({ filter }, (args) => ({
      path: args.path,
      namespace: 'optional-dep-browser-stub'
    }));

    build.onLoad({ filter: /.*/, namespace: 'optional-dep-browser-stub' }, (args) => {
      const depName = args.path.split('/')[0];
      const message = `${depName} is not bundled in the browser build. Use the Node.js build or include a custom polyfill if needed.`;

      let contents = '';
      if (depName === 'pako') {
        contents = `const message = ${JSON.stringify(message)};
export class Deflate {
  constructor() {
    throw new Error(message);
  }
  push() {
    throw new Error(message);
  }
}
export default { Deflate };
`;
      } else if (depName === 'jpeg-js') {
        contents = `const message = ${JSON.stringify(message)};
export function decode() {
  throw new Error(message);
}
export default { decode };
`;
      } else {
        contents = `const message = ${JSON.stringify(message)};
export default function optionalDependencyStub() {
  throw new Error(message);
}
`;
      }

      return {
        contents,
        loader: 'js'
      };
    });
  }
};

const nodeBuiltinsPlugin = {
  name: 'node-builtins-handler',
  setup(build) {
    // For dynamic imports of node built-ins, keep them external so they work at runtime in Node.js
    build.onResolve({ filter: /^node:(fs|path|fs\/promises)$/ }, args => {
      if (args.kind === 'dynamic-import') {
        return { path: args.path, external: true };
      }
      // For static imports, provide a shim
      return {
        path: args.path,
        namespace: 'node-builtin-shim'
      };
    });

    build.onLoad({ filter: /.*/, namespace: 'node-builtin-shim' }, () => ({
      contents: `
        export const open = async () => { throw new Error('File system access is not available in the browser'); };
        export const readFileSync = () => { throw new Error('File system access is not available in the browser'); };
        export class FileHandle { async close() { /* no-op */ } }
      `,
      loader: 'js'
    }));

    // Allow deep import for jpeg-encoder-wasm (resolve to actual file)
    build.onResolve({ filter: /^jpeg-encoder-wasm\/pkg\/esm\/jpeg_encoder\.js$/ }, args => ({
      path: path.join(projectRoot, 'node_modules', 'jpeg-encoder-wasm', 'pkg', 'esm', 'jpeg_encoder.js'),
      external: false
    }));
  }
};

// Build bundles using esbuild
async function buildBundles() {
  const entryPath = path.join(esmDir, 'bundle.js');

  if (!fs.existsSync(entryPath)) {
    throw new Error('Entry point not found. Did the ESM build succeed?');
  }

  const commonConfig = {
    bundle: true,
    sourcemap: true,
    platform: 'browser',
    target: 'es2020',
    plugins: [optionalDependencyStubPlugin, nodeBuiltinsPlugin]
  };

  // ESM bundle
  await esbuild.build({
    ...commonConfig,
    entryPoints: [entryPath],
    format: 'esm',
    outfile: path.join(bundlesDir, 'image-stitch.esm.js'),
    banner: {
      js: `/**
 * image-stitch ESM bundle
 * Generated on ${new Date().toISOString()}
 */`
    }
  });

  // IIFE bundle for browser
  await esbuild.build({
    ...commonConfig,
    entryPoints: [entryPath],
    format: 'iife',
    globalName: 'ImageStitch',
    outfile: path.join(browserDir, 'image-stitch.js'),
    banner: {
      js: `/**
 * image-stitch browser bundle
 * Generated on ${new Date().toISOString()}
 */`
    },
    footer: {
      js: `
if (typeof window !== 'undefined') { window.ImageStitch = ImageStitch; }
if (typeof globalThis !== 'undefined') { globalThis.ImageStitch = ImageStitch; }
if (typeof global !== 'undefined') { global.ImageStitch = ImageStitch; }
`
    }
  });

  // Minified IIFE bundle
  await esbuild.build({
    ...commonConfig,
    entryPoints: [entryPath],
    format: 'iife',
    globalName: 'ImageStitch',
    outfile: path.join(browserDir, 'image-stitch.min.js'),
    minify: true,
    banner: {
      js: `/* image-stitch v${getVersion()} | Generated ${new Date().toISOString()} */`
    },
    footer: {
      js: `if(typeof window!=='undefined'){window.ImageStitch=ImageStitch;}if(typeof globalThis!=='undefined'){globalThis.ImageStitch=ImageStitch;}if(typeof global!=='undefined'){global.ImageStitch=ImageStitch;}`
    }
  });

  copyJpegWasmArtifacts();
}

function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Main execution
renameCjsArtifacts();
await buildBundles();

console.log('ESM and browser bundles generated with esbuild.');
