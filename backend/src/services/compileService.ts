import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { renderLatex } from '../latex/renderer.js';
import { GlobalCatalog, ResumeDocument } from '../domain/types.js';
import { buildRenderedResumeData } from './resumeAssembler.js';
import { BUILDS_DIR, HISTORY_CACHE_DIR, ensureDir } from '../utils/paths.js';
import { runCommand } from '../utils/shell.js';

type CompilerKind = 'latexmk' | 'pdflatex' | 'docker-latexmk' | 'none';

export interface CompileResult {
  ok: boolean;
  message: string;
  pdfPath?: string;
  texPath: string;
  logPath: string;
}

let cachedCompiler: CompilerKind | null = null;

async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand('which', [command], process.cwd());
    return true;
  } catch {
    return false;
  }
}

async function detectCompiler(): Promise<CompilerKind> {
  if (cachedCompiler) {
    return cachedCompiler;
  }

  if (await commandExists('latexmk')) {
    cachedCompiler = 'latexmk';
    return cachedCompiler;
  }

  if (await commandExists('pdflatex')) {
    cachedCompiler = 'pdflatex';
    return cachedCompiler;
  }

  if (await commandExists('docker')) {
    cachedCompiler = 'docker-latexmk';
    return cachedCompiler;
  }

  cachedCompiler = 'none';
  return cachedCompiler;
}

async function runCompiler(
  compiler: CompilerKind,
  buildDir: string,
  texFileName: string,
): Promise<void> {
  if (compiler === 'latexmk') {
    await runCommand(
      'latexmk',
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

  if (compiler === 'pdflatex') {
    await runCommand(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', texFileName],
      buildDir,
    );
    await runCommand(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', texFileName],
      buildDir,
    );
    return;
  }

  if (compiler === 'docker-latexmk') {
    const image = process.env.LATEX_DOCKER_IMAGE ?? 'blang/latex:ctanfull';
    await runCommand(
      'docker',
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

  throw new Error(
    'No LaTeX compiler found. Install TeX Live (latexmk) or use Docker with blang/latex:ctanfull.',
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
      `Compiler: ${compiler}\nCompilation completed successfully.\n`,
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
