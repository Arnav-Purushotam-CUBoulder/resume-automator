import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { renderLatex } from '../latex/renderer.js';
import { GlobalCatalog, ResumeDocument } from '../domain/types.js';
import { buildRenderedResumeData } from './resumeAssembler.js';
import { BUILDS_DIR, HISTORY_CACHE_DIR, ensureDir } from '../utils/paths.js';
import { runCommand } from '../utils/shell.js';

type CompilerKind = 'latexmk' | 'pdflatex' | 'tectonic' | 'docker-latexmk' | 'none';

interface CompilerSelection {
  kind: CompilerKind;
  command?: string;
}

export interface CompileResult {
  ok: boolean;
  message: string;
  pdfPath?: string;
  texPath: string;
  logPath: string;
}

let cachedCompiler: CompilerSelection | null = null;

async function commandExists(command: string): Promise<boolean> {
  if (command.includes('/')) {
    return fs.existsSync(command);
  }

  try {
    await runCommand('which', [command], process.cwd());
    return true;
  } catch {
    return false;
  }
}

async function findCommand(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await commandExists(candidate);
    if (exists) {
      return candidate;
    }
  }
  return null;
}

async function detectCompiler(): Promise<CompilerSelection> {
  if (cachedCompiler) {
    return cachedCompiler;
  }

  const latexmk = await findCommand([
    process.env.LATEXMK_PATH ?? '',
    'latexmk',
    '/Library/TeX/texbin/latexmk',
    '/usr/texbin/latexmk',
  ].filter(Boolean));
  if (latexmk) {
    cachedCompiler = { kind: 'latexmk', command: latexmk };
    return cachedCompiler;
  }

  const pdflatex = await findCommand([
    process.env.PDFLATEX_PATH ?? '',
    'pdflatex',
    '/Library/TeX/texbin/pdflatex',
    '/usr/texbin/pdflatex',
  ].filter(Boolean));
  if (pdflatex) {
    cachedCompiler = { kind: 'pdflatex', command: pdflatex };
    return cachedCompiler;
  }

  const tectonic = await findCommand([
    process.env.TECTONIC_PATH ?? '',
    'tectonic',
    '/opt/homebrew/bin/tectonic',
    '/usr/local/bin/tectonic',
  ].filter(Boolean));
  if (tectonic) {
    cachedCompiler = { kind: 'tectonic', command: tectonic };
    return cachedCompiler;
  }

  const docker = await findCommand([
    process.env.DOCKER_PATH ?? '',
    'docker',
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
  ].filter(Boolean));
  if (docker) {
    cachedCompiler = { kind: 'docker-latexmk', command: docker };
    return cachedCompiler;
  }

  cachedCompiler = { kind: 'none' };
  return cachedCompiler;
}

async function runCompiler(
  compiler: CompilerSelection,
  buildDir: string,
  texFileName: string,
): Promise<void> {
  if (compiler.kind === 'latexmk') {
    await runCommand(
      compiler.command ?? 'latexmk',
      [
        '-pdf',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-file-line-error',
        `-output-directory=${buildDir}`,
        texFileName,
      ],
      buildDir,
    );
    return;
  }

  if (compiler.kind === 'pdflatex') {
    await runCommand(
      compiler.command ?? 'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', texFileName],
      buildDir,
    );
    await runCommand(
      compiler.command ?? 'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', texFileName],
      buildDir,
    );
    return;
  }

  if (compiler.kind === 'docker-latexmk') {
    const image = process.env.LATEX_DOCKER_IMAGE ?? 'blang/latex:ctanfull';
    await runCommand(
      compiler.command ?? 'docker',
      [
        'run',
        '--rm',
        '-v',
        `${buildDir}:/data`,
        '-w',
        '/data',
        image,
        'latexmk',
        '-pdf',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-file-line-error',
        texFileName,
      ],
      buildDir,
    );
    return;
  }

  if (compiler.kind === 'tectonic') {
    await runCommand(
      compiler.command ?? 'tectonic',
      [
        '--keep-logs',
        '--keep-intermediates',
        '--outdir',
        buildDir,
        texFileName,
      ],
      buildDir,
    );
    return;
  }

  throw new Error(
    'No LaTeX compiler found. Install TeX Live (latexmk) or start Docker Desktop (image: blang/latex:ctanfull).',
  );
}

async function compileLatexAtPath(
  buildDir: string,
  latex: string,
): Promise<CompileResult> {
  ensureDir(buildDir);
  const texPath = path.join(buildDir, 'resume.tex');
  const logPath = path.join(buildDir, 'compile.log');

  await fsp.writeFile(texPath, latex, 'utf8');

  const compiler = await detectCompiler();
  try {
    await runCompiler(compiler, buildDir, 'resume.tex');
    const pdfPath = path.join(buildDir, 'resume.pdf');

    if (!fs.existsSync(pdfPath)) {
      await fsp.writeFile(
        logPath,
        'Compilation finished without errors but resume.pdf was not produced.\n',
        'utf8',
      );
      return {
        ok: false,
        message: 'Compiler ran but did not produce a PDF.',
        texPath,
        logPath,
      };
    }

    await fsp.writeFile(
      logPath,
      `Compiler: ${compiler.kind}${compiler.command ? ` (${compiler.command})` : ''}\nCompilation completed successfully.\n`,
      'utf8',
    );
    return {
      ok: true,
      message: `Compiled successfully with ${compiler}.`,
      pdfPath,
      texPath,
      logPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compilation failed.';
    await fsp.writeFile(logPath, `${message}\n`, 'utf8');
    return {
      ok: false,
      message,
      texPath,
      logPath,
    };
  }
}

export async function compileResume(
  global: GlobalCatalog,
  resume: ResumeDocument,
): Promise<CompileResult> {
  const buildDir = path.join(BUILDS_DIR, resume.id, 'current');
  const rendered = buildRenderedResumeData(global, resume);
  const latex = resume.customLatex ?? renderLatex(rendered);
  return compileLatexAtPath(buildDir, latex);
}

export async function compileHistoricalResume(
  resumeId: string,
  commitHash: string,
  latex: string,
): Promise<CompileResult> {
  const buildDir = path.join(HISTORY_CACHE_DIR, resumeId, commitHash);
  return compileLatexAtPath(buildDir, latex);
}

export function currentArtifactPaths(resumeId: string): {
  buildDir: string;
  pdfPath: string;
  texPath: string;
  logPath: string;
} {
  const buildDir = path.join(BUILDS_DIR, resumeId, 'current');
  return {
    buildDir,
    pdfPath: path.join(buildDir, 'resume.pdf'),
    texPath: path.join(buildDir, 'resume.tex'),
    logPath: path.join(buildDir, 'compile.log'),
  };
}
