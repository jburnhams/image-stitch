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
const pakoEntry = path.join(projectRoot, 'node_modules', 'pako', 'dist', 'pako.esm.mjs');
const pakoMinEntry = path.join(projectRoot, 'node_modules', 'pako', 'dist', 'pako_deflate.min.js');

fs.mkdirSync(bundlesDir, { recursive: true });
fs.mkdirSync(browserDir, { recursive: true });

function renameCjsArtifacts() {
  if (!fs.existsSync(cjsDir)) {
    return;
  }

  function processDirectory(dir) {
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);

      // Skip if file doesn't exist (may have been deleted as a .map file)
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Recursively process subdirectories
        processDirectory(fullPath);
        continue;
      }

      // Skip .map files - they're handled together with their .js files
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

const modules = new Map();

function parseExportList(list) {
  return list
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const parts = segment.split(/\s+as\s+/i);
      if (parts.length === 2) {
        return { local: parts[0].trim(), exported: parts[1].trim() };
      }
      return { local: segment.trim(), exported: segment.trim() };
    });
}

function createFallback(spec, clause) {
  const assignments = [];
  const names = clause
    .replace(/[{}]/g, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (spec === 'node:stream') {
    for (const name of names) {
      assignments.push(`const ${name} = typeof globalThis !== 'undefined' && globalThis.${name} ? globalThis.${name} : class { constructor() { throw new Error('${name} is not available in this environment'); } };`);
    }
  } else if (spec === 'node:fs' || spec === 'node:fs/promises') {
    for (const name of names) {
      if (name === 'readFileSync') {
        assignments.push(`const readFileSync = () => { throw new Error('File system access is not available in this environment'); };`);
      } else if (name === 'open') {
        assignments.push(`const open = async () => { throw new Error('File system access is not available in this environment'); };`);
      } else if (name === 'FileHandle') {
        assignments.push(`class FileHandle { async close() { /* no-op */ } }`);
      } else {
        assignments.push(`const ${name} = () => { throw new Error('${name} is not available in this environment'); };`);
      }
    }
  }

  if (assignments.length === 0) {
    return null;
  }

  return assignments.join('\n');
}

function resolveSpecifier(fromPath, spec) {
  if (spec.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fromPath), spec);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    const withJs = `${resolved}.js`;
    if (fs.existsSync(withJs)) {
      return withJs;
    }
    throw new Error(`Unable to resolve ${spec} from ${fromPath}`);
  }
  if (spec === 'pako') {
    return pakoEntry;
  }
  return null;
}

