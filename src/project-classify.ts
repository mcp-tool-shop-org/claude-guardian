/**
 * Project type classifier.
 * Detects whether a directory is a web project (needs preview) or not,
 * using marker files and heuristics. Zero external dependencies.
 */

import { readFile, stat } from 'fs/promises';
import { join } from 'path';

export type ProjectKind =
  | 'web-node'
  | 'web-python'
  | 'web-static'
  | 'desktop'
  | 'cli'
  | 'unknown';

export interface ProjectClassification {
  kind: ProjectKind;
  /** True for web-* kinds — preview is relevant. */
  isWeb: boolean;
  /** Detected dev command (e.g., "npm run dev"). */
  devCommand?: string;
  /** Detected dev server port. */
  devPort?: number;
  confidence: 'high' | 'medium' | 'low';
  /** Which marker files were found. */
  markers: string[];
}

/** Check if a file exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Read a file as UTF-8, or return null on error. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/** Extract a port number from a script string (e.g., "--port 4321", "-p 3000"). */
export function extractPort(script: string): number | undefined {
  // Match --port N, -p N, :N (common in dev server args)
  const patterns = [
    /--port\s+(\d+)/,
    /-p\s+(\d+)/,
    /--port=(\d+)/,
    /-p=(\d+)/,
    /PORT=(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (match) {
      const port = parseInt(match[1], 10);
      if (port > 0 && port < 65536) return port;
    }
  }
  return undefined;
}

/** Web framework indicators in Node package.json scripts. */
const WEB_FRAMEWORKS = [
  'astro', 'vite', 'next', 'nuxt', 'webpack', 'parcel',
  'gatsby', 'remix', 'svelte', 'angular', 'vue',
  'webpack-dev-server', 'react-scripts',
];

/** Desktop framework indicators. */
const DESKTOP_MARKERS = [
  'tauri.conf.json',
  'src-tauri',
  'electron-builder.yml',
  'electron-builder.json',
  'forge.config.js',
  'forge.config.ts',
];

/**
 * Classify a project directory.
 * Returns the detected project kind, whether preview is relevant,
 * and any detected dev command/port.
 */
export async function classifyProject(dir: string): Promise<ProjectClassification> {
  const markers: string[] = [];

  // 1. Check for desktop frameworks first (highest specificity)
  for (const marker of DESKTOP_MARKERS) {
    if (await exists(join(dir, marker))) {
      markers.push(marker);
      return {
        kind: 'desktop',
        isWeb: false,
        confidence: 'high',
        markers,
      };
    }
  }

  // 2. Check for .NET MAUI / WinUI (desktop)
  const csprojFiles = await findCsprojFiles(dir);
  if (csprojFiles.length > 0) {
    for (const csproj of csprojFiles) {
      const content = await readText(csproj);
      if (content && (/UseMaui/i.test(content) || /UseWinUI/i.test(content) || /UseWPF/i.test(content))) {
        markers.push(csproj.replace(dir, '').replace(/^[/\\]/, ''));
        return {
          kind: 'desktop',
          isWeb: false,
          confidence: 'high',
          markers,
        };
      }
    }
  }

  // 3. Check package.json for Node web projects
  const pkgPath = join(dir, 'package.json');
  const pkgContent = await readText(pkgPath);
  if (pkgContent) {
    markers.push('package.json');
    try {
      const pkg = JSON.parse(pkgContent);
      const scripts = pkg.scripts ?? {};
      const devScript: string = scripts.dev ?? scripts.start ?? '';

      // Check if any web framework keyword appears in the dev/start script
      const isWebScript = WEB_FRAMEWORKS.some((fw) => devScript.toLowerCase().includes(fw));

      if (isWebScript) {
        const port = extractPort(devScript);
        return {
          kind: 'web-node',
          isWeb: true,
          devCommand: scripts.dev ? 'npm run dev' : 'npm start',
          devPort: port,
          confidence: 'high',
          markers,
        };
      }

      // Check dependencies for web frameworks (lower confidence)
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const hasWebDep = WEB_FRAMEWORKS.some((fw) => fw in allDeps || `@${fw}/core` in allDeps);
      if (hasWebDep) {
        return {
          kind: 'web-node',
          isWeb: true,
          devCommand: scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : undefined,
          devPort: devScript ? extractPort(devScript) : undefined,
          confidence: 'medium',
          markers,
        };
      }

      // Has package.json but no web indicators — likely CLI/library
      return {
        kind: 'cli',
        isWeb: false,
        confidence: 'medium',
        markers,
      };
    } catch {
      // Malformed package.json — can't classify from it
    }
  }

  // 4. Check for Python web frameworks
  const pyMarkers = ['requirements.txt', 'pyproject.toml', 'setup.py'];
  for (const pyMarker of pyMarkers) {
    const content = await readText(join(dir, pyMarker));
    if (content) {
      markers.push(pyMarker);
      const lcContent = content.toLowerCase();
      if (lcContent.includes('flask') || lcContent.includes('django') || lcContent.includes('fastapi') || lcContent.includes('streamlit')) {
        return {
          kind: 'web-python',
          isWeb: true,
          confidence: 'medium',
          markers,
        };
      }
    }
  }

  // 5. Check for static HTML site
  if (await exists(join(dir, 'index.html'))) {
    markers.push('index.html');
    return {
      kind: 'web-static',
      isWeb: true,
      confidence: 'low',
      markers,
    };
  }

  // 6. Fallback
  return {
    kind: 'unknown',
    isWeb: false,
    confidence: 'low',
    markers,
  };
}

/** Find .csproj files in the directory (non-recursive, just top level and src/*). */
async function findCsprojFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const { readdir } = await import('fs/promises');

    // Check top-level
    const topFiles = await readdir(dir);
    for (const f of topFiles) {
      if (f.endsWith('.csproj')) results.push(join(dir, f));
    }

    // Check src/* subdirectories (common .NET layout)
    const srcDir = join(dir, 'src');
    if (await exists(srcDir)) {
      const srcEntries = await readdir(srcDir, { withFileTypes: true });
      for (const entry of srcEntries) {
        if (entry.isDirectory()) {
          const subFiles = await readdir(join(srcDir, entry.name));
          for (const f of subFiles) {
            if (f.endsWith('.csproj')) results.push(join(srcDir, entry.name, f));
          }
        }
      }
    }
  } catch {
    // Ignore errors — classification is best-effort
  }
  return results;
}
