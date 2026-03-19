import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { classifyProject, extractPort } from '../src/project-classify.js';

describe('project-classify', () => {
  const tempDirs: string[] = [];

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'guardian-classify-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  describe('extractPort', () => {
    it('extracts --port N', () => {
      expect(extractPort('astro dev --port 4321')).toBe(4321);
    });

    it('extracts -p N', () => {
      expect(extractPort('vite -p 3000')).toBe(3000);
    });

    it('extracts --port=N', () => {
      expect(extractPort('next dev --port=8080')).toBe(8080);
    });

    it('extracts PORT=N', () => {
      expect(extractPort('PORT=5000 node server.js')).toBe(5000);
    });

    it('returns undefined when no port found', () => {
      expect(extractPort('npm run build')).toBeUndefined();
    });
  });

  describe('desktop detection', () => {
    it('detects Tauri project', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'tauri.conf.json'), '{}');
      const result = await classifyProject(dir);
      expect(result.kind).toBe('desktop');
      expect(result.isWeb).toBe(false);
      expect(result.confidence).toBe('high');
      expect(result.markers).toContain('tauri.conf.json');
    });

    it('detects src-tauri directory', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, 'src-tauri'));
      const result = await classifyProject(dir);
      expect(result.kind).toBe('desktop');
      expect(result.isWeb).toBe(false);
    });

    it('detects .NET MAUI project', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, 'src', 'MyApp'), { recursive: true });
      await writeFile(join(dir, 'src', 'MyApp', 'MyApp.csproj'), '<Project><PropertyGroup><UseMaui>true</UseMaui></PropertyGroup></Project>');
      const result = await classifyProject(dir);
      expect(result.kind).toBe('desktop');
      expect(result.isWeb).toBe(false);
      expect(result.confidence).toBe('high');
    });

    it('detects Electron project', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'electron-builder.yml'), 'appId: test');
      const result = await classifyProject(dir);
      expect(result.kind).toBe('desktop');
      expect(result.isWeb).toBe(false);
    });
  });

  describe('web-node detection', () => {
    it('detects Astro project with port', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        scripts: { dev: 'astro dev --port 4321' },
      }));
      const result = await classifyProject(dir);
      expect(result.kind).toBe('web-node');
      expect(result.isWeb).toBe(true);
      expect(result.devCommand).toBe('npm run dev');
      expect(result.devPort).toBe(4321);
      expect(result.confidence).toBe('high');
    });

    it('detects Vite project', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        scripts: { dev: 'vite' },
      }));
      const result = await classifyProject(dir);
      expect(result.kind).toBe('web-node');
      expect(result.isWeb).toBe(true);
    });

    it('detects Next.js project', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        scripts: { dev: 'next dev' },
      }));
      const result = await classifyProject(dir);
      expect(result.kind).toBe('web-node');
      expect(result.isWeb).toBe(true);
    });

    it('detects web framework from dependencies (medium confidence)', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        scripts: { build: 'tsc' },
        dependencies: { astro: '^4.0.0' },
      }));
      const result = await classifyProject(dir);
      expect(result.kind).toBe('web-node');
      expect(result.isWeb).toBe(true);
      expect(result.confidence).toBe('medium');
    });
  });

  describe('web-python detection', () => {
    it('detects Flask project', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'requirements.txt'), 'flask==3.0\nrequests\n');
      const result = await classifyProject(dir);
      expect(result.kind).toBe('web-python');
      expect(result.isWeb).toBe(true);
    });

    it('detects FastAPI project', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'pyproject.toml'), '[project]\ndependencies = ["fastapi"]\n');
      const result = await classifyProject(dir);
      expect(result.kind).toBe('web-python');
      expect(result.isWeb).toBe(true);
    });
  });

  describe('cli / non-web detection', () => {
    it('classifies Node CLI project', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        bin: { mycli: './dist/cli.js' },
        scripts: { build: 'tsc', test: 'vitest run' },
      }));
      const result = await classifyProject(dir);
      expect(result.kind).toBe('cli');
      expect(result.isWeb).toBe(false);
    });

    it('returns unknown for empty directory', async () => {
      const dir = await makeTempDir();
      const result = await classifyProject(dir);
      expect(result.kind).toBe('unknown');
      expect(result.isWeb).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('static web detection', () => {
    it('detects static HTML site', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'index.html'), '<html><body>Hello</body></html>');
      const result = await classifyProject(dir);
      expect(result.kind).toBe('web-static');
      expect(result.isWeb).toBe(true);
      expect(result.confidence).toBe('low');
    });
  });

  describe('priority ordering', () => {
    it('desktop wins over web when both markers present', async () => {
      const dir = await makeTempDir();
      await writeFile(join(dir, 'tauri.conf.json'), '{}');
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        scripts: { dev: 'vite' },
      }));
      const result = await classifyProject(dir);
      expect(result.kind).toBe('desktop');
      expect(result.isWeb).toBe(false);
    });
  });
});