function parseModule(modulePath) {
  const absolute = path.resolve(modulePath);
  if (modules.has(absolute)) {
    return modules.get(absolute);
  }

  let code = fs.readFileSync(absolute, 'utf8');

  if (absolute === pakoEntry) {
    const minSource = fs.readFileSync(pakoMinEntry, 'utf8');
    code = [
      '// Wrapped pako deflate build for browser bundle',
      'const module = { exports: {} };',
      'const exports = module.exports;',
      '(function (module, exports) {',
      minSource,
      '})(module, exports);',
      'const pako = module.exports;',
      'const { Deflate, constants, deflate, deflateRaw, gzip } = pako;',
      'const defaultExport = pako;',
      'export { Deflate, constants, deflate, deflateRaw, gzip };',
      'export { defaultExport as default };'
    ].join('\n');
  }
  const imports = new Set();
  const localExports = [];
  const exportFrom = [];
  const exportAll = [];
  const fallbackSnippets = [];

  const importRegex = /^import\s+(.+?)\s+from\s+['\"](.+?)['\"];?\s*$/gm;
  code = code.replace(importRegex, (match, clause, spec) => {
    const resolved = resolveSpecifier(absolute, spec);
    if (resolved) {
      imports.add(resolved);
    } else {
      const fallback = createFallback(spec, clause);
      if (fallback) {
        fallbackSnippets.push(fallback);
      }
    }
    return '';
  });

  const exportFromRegex = /^export\s+{([^}]+)}\s+from\s+['\"](.+?)['\"];?\s*$/gm;
  code = code.replace(exportFromRegex, (match, names, spec) => {
    const resolved = resolveSpecifier(absolute, spec);
    if (resolved) {
      imports.add(resolved);
      exportFrom.push({ module: resolved, names: parseExportList(names) });
    }
    return '';
  });

  const exportAllRegex = /^export\s+\*\s+from\s+['\"](.+?)['\"];?\s*$/gm;
  code = code.replace(exportAllRegex, (match, spec) => {
    const resolved = resolveSpecifier(absolute, spec);
    if (resolved) {
      imports.add(resolved);
      exportAll.push(resolved);
    }
    return '';
  });

  const declarationExportRegex = /^export\s+(async\s+)?(const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/gm;
  code = code.replace(declarationExportRegex, (match, asyncKeyword, kind, name) => {
    localExports.push({ local: name, exported: name });
    const prefix = asyncKeyword ? `${asyncKeyword}${kind}` : kind;
    return `${prefix} ${name}`;
  });

  const listExportRegex = /^export\s*{([^}]+)};?\s*$/gm;
  code = code.replace(listExportRegex, (match, list) => {
    localExports.push(...parseExportList(list));
    return '';
  });

  code = code.replace(/\/\/# sourceMappingURL=.*$/gm, '');
  if (fallbackSnippets.length) {
    code = `${fallbackSnippets.join('\n')}\n${code}`;
  }
  code = code.trimEnd() + '\n';

  const info = {
    path: absolute,
    code,
    imports: Array.from(imports),
    localExports,
    exportFrom,
    exportAll
  };

  modules.set(absolute, info);
  return info;
}

function collectModules(entryPath) {
  const order = [];
  const visited = new Set();
  function visit(modulePath) {
    const info = parseModule(modulePath);
    if (visited.has(info.path)) {
      return;
    }
    visited.add(info.path);
    for (const dep of info.imports) {
      visit(dep);
    }
    order.push(info);
  }
  visit(entryPath);
  return order;
}

function formatRelative(modulePath) {
  return path.relative(projectRoot, modulePath).replace(/\\/g, '/');
}

function generateIdentityMap(code, fileName, sourceLabel = fileName, sourceContent = code) {
  const lines = code.split('\n');
  const mappings = lines.map(() => 'AAAA').join(';');
  return JSON.stringify({
    version: 3,
    file: fileName,
    sources: [sourceLabel],
    sourcesContent: [sourceContent],
    names: [],
    mappings
  });
}

function buildBundles() {
  const entryPath = path.join(esmDir, 'index.js');
  const order = collectModules(entryPath);
  if (order.length === 0) {
    throw new Error('No modules found. Did the ESM build succeed?');
  }

  const entryInfo = order[order.length - 1];
  const exportMap = new Map();
  const exportNameMap = new Map();

  function addExport(modulePath, local, exported) {
    const resolvedPath = path.resolve(modulePath);
    let resolvedLocal = local;

    const targetModule = modules.get(resolvedPath);
    if (targetModule) {
      const alias = targetModule.localExports.find((pair) => pair.exported === local);
      if (alias) {
        resolvedLocal = alias.local;
      }
    }

    if (!exportMap.has(resolvedPath)) {
      exportMap.set(resolvedPath, new Map());
    }
    const moduleExports = exportMap.get(resolvedPath);
    moduleExports.set(exported, resolvedLocal);
    exportNameMap.set(exported, resolvedLocal);
  }

  for (const record of entryInfo.exportFrom) {
    for (const pair of record.names) {
      addExport(record.module, pair.local, pair.exported);
    }
  }

  for (const spec of entryInfo.exportAll) {
    const target = modules.get(path.resolve(spec));
    if (!target) {
      continue;
    }
    for (const pair of target.localExports) {
      if (pair.exported !== 'default') {
        addExport(target.path, pair.local, pair.exported);
      }
    }
  }

  const chunks = [];
  for (let i = 0; i < order.length - 1; i++) {
    const info = order[i];
    const banner = `// ===== ${formatRelative(info.path)} =====`;
    chunks.push(`${banner}\n${info.code}`);
  }

  const exportStatements = [];
  for (const [modulePath, names] of exportMap.entries()) {
    const parts = [];
    for (const [exported, local] of names.entries()) {
      parts.push(local === exported ? local : `${local} as ${exported}`);
    }
    if (parts.length > 0) {
      exportStatements.push(`export { ${parts.join(', ')} };`);
    }
  }

  const header = `/**
 * image-stitch bundle
 * Generated on ${new Date().toISOString()}
 */\n`;
  const esmBundle = `${header}${chunks.join('\n')}\n${exportStatements.join('\n')}\n`;
  const esmPath = path.join(bundlesDir, 'image-stitch.esm.js');
  fs.writeFileSync(esmPath, `${esmBundle}\n//# sourceMappingURL=image-stitch.esm.js.map\n`);
  fs.writeFileSync(`${esmPath}.map`, generateIdentityMap(esmBundle, 'image-stitch.esm.js'));

  const iifeBody = `${chunks.join('\n')}\n`;
  const assignments = [];
  for (const [exported, local] of exportNameMap.entries()) {
    assignments.push(`${JSON.stringify(exported)}: ${local}`);
  }
  const globalInit = `const api = {\n  ${assignments.join(',\n  ')}\n};\n`;
  const assignment = `global.ImageStitch = api;\n  if (typeof globalThis !== 'undefined') {\n    globalThis.ImageStitch = api;\n  }\n  if (global.window) {\n    global.window.ImageStitch = api;\n  }\n  if (typeof window !== 'undefined') {\n    window.ImageStitch = api;\n  }`;
  const targetGlobal = "typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this)";
  const iifeSource = `${header}(function (global) {\n  'use strict';\n${indent(iifeBody)}\n${indent(globalInit)}${indent(assignment)}\n})(${targetGlobal});\n`;
  const iifePath = path.join(browserDir, 'image-stitch.js');
  fs.writeFileSync(iifePath, `${iifeSource}\n//# sourceMappingURL=image-stitch.js.map\n`);
  fs.writeFileSync(`${iifePath}.map`, generateIdentityMap(iifeSource, 'image-stitch.js'));

  const minSource = minify(iifeSource);
  const minPath = path.join(browserDir, 'image-stitch.min.js');
  fs.writeFileSync(minPath, `${minSource}\n//# sourceMappingURL=image-stitch.min.js.map\n`);
  fs.writeFileSync(`${minPath}.map`, generateIdentityMap(minSource, 'image-stitch.min.js', 'image-stitch.js', iifeSource));
}

function indent(code, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

function minify(code) {
  const lines = code.split('\n');
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('//#')) {
      continue;
    }
    if (trimmed.startsWith('//') && !trimmed.startsWith('//!')) {
      continue;
    }
    result.push(trimmed);
  }
  return result.join('\n');
}

renameCjsArtifacts();
buildBundles();

console.log('ESM and browser bundles generated.');
