import Editor from '@monaco-editor/react';
import { useEffect, useMemo, useState } from 'react';
import {
  compileAllResumes,
  clearCustomLatex,
  compileResume,
  createResume,
  getHistory,
  getHistorySnapshot,
  getResumeDetail,
  getState,
  overridePoint,
  saveCustomLatex,
  saveGlobal,
  saveSettings,
  updateResume,
} from './api/client';
import {
  AppSettings,
  AppStateResponse,
  CommitEvent,
  EducationEntry,
  ExperienceEntry,
  GlobalCatalog,
  OpenSourceEntry,
  ProjectEntry,
  ResumeDetailResponse,
  ResumeDocument,
  ResumeSummary,
  SectionKey,
  SkillCategory,
} from './types/domain';
import { deepClone } from './utils/clone';

type TabKey = 'resumes' | 'header' | 'output' | SectionKey;
type StudioMode = 'blocks' | 'latex';

const tabOrder: TabKey[] = [
  'resumes',
  'header',
  'output',
  'experience',
  'education',
  'skills',
  'projects',
  'openSource',
];

const tabLabels: Record<TabKey, string> = {
  resumes: 'Resumes',
  header: 'Header & Location',
  output: 'PDF Sync',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  openSource: 'Open Source',
};

const sectionTitles: Record<SectionKey, string> = {
  education: 'Education',
  skills: 'Skills',
  openSource: 'Open Source Contributions',
  projects: 'Projects',
  experience: 'Experience',
};

const sectionColors: Record<SectionKey, string> = {
  experience: 'var(--section-experience)',
  education: 'var(--section-education)',
  skills: 'var(--section-skills)',
  projects: 'var(--section-projects)',
  openSource: 'var(--section-open-source)',
};

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return 'Never';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function buildPdfPreviewUrl(url: string): string {
  const [base, hash = ''] = url.split('#', 2);
  const params = new URLSearchParams(hash);

  if (!params.has('zoom')) {
    // Default to single-page fit; the built-in viewer remains scrollable for multi-page resumes.
    params.set('zoom', 'page-fit');
  }
  if (!params.has('view')) {
    params.set('view', 'Fit');
  }
  if (!params.has('pagemode')) {
    params.set('pagemode', 'none');
  }
  if (!params.has('navpanes')) {
    params.set('navpanes', '0');
  }
  if (!params.has('statusbar')) {
    params.set('statusbar', '0');
  }

  return `${base}#${params.toString()}`;
}

function latexToPlainText(input: string): string {
  return input
    .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '$2')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\texttt\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\textbar\\\s*/g, '| ')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\#/g, '#')
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&')
    .replace(/\\_/g, '_')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainToLatexText(input: string): string {
  return input
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function parseHrefLatex(input: string): { url: string; label: string } {
  const match = input.match(/\\href\{([^}]*)\}\{([^}]*)\}/);
  if (!match) {
    return {
      url: '',
      label: latexToPlainText(input),
    };
  }

  return {
    url: match[1],
    label: latexToPlainText(match[2]),
  };
}

function parseProjectLinkLatex(input: string): { url: string; label: string } {
  const parsed = parseHrefLatex(input);
  if (parsed.url || parsed.label !== latexToPlainText(input)) {
    return parsed;
  }

  const plain = latexToPlainText(input);
  if (plain.startsWith('http://') || plain.startsWith('https://') || plain.includes('github.com')) {
    return {
      url: plain.startsWith('http') ? plain : `https://${plain}`,
      label: plain,
    };
  }

  return {
    url: '',
    label: plain,
  };
}

function buildHrefLatex(url: string, label: string): string {
  const trimmedUrl = url.trim();
  const trimmedLabel = label.trim();
  const safeLabel = plainToLatexText(trimmedLabel || trimmedUrl || 'Link');

  if (!trimmedUrl) {
    return safeLabel;
  }

  return `\\href{${trimmedUrl}}{${safeLabel}}`;
}

function sectionHasPoints(section: SectionKey): boolean {
  return section === 'experience' || section === 'projects' || section === 'openSource';
}

function sortByName(resumes: ResumeSummary[]): ResumeSummary[] {
  return [...resumes].sort((a, b) => a.name.localeCompare(b.name));
}

interface SectionPanelProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function SectionPanel({ title, subtitle, children }: SectionPanelProps) {
  return (
    <div className="section-panel">
      <div className="section-panel-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

interface HeaderEditorProps {
  global: GlobalCatalog;
  onChange: (global: GlobalCatalog) => void;
}

function HeaderEditor({ global, onChange }: HeaderEditorProps) {
  const header = global.header;

  const setField = (key: keyof GlobalCatalog['header'], value: string) => {
    const next = deepClone(global);
    next.header[key] = value;
    onChange(next);
  };

  return (
    <SectionPanel
      title="Header & Location"
      subtitle="Changes here update every resume still using the global header."
    >
      <div className="field-grid two-col">
        <label>
          Name
          <input
            value={header.name}
            onChange={(e) => setField('name', e.target.value)}
          />
        </label>
        <label>
          Phone
          <input
            value={header.phone}
            onChange={(e) => setField('phone', e.target.value)}
          />
        </label>
        <label>
          Email
          <input
            value={header.email}
            onChange={(e) => setField('email', e.target.value)}
          />
        </label>
        <label>
          Location
          <input
            value={header.location}
            onChange={(e) => setField('location', e.target.value)}
          />
        </label>
        <label>
          LinkedIn URL
          <input
            value={header.linkedinUrl}
            onChange={(e) => setField('linkedinUrl', e.target.value)}
          />
        </label>
        <label>
          LinkedIn Label
          <input
            value={header.linkedinLabel}
            onChange={(e) => setField('linkedinLabel', e.target.value)}
          />
        </label>
        <label>
          GitHub URL
          <input
            value={header.githubUrl}
            onChange={(e) => setField('githubUrl', e.target.value)}
          />
        </label>
        <label>
          GitHub Label
          <input
            value={header.githubLabel}
            onChange={(e) => setField('githubLabel', e.target.value)}
          />
        </label>
      </div>
    </SectionPanel>
  );
}

interface OutputSettingsEditorProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  dirty: boolean;
}

function OutputSettingsEditor({
  settings,
  onChange,
  onSave,
  saving,
  dirty,
}: OutputSettingsEditorProps) {
  const chooseFolderAvailable =
    typeof window !== 'undefined' && Boolean(window.desktopApi?.chooseFolder);

  const chooseFolder = async () => {
    if (!window.desktopApi?.chooseFolder) {
      return;
    }
    const folder = await window.desktopApi.chooseFolder();
    if (!folder) {
      return;
    }
    onChange({
      ...settings,
      exportPdfDir: folder,
    });
  };

  return (
    <SectionPanel
      title="PDF Sync Folder"
      subtitle="Set your iCloud folder path. After successful compile, changed resumes replace their PDF in this folder."
    >
      <div className="field-grid">
        <label>
          iCloud / Export Folder Path
          <input
            placeholder="/Users/your-user/Library/Mobile Documents/com~apple~CloudDocs/Resumes"
            value={settings.exportPdfDir ?? ''}
            onChange={(e) =>
              onChange({
                ...settings,
                exportPdfDir: e.target.value,
              })
            }
          />
        </label>
      </div>

      <div className="row-actions">
        {chooseFolderAvailable && <button onClick={chooseFolder}>Choose Folder</button>}
        <button onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving...' : dirty ? 'Save Sync Folder' : 'Sync Folder Saved'}
        </button>
      </div>
      <p className="muted-note">
        Only changed resumes are replaced. Existing PDFs for unchanged resumes are left as-is.
      </p>
    </SectionPanel>
  );
}

interface EducationEditorProps {
  global: GlobalCatalog;
  onChange: (global: GlobalCatalog) => void;
}

function EducationEditor({ global, onChange }: EducationEditorProps) {
  const education = global.sections.education;

  const patchEntry = (idx: number, key: keyof EducationEntry, value: string) => {
    const next = deepClone(global);
    next.sections.education[idx][key] = value;
    onChange(next);
  };

  const addEntry = () => {
    const next = deepClone(global);
    next.sections.education.push({
      id: makeId('edu'),
      institution: 'New Institution',
      rightMeta: 'City, Country \\textbar\\ Start -- End',
      degree: 'Degree',
      detail: 'GPA: 0.0/4.0',
    });
    onChange(next);
  };

  const removeEntry = (idx: number) => {
    const next = deepClone(global);
    next.sections.education.splice(idx, 1);
    onChange(next);
  };

  return (
    <SectionPanel
      title="Education"
      subtitle="Maintain all education blocks used by resume variants."
    >
      <div className="stack">
        {education.map((entry, idx) => (
          <div key={entry.id} className="editor-card">
            <div className="editor-card-header">
              <strong>{entry.institution || 'Education Entry'}</strong>
              <button onClick={() => removeEntry(idx)} className="danger">
                Remove
              </button>
            </div>
            <div className="field-grid two-col">
              <label>
                Institution
                <input
                  value={entry.institution}
                  onChange={(e) => patchEntry(idx, 'institution', e.target.value)}
                />
              </label>
              <label>
                Right Meta
                <input
                  value={entry.rightMeta}
                  onChange={(e) => patchEntry(idx, 'rightMeta', e.target.value)}
                />
              </label>
              <label>
                Degree
                <input
                  value={entry.degree}
                  onChange={(e) => patchEntry(idx, 'degree', e.target.value)}
                />
              </label>
              <label>
                Detail
                <input
                  value={entry.detail}
                  onChange={(e) => patchEntry(idx, 'detail', e.target.value)}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addEntry}>Add Education Entry</button>
    </SectionPanel>
  );
}

interface SkillsEditorProps {
  global: GlobalCatalog;
  onChange: (global: GlobalCatalog) => void;
}

function SkillsEditor({ global, onChange }: SkillsEditorProps) {
  const skills = global.sections.skills;

  const patchEntry = (idx: number, key: keyof SkillCategory, value: string) => {
    const next = deepClone(global);
    next.sections.skills[idx][key] = value;
    onChange(next);
  };

  const addEntry = () => {
    const next = deepClone(global);
    next.sections.skills.push({
      id: makeId('skill'),
      label: 'Category',
      value: 'Items',
    });
    onChange(next);
  };

  const removeEntry = (idx: number) => {
    const next = deepClone(global);
    next.sections.skills.splice(idx, 1);
    onChange(next);
  };

  return (
    <SectionPanel
      title="Skills"
      subtitle="These rows map directly to your LaTeX skills item list."
    >
      <div className="stack">
        {skills.map((entry, idx) => (
          <div key={entry.id} className="editor-card">
            <div className="editor-card-header">
              <strong>{entry.label || 'Skills Row'}</strong>
              <button onClick={() => removeEntry(idx)} className="danger">
                Remove
              </button>
            </div>
            <div className="field-grid two-col">
              <label>
                Label
                <input
                  value={entry.label}
                  onChange={(e) => patchEntry(idx, 'label', e.target.value)}
                />
              </label>
              <label>
                Value
                <input
                  value={entry.value}
                  onChange={(e) => patchEntry(idx, 'value', e.target.value)}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addEntry}>Add Skills Row</button>
    </SectionPanel>
  );
}

interface ExperienceEditorProps {
  global: GlobalCatalog;
  onChange: (global: GlobalCatalog) => void;
}

function ExperienceEditor({ global, onChange }: ExperienceEditorProps) {
  const experience = global.sections.experience;

  const patchEntry = (
    idx: number,
    key: keyof ExperienceEntry,
    value: string | string[],
  ) => {
    const next = deepClone(global);
    (next.sections.experience[idx][key] as string | string[]) = value;
    onChange(next);
  };

  const addExperience = () => {
    const next = deepClone(global);
    const pointId = makeId('pt');
    next.points[pointId] = {
      id: pointId,
      text: 'New experience point',
    };
    next.sections.experience.push({
      id: makeId('exp'),
      company: 'Company',
      dateRange: 'Start -- End',
      role: 'Role',
      location: '',
      pointIds: [pointId],
    });
    onChange(next);
  };

  const addPoint = (idx: number) => {
    const next = deepClone(global);
    const pointId = makeId('pt');
    next.points[pointId] = {
      id: pointId,
      text: 'New bullet point',
    };
    next.sections.experience[idx].pointIds.push(pointId);
    onChange(next);
  };

  const removePoint = (idx: number, pointId: string) => {
    const next = deepClone(global);
    next.sections.experience[idx].pointIds = next.sections.experience[idx].pointIds.filter(
      (id) => id !== pointId,
    );
    onChange(next);
  };

  const patchPoint = (pointId: string, value: string) => {
    const next = deepClone(global);
    next.points[pointId] = { ...next.points[pointId], text: plainToLatexText(value) };
    onChange(next);
  };

  const removeExperience = (idx: number) => {
    const next = deepClone(global);
    next.sections.experience.splice(idx, 1);
    onChange(next);
  };

  return (
    <SectionPanel
      title="Experience"
      subtitle="Edit global roles and points. Commit compiles resumes that reference changed content."
    >
      <div className="stack">
        {experience.map((entry, idx) => (
          <div key={entry.id} className="editor-card">
            <div className="editor-card-header">
              <strong>{entry.company || 'Experience Entry'}</strong>
              <button onClick={() => removeExperience(idx)} className="danger">
                Remove
              </button>
            </div>

            <div className="field-grid two-col">
              <label>
                Company
                <input
                  value={entry.company}
                  onChange={(e) => patchEntry(idx, 'company', e.target.value)}
                />
              </label>
              <label>
                Date Range
                <input
                  value={entry.dateRange}
                  onChange={(e) => patchEntry(idx, 'dateRange', e.target.value)}
                />
              </label>
              <label>
                Role
                <input
                  value={entry.role}
                  onChange={(e) => patchEntry(idx, 'role', e.target.value)}
                />
              </label>
              <label>
                Right-side secondary line
                <input
                  value={entry.location}
                  onChange={(e) => patchEntry(idx, 'location', e.target.value)}
                />
              </label>
            </div>

            <div className="points-list">
              <h4>Points</h4>
              {entry.pointIds.map((pointId) => (
                <div key={pointId} className="point-row">
                  <textarea
                    value={latexToPlainText(global.points[pointId]?.text ?? '')}
                    onChange={(e) => patchPoint(pointId, e.target.value)}
                  />
                  <button className="danger" onClick={() => removePoint(idx, pointId)}>
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={() => addPoint(idx)}>Add Point</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addExperience}>Add Experience</button>
    </SectionPanel>
  );
}

interface ProjectsEditorProps {
  global: GlobalCatalog;
  onChange: (global: GlobalCatalog) => void;
}

function ProjectsEditor({ global, onChange }: ProjectsEditorProps) {
  const projects = global.sections.projects;

  const patchEntry = (
    idx: number,
    key: keyof ProjectEntry,
    value: string | string[],
  ) => {
    const next = deepClone(global);
    (next.sections.projects[idx][key] as string | string[]) = value;
    onChange(next);
  };

  const addProject = () => {
    const next = deepClone(global);
    const pointId = makeId('pt');
    next.points[pointId] = { id: pointId, text: 'New project bullet point' };
    next.sections.projects.push({
      id: makeId('proj'),
      title: 'Project title',
      dateRange: 'Start -- End',
      link: '\\href{https://example.com}{https://example.com}',
      pointIds: [pointId],
    });
    onChange(next);
  };

  const removeProject = (idx: number) => {
    const next = deepClone(global);
    next.sections.projects.splice(idx, 1);
    onChange(next);
  };

  const patchPoint = (pointId: string, value: string) => {
    const next = deepClone(global);
    next.points[pointId] = { ...next.points[pointId], text: plainToLatexText(value) };
    onChange(next);
  };

  const setProjectTitle = (idx: number, title: string) => {
    const next = deepClone(global);
    next.sections.projects[idx].title = plainToLatexText(title);
    onChange(next);
  };

  const setProjectLink = (idx: number, link: string) => {
    const next = deepClone(global);
    const clean = link.trim();
    const normalized =
      clean && !clean.startsWith('http://') && !clean.startsWith('https://')
        ? `https://${clean}`
        : clean;
    next.sections.projects[idx].link = normalized
      ? buildHrefLatex(normalized, normalized)
      : '';
    onChange(next);
  };

  const addPoint = (idx: number) => {
    const next = deepClone(global);
    const pointId = makeId('pt');
    next.points[pointId] = { id: pointId, text: 'New project bullet point' };
    next.sections.projects[idx].pointIds.push(pointId);
    onChange(next);
  };

  const removePoint = (idx: number, pointId: string) => {
    const next = deepClone(global);
    next.sections.projects[idx].pointIds = next.sections.projects[idx].pointIds.filter(
      (id) => id !== pointId,
    );
    onChange(next);
  };

  return (
    <SectionPanel
      title="Projects"
      subtitle="Project blocks are rendered with the same `resumeSubheading` + bullet layout."
    >
      <div className="stack">
        {projects.map((entry, idx) => (
          <div key={entry.id} className="editor-card">
            <div className="editor-card-header">
              <strong>{latexToPlainText(entry.title) || 'Project Entry'}</strong>
              <button onClick={() => removeProject(idx)} className="danger">
                Remove
              </button>
            </div>
            <div className="field-grid two-col">
              <label>
                Title
                <input
                  value={latexToPlainText(entry.title)}
                  onChange={(e) => setProjectTitle(idx, e.target.value)}
                />
              </label>
              <label>
                Date Range
                <input
                  value={entry.dateRange}
                  onChange={(e) => patchEntry(idx, 'dateRange', e.target.value)}
                />
              </label>
              <label className="span-2">
                Link URL
                <input
                  value={parseProjectLinkLatex(entry.link).url}
                  onChange={(e) => setProjectLink(idx, e.target.value)}
                />
              </label>
            </div>

            <div className="points-list">
              <h4>Points</h4>
              {entry.pointIds.map((pointId) => (
                <div key={pointId} className="point-row">
                  <textarea
                    value={latexToPlainText(global.points[pointId]?.text ?? '')}
                    onChange={(e) => patchPoint(pointId, e.target.value)}
                  />
                  <button className="danger" onClick={() => removePoint(idx, pointId)}>
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={() => addPoint(idx)}>Add Point</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addProject}>Add Project</button>
    </SectionPanel>
  );
}

interface OpenSourceEditorProps {
  global: GlobalCatalog;
  onChange: (global: GlobalCatalog) => void;
}

function OpenSourceEditor({ global, onChange }: OpenSourceEditorProps) {
  const openSource = global.sections.openSource;

  const patchEntry = (
    idx: number,
    key: keyof OpenSourceEntry,
    value: string | string[],
  ) => {
    const next = deepClone(global);
    (next.sections.openSource[idx][key] as string | string[]) = value;
    onChange(next);
  };

  const addEntry = () => {
    const next = deepClone(global);
    const pointId = makeId('pt');
    next.points[pointId] = { id: pointId, text: 'New contribution bullet point' };
    next.sections.openSource.push({
      id: makeId('os'),
      title: '\\href{https://github.com/org/repo}{org/repo}',
      dateRange: 'Month YYYY -- Present',
      role: 'Open Source Contributor',
      link: 'https://github.com/org/repo',
      pointIds: [pointId],
    });
    onChange(next);
  };

  const removeEntry = (idx: number) => {
    const next = deepClone(global);
    next.sections.openSource.splice(idx, 1);
    onChange(next);
  };

  const patchPoint = (pointId: string, value: string) => {
    const next = deepClone(global);
    next.points[pointId] = { ...next.points[pointId], text: plainToLatexText(value) };
    onChange(next);
  };

  const setEntryDisplayTitle = (idx: number, title: string) => {
    const next = deepClone(global);
    const entry = next.sections.openSource[idx];
    const fallbackUrl = parseHrefLatex(entry.title).url;
    const url = entry.link || fallbackUrl;
    entry.title = buildHrefLatex(url, title);
    onChange(next);
  };

  const setEntryLink = (idx: number, link: string) => {
    const next = deepClone(global);
    const entry = next.sections.openSource[idx];
    const currentLabel = parseHrefLatex(entry.title).label || entry.link || 'Repository';
    entry.link = link;
    entry.title = buildHrefLatex(link, currentLabel);
    onChange(next);
  };

  const addPoint = (idx: number) => {
    const next = deepClone(global);
    const pointId = makeId('pt');
    next.points[pointId] = { id: pointId, text: 'New open source point' };
    next.sections.openSource[idx].pointIds.push(pointId);
    onChange(next);
  };

  const removePoint = (idx: number, pointId: string) => {
    const next = deepClone(global);
    next.sections.openSource[idx].pointIds = next.sections.openSource[idx].pointIds.filter(
      (id) => id !== pointId,
    );
    onChange(next);
  };

  return (
    <SectionPanel
      title="Open Source Contributions"
      subtitle="Track contribution blocks separately from work experience and projects."
    >
      <div className="stack">
        {openSource.map((entry, idx) => (
          <div key={entry.id} className="editor-card">
            <div className="editor-card-header">
              <strong>{parseHrefLatex(entry.title).label || 'Open Source Entry'}</strong>
              <button onClick={() => removeEntry(idx)} className="danger">
                Remove
              </button>
            </div>
            <div className="field-grid two-col">
              <label>
                Repository
                <input
                  value={parseHrefLatex(entry.title).label}
                  onChange={(e) => setEntryDisplayTitle(idx, e.target.value)}
                />
              </label>
              <label>
                Date Range
                <input
                  value={entry.dateRange}
                  onChange={(e) => patchEntry(idx, 'dateRange', e.target.value)}
                />
              </label>
              <label>
                Role
                <input
                  value={entry.role}
                  onChange={(e) => patchEntry(idx, 'role', e.target.value)}
                />
              </label>
              <label>
                Link
                <input
                  value={entry.link}
                  onChange={(e) => setEntryLink(idx, e.target.value)}
                />
              </label>
            </div>

            <div className="points-list">
              <h4>Points</h4>
              {entry.pointIds.map((pointId) => (
                <div key={pointId} className="point-row">
                  <textarea
                    value={latexToPlainText(global.points[pointId]?.text ?? '')}
                    onChange={(e) => patchPoint(pointId, e.target.value)}
                  />
                  <button className="danger" onClick={() => removePoint(idx, pointId)}>
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={() => addPoint(idx)}>Add Point</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addEntry}>Add Open Source Entry</button>
    </SectionPanel>
  );
}

interface ResumesTabProps {
  resumes: ResumeSummary[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onCreate: (name: string, sourceResumeId?: string) => Promise<void>;
  onCompileAll: () => Promise<void>;
  compilingAll: boolean;
}

function ResumesTab({
  resumes,
  selectedId,
  onSelect,
  onCreate,
  onCompileAll,
  compilingAll,
}: ResumesTabProps) {
  const [name, setName] = useState('');
  const [sourceResumeId, setSourceResumeId] = useState<string | undefined>(selectedId);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!sourceResumeId && resumes[0]) {
      setSourceResumeId(resumes[0].id);
    }
  }, [resumes, sourceResumeId]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setCreating(true);
    try {
      await onCreate(trimmed, sourceResumeId);
      setName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SectionPanel
      title="Resumes"
      subtitle="Open any resume to edit blocks, inspect LaTeX, compile, and browse version history."
    >
      <div className="resume-grid">
        {resumes.map((resume) => (
          <button
            key={resume.id}
            className={`resume-card ${resume.id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(resume.id)}
          >
            <div className="resume-card-top">
              <span
                className={`badge ${
                  resume.lastCompileStatus === 'success'
                    ? 'success'
                    : resume.lastCompileStatus === 'failed'
                      ? 'error'
                      : ''
                }`}
              >
                {resume.lastCompileStatus ?? 'not compiled'}
              </span>
            </div>
            <h3 className="resume-name-full" title={resume.name}>
              {resume.name}
            </h3>
            <p>Updated: {formatDateTime(resume.updatedAt)}</p>
            <p>Last compile: {formatDateTime(resume.lastCompiledAt)}</p>
          </button>
        ))}
      </div>

      <div className="new-resume-form">
        <h3>Create New Resume</h3>
        <div className="row-actions">
          <button onClick={onCompileAll} disabled={compilingAll}>
            {compilingAll ? 'Compiling all...' : 'Compile All Resumes'}
          </button>
        </div>
        <div className="field-grid two-col">
          <label>
            Name
            <input
              placeholder="e.g. Backend Resume - Austin"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Clone from
            <select
              value={sourceResumeId}
              onChange={(e) => setSourceResumeId(e.target.value)}
            >
              {resumes.map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? 'Creating...' : 'Create Resume'}
        </button>
      </div>
    </SectionPanel>
  );
}

interface ResumeStudioProps {
  global: GlobalCatalog;
  detail: ResumeDetailResponse;
  history: CommitEvent[];
  onSaveResume: (resume: ResumeDocument, message: string) => Promise<void>;
  onCompile: () => Promise<void>;
  onOverridePoint: (
    section: SectionKey,
    refId: string,
    pointId: string,
    currentText: string,
  ) => Promise<void>;
  onSaveCustomLatex: (latex: string) => Promise<void>;
  onClearCustomLatex: () => Promise<void>;
  onLoadSnapshot: (commitHash: string) => Promise<void>;
  snapshot: { commitHash: string; latex: string; pdfUrl?: string } | null;
}

function ResumeStudio({
  global,
  detail,
  history,
  onSaveResume,
  onCompile,
  onOverridePoint,
  onSaveCustomLatex,
  onClearCustomLatex,
  onLoadSnapshot,
  snapshot,
}: ResumeStudioProps) {
  const [mode, setMode] = useState<StudioMode>('blocks');
  const [draft, setDraft] = useState<ResumeDocument>(deepClone(detail.resume));
  const [latexDraft, setLatexDraft] = useState(detail.latex);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(deepClone(detail.resume));
  }, [detail.resume.id, detail.resume.updatedAt]);

  useEffect(() => {
    setLatexDraft(detail.latex);
  }, [detail.latex]);

  const globalIndexes = useMemo(() => {
    const toIndex = <T extends { id: string }>(items: T[]): Record<string, T> => {
      return items.reduce<Record<string, T>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {});
    };

    return {
      education: toIndex(global.sections.education),
      skills: toIndex(global.sections.skills),
      openSource: toIndex(global.sections.openSource),
      projects: toIndex(global.sections.projects),
      experience: toIndex(global.sections.experience),
    };
  }, [global]);

  const hasDraftChanges = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(detail.resume),
    [draft, detail.resume],
  );

  const saveDraft = async () => {
    setBusy(true);
    try {
      await onSaveResume(draft, `Update resume ${draft.name} blocks`);
    } finally {
      setBusy(false);
    }
  };

  const moveSection = (section: SectionKey, direction: -1 | 1) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      const idx = next.sectionOrder.indexOf(section);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= next.sectionOrder.length) {
        return prev;
      }
      const temp = next.sectionOrder[idx];
      next.sectionOrder[idx] = next.sectionOrder[target];
      next.sectionOrder[target] = temp;
      return next;
    });
  };

  const toggleSectionVisibility = (section: SectionKey) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      next.sectionVisibility[section] = !next.sectionVisibility[section];
      return next;
    });
  };

  const removeRef = (section: SectionKey, index: number) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      next.sections[section].splice(index, 1);
      return next;
    });
  };

  const addGlobalRef = (section: SectionKey, globalId: string) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      next.sections[section].push({ globalId });
      return next;
    });
  };

  const addLocalEntry = (section: SectionKey) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      if (section === 'education') {
        const id = makeId('ledu');
        next.local.education.push({
          id,
          institution: 'Local Institution',
          rightMeta: 'City, Country \\textbar\\ Start -- End',
          degree: 'Degree',
          detail: 'Detail',
        });
        next.sections.education.push({ localId: id });
      }

      if (section === 'skills') {
        const id = makeId('lskill');
        next.local.skills.push({
          id,
          label: 'Local Skill Category',
          value: 'Skills',
        });
        next.sections.skills.push({ localId: id });
      }

      if (section === 'experience') {
        const pointId = makeId('lp');
        next.local.points[pointId] = { id: pointId, text: 'Resume-only experience point' };
        const id = makeId('lexp');
        next.local.experience.push({
          id,
          company: 'Local Company',
          dateRange: 'Start -- End',
          role: 'Role',
          location: '',
          pointIds: [pointId],
        });
        next.sections.experience.push({ localId: id });
      }

      if (section === 'projects') {
        const pointId = makeId('lp');
        next.local.points[pointId] = { id: pointId, text: 'Resume-only project point' };
        const id = makeId('lproj');
        next.local.projects.push({
          id,
          title: 'Local Project',
          dateRange: 'Start -- End',
          link: '\\href{https://example.com}{https://example.com}',
          pointIds: [pointId],
        });
        next.sections.projects.push({ localId: id });
      }

      if (section === 'openSource') {
        const pointId = makeId('lp');
        next.local.points[pointId] = { id: pointId, text: 'Resume-only open source point' };
        const id = makeId('los');
        next.local.openSource.push({
          id,
          title: '\\href{https://github.com/org/repo}{org/repo}',
          dateRange: 'Start -- End',
          role: 'Local Contributor Role',
          link: 'https://github.com/org/repo',
          pointIds: [pointId],
        });
        next.sections.openSource.push({ localId: id });
      }

      return next;
    });
  };

  const findSectionRefId = (section: SectionKey, index: number): string => {
    const ref = draft.sections[section][index];
    return ref.globalId ?? ref.localId ?? '';
  };

  const detachRefToLocal = (section: SectionKey, refIndex: number) => {
    if (!sectionHasPoints(section)) {
      return;
    }

    setDraft((prev) => {
      const next = deepClone(prev);
      const ref = next.sections[section][refIndex];
      if (!ref || !ref.globalId) {
        return prev;
      }

      const clonePointIds = (sourcePointIds: string[]): string[] => {
        const localPointIds: string[] = [];
        for (const basePointId of sourcePointIds) {
          const effectivePointId = ref.pointOverrides?.[basePointId] ?? basePointId;
          const text =
            next.local.points[effectivePointId]?.text ?? global.points[effectivePointId]?.text;
          if (!text) {
            continue;
          }
          const localPointId = makeId('lp');
          next.local.points[localPointId] = { id: localPointId, text };
          localPointIds.push(localPointId);
        }
        return localPointIds;
      };

      if (section === 'experience') {
        const source = globalIndexes.experience[ref.globalId];
        if (!source) {
          return prev;
        }
        const basePointIds = ref.includePointIds?.length
          ? source.pointIds.filter((id) => ref.includePointIds?.includes(id))
          : source.pointIds;
        const localId = makeId('lexp');
        next.local.experience.push({
          id: localId,
          company: source.company,
          dateRange: source.dateRange,
          role: source.role,
          location: source.location,
          pointIds: clonePointIds(basePointIds),
        });
        next.sections.experience[refIndex] = { localId };
        return next;
      }

      if (section === 'projects') {
        const source = globalIndexes.projects[ref.globalId];
        if (!source) {
          return prev;
        }
        const basePointIds = ref.includePointIds?.length
          ? source.pointIds.filter((id) => ref.includePointIds?.includes(id))
          : source.pointIds;
        const localId = makeId('lproj');
        next.local.projects.push({
          id: localId,
          title: source.title,
          dateRange: source.dateRange,
          link: source.link,
          pointIds: clonePointIds(basePointIds),
        });
        next.sections.projects[refIndex] = { localId };
        return next;
      }

      if (section === 'openSource') {
        const source = globalIndexes.openSource[ref.globalId];
        if (!source) {
          return prev;
        }
        const basePointIds = ref.includePointIds?.length
          ? source.pointIds.filter((id) => ref.includePointIds?.includes(id))
          : source.pointIds;
        const localId = makeId('los');
        next.local.openSource.push({
          id: localId,
          title: source.title,
          dateRange: source.dateRange,
          role: source.role,
          link: source.link,
          pointIds: clonePointIds(basePointIds),
        });
        next.sections.openSource[refIndex] = { localId };
        return next;
      }

      return next;
    });
  };

  const updateLocalEntryField = (
    section: SectionKey,
    localId: string,
    field: string,
    value: string,
  ) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      if (section === 'education') {
        const entry = next.local.education.find((item) => item.id === localId) as
          | Record<string, unknown>
          | undefined;
        if (!entry) {
          return prev;
        }
        entry[field] = value;
        return next;
      }

      if (section === 'skills') {
        const entry = next.local.skills.find((item) => item.id === localId) as
          | Record<string, unknown>
          | undefined;
        if (!entry) {
          return prev;
        }
        entry[field] = value;
        return next;
      }

      if (section === 'experience') {
        const entry = next.local.experience.find((item) => item.id === localId) as
          | Record<string, unknown>
          | undefined;
        if (!entry) {
          return prev;
        }
        entry[field] = value;
        return next;
      }

      if (section === 'projects') {
        const entry = next.local.projects.find((item) => item.id === localId) as
          | Record<string, unknown>
          | undefined;
        if (!entry) {
          return prev;
        }
        entry[field] = value;
        return next;
      }

      if (section === 'openSource') {
        const entry = next.local.openSource.find((item) => item.id === localId) as
          | Record<string, unknown>
          | undefined;
        if (!entry) {
          return prev;
        }
        entry[field] = value;
        return next;
      }

      return next;
    });
  };

  const updateLocalPoint = (pointId: string, text: string) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      if (!next.local.points[pointId]) {
        return prev;
      }
      next.local.points[pointId].text = plainToLatexText(text);
      return next;
    });
  };

  const updateLocalProjectLink = (localId: string, url: string) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      const entry = next.local.projects.find((item) => item.id === localId);
      if (!entry) {
        return prev;
      }
      const clean = url.trim();
      const normalized =
        clean && !clean.startsWith('http://') && !clean.startsWith('https://')
          ? `https://${clean}`
          : clean;
      entry.link = normalized ? buildHrefLatex(normalized, normalized) : '';
      return next;
    });
  };

  const updateLocalOpenSourceTitle = (localId: string, title: string) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      const entry = next.local.openSource.find((item) => item.id === localId);
      if (!entry) {
        return prev;
      }
      const url = entry.link || parseHrefLatex(entry.title).url;
      entry.title = buildHrefLatex(url, title);
      return next;
    });
  };

  const updateLocalOpenSourceLink = (localId: string, url: string) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      const entry = next.local.openSource.find((item) => item.id === localId);
      if (!entry) {
        return prev;
      }
      const clean = url.trim();
      const normalized =
        clean && !clean.startsWith('http://') && !clean.startsWith('https://')
          ? `https://${clean}`
          : clean;
      entry.link = normalized;
      const label = parseHrefLatex(entry.title).label || 'Repository';
      entry.title = buildHrefLatex(normalized, label);
      return next;
    });
  };

  const addLocalPointToEntry = (section: SectionKey, localId: string) => {
    if (!sectionHasPoints(section)) {
      return;
    }

    setDraft((prev) => {
      const next = deepClone(prev);
      const pointId = makeId('lp');
      next.local.points[pointId] = { id: pointId, text: 'Resume-only point' };

      if (section === 'experience') {
        const entry = next.local.experience.find((item) => item.id === localId);
        if (entry) {
          entry.pointIds.push(pointId);
        }
      }

      if (section === 'projects') {
        const entry = next.local.projects.find((item) => item.id === localId);
        if (entry) {
          entry.pointIds.push(pointId);
        }
      }

      if (section === 'openSource') {
        const entry = next.local.openSource.find((item) => item.id === localId);
        if (entry) {
          entry.pointIds.push(pointId);
        }
      }

      return next;
    });
  };

  const removePointFromRef = (
    section: SectionKey,
    refIndex: number,
    sourcePointId: string,
    localPointId?: string,
  ) => {
    setDraft((prev) => {
      const next = deepClone(prev);
      const ref = next.sections[section][refIndex];
      if (!ref) {
        return prev;
      }

      if (ref.localId) {
        const list = next.local[section] as Array<{ id: string; pointIds: string[] }>;
        const entry = list.find((item) => item.id === ref.localId);
        if (!entry) {
          return prev;
        }
        const targetPointId = localPointId ?? sourcePointId;
        entry.pointIds = entry.pointIds.filter((id) => id !== targetPointId);
        return next;
      }

      if (ref.globalId) {
        const globalEntry =
          section === 'experience'
            ? globalIndexes.experience[ref.globalId]
            : section === 'projects'
              ? globalIndexes.projects[ref.globalId]
              : globalIndexes.openSource[ref.globalId];

        if (!globalEntry) {
          return prev;
        }

        const currentlyIncluded = ref.includePointIds?.length
          ? ref.includePointIds
          : [...globalEntry.pointIds];
        ref.includePointIds = currentlyIncluded.filter((id) => id !== sourcePointId);
      }

      return next;
    });
  };

  const handleOverride = async (
    section: SectionKey,
    refId: string,
    pointId: string,
    currentText: string,
  ) => {
    const edited = window.prompt(
      'Create resume-only point text (this will detach from global updates):',
      currentText,
    );

    if (!edited || !edited.trim()) {
      return;
    }

    setBusy(true);
    try {
      await onOverridePoint(section, refId, pointId, edited.trim());
    } finally {
      setBusy(false);
    }
  };

  const renderEntryBlock = (section: SectionKey, refIndex: number) => {
    const ref = draft.sections[section][refIndex];
    if (!ref) {
      return null;
    }

    const refId = ref.globalId ?? ref.localId ?? `ref-${refIndex}`;
    const isLocal = Boolean(ref.localId);

    const source = (() => {
      if (section === 'education') {
        return ref.globalId
          ? globalIndexes.education[ref.globalId]
          : draft.local.education.find((item) => item.id === ref.localId);
      }
      if (section === 'skills') {
        return ref.globalId
          ? globalIndexes.skills[ref.globalId]
          : draft.local.skills.find((item) => item.id === ref.localId);
      }
      if (section === 'experience') {
        return ref.globalId
          ? globalIndexes.experience[ref.globalId]
          : draft.local.experience.find((item) => item.id === ref.localId);
      }
      if (section === 'projects') {
        return ref.globalId
          ? globalIndexes.projects[ref.globalId]
          : draft.local.projects.find((item) => item.id === ref.localId);
      }
      return ref.globalId
        ? globalIndexes.openSource[ref.globalId]
        : draft.local.openSource.find((item) => item.id === ref.localId);
    })();

    if (!source) {
      return (
        <div key={refId} className="block-card missing">
          Missing source for reference {refId}
        </div>
      );
    }

    const points = sectionHasPoints(section)
      ? (() => {
          const typed = source as ExperienceEntry | ProjectEntry | OpenSourceEntry;
          const sourcePointIds = ref.localId
            ? typed.pointIds
            : ref.includePointIds?.length
              ? typed.pointIds.filter((id) => ref.includePointIds?.includes(id))
              : typed.pointIds;

          return sourcePointIds.map((sourcePointId) => {
            const effectivePointId = ref.pointOverrides?.[sourcePointId] ?? sourcePointId;
            const text =
              draft.local.points[effectivePointId]?.text ??
              global.points[effectivePointId]?.text ??
              '';
            const isLocalPoint = Boolean(draft.local.points[effectivePointId]);
            return {
              sourcePointId,
              effectivePointId,
              text,
              isLocalPoint,
            };
          });
        })()
      : [];

    return (
      <div key={refId} className="block-card">
        <div className="block-card-header">
          <div>
            <strong>{isLocal ? 'Local' : 'Global'} Block</strong>
            <p>{refId}</p>
          </div>
          <div className="row-actions">
            {!isLocal && sectionHasPoints(section) && (
              <button onClick={() => detachRefToLocal(section, refIndex)}>
                Detach to Resume-only
              </button>
            )}
            <button className="danger" onClick={() => removeRef(section, refIndex)}>
              Remove Block
            </button>
          </div>
        </div>

        {section === 'education' && (
          <div className="field-grid two-col">
            <label>
              Institution
              <input
                value={(source as EducationEntry).institution}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(
                    section,
                    ref.localId!,
                    'institution',
                    e.target.value,
                  )
                }
              />
            </label>
            <label>
              Right Meta
              <input
                value={(source as EducationEntry).rightMeta}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(
                    section,
                    ref.localId!,
                    'rightMeta',
                    e.target.value,
                  )
                }
              />
            </label>
            <label>
              Degree
              <input
                value={(source as EducationEntry).degree}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'degree', e.target.value)
                }
              />
            </label>
            <label>
              Detail
              <input
                value={(source as EducationEntry).detail}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'detail', e.target.value)
                }
              />
            </label>
          </div>
        )}

        {section === 'skills' && (
          <div className="field-grid two-col">
            <label>
              Label
              <input
                value={(source as SkillCategory).label}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'label', e.target.value)
                }
              />
            </label>
            <label>
              Value
              <input
                value={(source as SkillCategory).value}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'value', e.target.value)
                }
              />
            </label>
          </div>
        )}

        {section === 'experience' && (
          <div className="field-grid two-col">
            <label>
              Company
              <input
                value={(source as ExperienceEntry).company}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'company', e.target.value)
                }
              />
            </label>
            <label>
              Date Range
              <input
                value={(source as ExperienceEntry).dateRange}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'dateRange', e.target.value)
                }
              />
            </label>
            <label>
              Role
              <input
                value={(source as ExperienceEntry).role}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'role', e.target.value)
                }
              />
            </label>
            <label>
              Secondary Line
              <input
                value={(source as ExperienceEntry).location}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'location', e.target.value)
                }
              />
            </label>
          </div>
        )}

        {section === 'projects' && (
          <div className="field-grid two-col">
            <label>
              Title
              <input
                value={latexToPlainText((source as ProjectEntry).title)}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(
                    section,
                    ref.localId!,
                    'title',
                    plainToLatexText(e.target.value),
                  )
                }
              />
            </label>
            <label>
              Date Range
              <input
                value={(source as ProjectEntry).dateRange}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'dateRange', e.target.value)
                }
              />
            </label>
            <label className="span-2">
              Link
              <input
                value={parseProjectLinkLatex((source as ProjectEntry).link).url}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalProjectLink(ref.localId!, e.target.value)
                }
              />
            </label>
          </div>
        )}

        {section === 'openSource' && (
          <div className="field-grid two-col">
            <label>
              Repository
              <input
                value={parseHrefLatex((source as OpenSourceEntry).title).label}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalOpenSourceTitle(ref.localId!, e.target.value)
                }
              />
            </label>
            <label>
              Date Range
              <input
                value={(source as OpenSourceEntry).dateRange}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'dateRange', e.target.value)
                }
              />
            </label>
            <label>
              Role
              <input
                value={(source as OpenSourceEntry).role}
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalEntryField(section, ref.localId!, 'role', e.target.value)
                }
              />
            </label>
            <label>
              Link
              <input
                value={
                  (source as OpenSourceEntry).link ||
                  parseHrefLatex((source as OpenSourceEntry).title).url
                }
                disabled={!isLocal}
                onChange={(e) =>
                  isLocal &&
                  updateLocalOpenSourceLink(ref.localId!, e.target.value)
                }
              />
            </label>
          </div>
        )}

        {sectionHasPoints(section) && (
          <div className="points-list">
            <h4>Points</h4>
            {points.map((point) => (
              <div key={`${point.sourcePointId}-${point.effectivePointId}`} className="point-row">
                {point.isLocalPoint ? (
                  <textarea
                    value={latexToPlainText(point.text)}
                    onChange={(e) => updateLocalPoint(point.effectivePointId, e.target.value)}
                  />
                ) : (
                  <textarea value={latexToPlainText(point.text)} readOnly />
                )}
                <div className="row-actions">
                  {!point.isLocalPoint && (
                    <button
                      onClick={() =>
                        handleOverride(
                          section,
                          refId,
                          point.sourcePointId,
                          latexToPlainText(point.text),
                        )
                      }
                    >
                      Override in this resume
                    </button>
                  )}
                  <button
                    className="danger"
                    onClick={() =>
                      removePointFromRef(
                        section,
                        refIndex,
                        point.sourcePointId,
                        point.isLocalPoint ? point.effectivePointId : undefined,
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {isLocal && (
              <button onClick={() => addLocalPointToEntry(section, ref.localId!)}>
                Add Local Point
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const allGlobalIdsBySection: Record<SectionKey, string[]> = {
    education: global.sections.education.map((item) => item.id),
    skills: global.sections.skills.map((item) => item.id),
    experience: global.sections.experience.map((item) => item.id),
    projects: global.sections.projects.map((item) => item.id),
    openSource: global.sections.openSource.map((item) => item.id),
  };

  const usedGlobalIdsBySection: Record<SectionKey, Set<string>> = {
    education: new Set(draft.sections.education.map((ref) => ref.globalId).filter(Boolean) as string[]),
    skills: new Set(draft.sections.skills.map((ref) => ref.globalId).filter(Boolean) as string[]),
    experience: new Set(draft.sections.experience.map((ref) => ref.globalId).filter(Boolean) as string[]),
    projects: new Set(draft.sections.projects.map((ref) => ref.globalId).filter(Boolean) as string[]),
    openSource: new Set(draft.sections.openSource.map((ref) => ref.globalId).filter(Boolean) as string[]),
  };

  const availableGlobalIds = (section: SectionKey): string[] => {
    return allGlobalIdsBySection[section].filter(
      (id) => !usedGlobalIdsBySection[section].has(id),
    );
  };

  const [pendingAdd, setPendingAdd] = useState<Record<SectionKey, string>>({
    education: '',
    skills: '',
    experience: '',
    projects: '',
    openSource: '',
  });

  const displayedPdfUrlRaw = snapshot?.pdfUrl ?? detail.pdfUrl;
  const displayedPdfUrl = displayedPdfUrlRaw ? buildPdfPreviewUrl(displayedPdfUrlRaw) : undefined;

  return (
    <div className="studio-shell">
      <div className="studio-toolbar">
        <div>
          <h2>{detail.resume.name}</h2>
          <p>
            Last compile: {formatDateTime(detail.resume.lastCompiledAt)} | status:{' '}
            {detail.resume.lastCompileStatus ?? 'unknown'}
          </p>
        </div>
        <div className="row-actions">
          <button onClick={() => setMode('blocks')} className={mode === 'blocks' ? 'active' : ''}>
            Block View
          </button>
          <button onClick={() => setMode('latex')} className={mode === 'latex' ? 'active' : ''}>
            LaTeX View
          </button>
          <button onClick={onCompile} disabled={busy}>
            Compile Resume
          </button>
          <button onClick={saveDraft} disabled={!hasDraftChanges || busy}>
            Save Blocks
          </button>
        </div>
      </div>

      <div className="studio-grid">
        <div className="studio-left">
          {mode === 'blocks' ? (
            <div className="stack">
              {draft.sectionOrder.map((section) => (
                <div
                  key={section}
                  className="section-stack"
                  style={{ borderColor: sectionColors[section] }}
                >
                  <div className="section-stack-header">
                    <h3>{sectionTitles[section]}</h3>
                    <div className="row-actions">
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={draft.sectionVisibility[section]}
                          onChange={() => toggleSectionVisibility(section)}
                        />
                        Visible
                      </label>
                      <button onClick={() => moveSection(section, -1)}>Up</button>
                      <button onClick={() => moveSection(section, 1)}>Down</button>
                    </div>
                  </div>

                  <div className="stack">
                    {draft.sections[section].map((_, idx) => renderEntryBlock(section, idx))}
                  </div>

                  <div className="section-actions">
                    <select
                      value={pendingAdd[section]}
                      onChange={(e) =>
                        setPendingAdd((prev) => ({ ...prev, [section]: e.target.value }))
                      }
                    >
                      <option value="">Add existing global block...</option>
                      {availableGlobalIds(section).map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const id = pendingAdd[section];
                        if (!id) {
                          return;
                        }
                        addGlobalRef(section, id);
                        setPendingAdd((prev) => ({ ...prev, [section]: '' }));
                      }}
                      disabled={!pendingAdd[section]}
                    >
                      Add Global Block
                    </button>
                    <button onClick={() => addLocalEntry(section)}>Add Local Block</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="code-pane">
              <div className="row-actions">
                <button
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onSaveCustomLatex(latexDraft);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  Save as Custom LaTeX
                </button>
                <button
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onClearCustomLatex();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  Clear Custom LaTeX
                </button>
              </div>
              <Editor
                height="72vh"
                defaultLanguage="latex"
                value={latexDraft}
                onChange={(value) => setLatexDraft(value ?? '')}
                options={{
                  minimap: { enabled: false },
                  fontFamily: 'IBM Plex Mono',
                  fontSize: 13,
                  wordWrap: 'on',
                }}
              />
            </div>
          )}

          <div className="history-panel">
            <h3>History</h3>
            <div className="history-list">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  className={snapshot?.commitHash === entry.commitHash ? 'active' : ''}
                  onClick={() => onLoadSnapshot(entry.commitHash)}
                >
                  <strong>{entry.message}</strong>
                  <span>{formatDateTime(entry.createdAt)}</span>
                  <span className="hash">{entry.commitHash.slice(0, 10)}</span>
                </button>
              ))}
              {!history.length && <p>No history yet.</p>}
            </div>
          </div>
        </div>

        <div className="studio-right">
          <div className="preview-header">
            <h3>{snapshot ? `Snapshot ${snapshot.commitHash.slice(0, 10)}` : 'Current PDF'}</h3>
            <p>
              {snapshot
                ? 'Historical snapshot is rendered from Git commit data.'
                : 'Live compile preview'}
            </p>
          </div>
          {displayedPdfUrl ? (
            <iframe key={displayedPdfUrl} src={displayedPdfUrl} title="Resume PDF Preview" />
          ) : (
            <div className="preview-empty">
              <p>No PDF available yet.</p>
              <p>Compile this resume after installing a LaTeX compiler or Docker image.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppStateResponse | null>(null);
  const [draftGlobal, setDraftGlobal] = useState<GlobalCatalog | null>(null);
  const [draftSettings, setDraftSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('resumes');
  const [selectedResumeId, setSelectedResumeId] = useState<string | undefined>();
  const [detail, setDetail] = useState<ResumeDetailResponse | null>(null);
  const [history, setHistory] = useState<CommitEvent[]>([]);
  const [snapshot, setSnapshot] = useState<{
    commitHash: string;
    latex: string;
    pdfUrl?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');

  const loadState = async () => {
    const next = await getState();
    const sorted = { ...next, resumes: sortByName(next.resumes) };
    setState(sorted);
    setDraftGlobal((prev) => prev ?? deepClone(sorted.global));
    setDraftSettings((prev) => prev ?? deepClone(sorted.settings));

    if (!selectedResumeId && sorted.resumes.length > 0) {
      setSelectedResumeId(sorted.resumes[0].id);
    }
  };

  const loadResumeContext = async (resumeId: string) => {
    const [detailResponse, historyResponse] = await Promise.all([
      getResumeDetail(resumeId),
      getHistory(resumeId),
    ]);
    setDetail(detailResponse);
    setHistory(historyResponse);
    setSnapshot(null);
  };

  useEffect(() => {
    setLoading(true);
    loadState()
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load state');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedResumeId) {
      return;
    }
    setLoading(true);
    loadResumeContext(selectedResumeId)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load resume details');
      })
      .finally(() => setLoading(false));
  }, [selectedResumeId]);

  const globalDirty = useMemo(() => {
    if (!state || !draftGlobal) {
      return false;
    }
    return JSON.stringify(state.global) !== JSON.stringify(draftGlobal);
  }, [state, draftGlobal]);

  const settingsDirty = useMemo(() => {
    if (!state || !draftSettings) {
      return false;
    }
    return JSON.stringify(state.settings) !== JSON.stringify(draftSettings);
  }, [state, draftSettings]);

  const withTask = async (task: () => Promise<void>) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const commitGlobal = async () => {
    if (!draftGlobal) {
      return;
    }

    await withTask(async () => {
      const updated = await saveGlobal(
        draftGlobal,
        'Commit global section edits and compile affected resumes',
      );
      const sorted = { ...updated, resumes: sortByName(updated.resumes) };
      setState(sorted);
      setDraftGlobal(deepClone(sorted.global));
      setDraftSettings((prev) => prev ?? deepClone(sorted.settings));

      if (selectedResumeId) {
        await loadResumeContext(selectedResumeId);
      }

      setNotice('Global commit complete. Affected resumes were recompiled.');
    });
  };

  const commitSettings = async () => {
    if (!draftSettings) {
      return;
    }

    await withTask(async () => {
      const saved = await saveSettings({
        exportPdfDir: draftSettings.exportPdfDir,
      });
      setDraftSettings(deepClone(saved));
      setState((prev) => (prev ? { ...prev, settings: saved } : prev));
      setNotice('PDF sync folder saved. Existing compiled PDFs were synchronized.');
    });
  };

  const handleCreateResume = async (name: string, sourceResumeId?: string) => {
    await withTask(async () => {
      const created = await createResume(name, sourceResumeId);
      const latest = await getState();
      const sorted = { ...latest, resumes: sortByName(latest.resumes) };
      setState(sorted);
      setDraftGlobal(deepClone(sorted.global));
      setDraftSettings((prev) => prev ?? deepClone(sorted.settings));
      setSelectedResumeId(created.resume.id);
      setDetail(created);
      setActiveTab('resumes');
      setNotice(`Created ${name}`);
    });
  };

  const handleSaveResume = async (resume: ResumeDocument, message: string) => {
    if (!selectedResumeId) {
      return;
    }

    await withTask(async () => {
      const updated = await updateResume(selectedResumeId, resume, message);
      setDetail(updated);
      const latest = await getState();
      const sorted = { ...latest, resumes: sortByName(latest.resumes) };
      setState(sorted);
      setDraftGlobal((prev) => prev ?? deepClone(sorted.global));
      setDraftSettings((prev) => prev ?? deepClone(sorted.settings));
      setHistory(await getHistory(selectedResumeId));
      setSnapshot(null);
      setNotice('Resume block changes saved and compiled.');
    });
  };

  const handleCompileResume = async () => {
    if (!selectedResumeId) {
      return;
    }

    await withTask(async () => {
      const updated = await compileResume(selectedResumeId, `Manual compile ${selectedResumeId}`);
      setDetail(updated);
      const latest = await getState();
      const sorted = { ...latest, resumes: sortByName(latest.resumes) };
      setState(sorted);
      setDraftSettings((prev) => prev ?? deepClone(sorted.settings));
      setNotice('Resume compilation finished.');
    });
  };

  const handleCompileAllResumes = async () => {
    await withTask(async () => {
      const updated = await compileAllResumes(
        'Compile all resumes from dashboard action',
      );
      const sorted = { ...updated, resumes: sortByName(updated.resumes) };
      setState(sorted);
      setDraftGlobal((prev) => prev ?? deepClone(sorted.global));
      setDraftSettings((prev) => prev ?? deepClone(sorted.settings));

      if (selectedResumeId) {
        await loadResumeContext(selectedResumeId);
      }

      setNotice('Compiled all resumes.');
    });
  };

  const handleOverridePoint = async (
    section: SectionKey,
    refId: string,
    pointId: string,
    currentText: string,
  ) => {
    if (!selectedResumeId) {
      return;
    }

    await withTask(async () => {
      const updated = await overridePoint(selectedResumeId, {
        section,
        refId,
        pointId,
        text: plainToLatexText(currentText),
      });
      setDetail(updated);
      const latest = await getState();
      const sorted = { ...latest, resumes: sortByName(latest.resumes) };
      setState(sorted);
      setDraftSettings((prev) => prev ?? deepClone(sorted.settings));
      setHistory(await getHistory(selectedResumeId));
      setSnapshot(null);
      setNotice('Created resume-only point override.');
    });
  };

  const handleSaveCustomLatex = async (latex: string) => {
    if (!selectedResumeId) {
      return;
    }

    await withTask(async () => {
      const updated = await saveCustomLatex(selectedResumeId, latex);
      setDetail(updated);
      setHistory(await getHistory(selectedResumeId));
      setSnapshot(null);
      setNotice('Custom LaTeX saved and compiled.');
    });
  };

  const handleClearCustomLatex = async () => {
    if (!selectedResumeId) {
      return;
    }

    await withTask(async () => {
      const updated = await clearCustomLatex(selectedResumeId);
      setDetail(updated);
      setHistory(await getHistory(selectedResumeId));
      setSnapshot(null);
      setNotice('Custom LaTeX removed. Generated template is active again.');
    });
  };

  const handleLoadSnapshot = async (commitHash: string) => {
    if (!selectedResumeId) {
      return;
    }

    await withTask(async () => {
      const snap = await getHistorySnapshot(selectedResumeId, commitHash);
      setSnapshot({ commitHash, latex: snap.latex, pdfUrl: snap.pdfUrl });
      setNotice(`Loaded snapshot ${commitHash.slice(0, 10)}.`);
    });
  };

  if (!state || !draftGlobal || !draftSettings) {
    return (
      <div className="centered-screen">
        <h1>Resume Automator</h1>
        <p>{loading ? 'Loading...' : 'No data available'}</p>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Resume Automator</h1>
          <p>Git-backed LaTeX resume studio</p>
        </div>

        <nav className="tab-strip">
          {tabOrder.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'active' : ''}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={commitGlobal} disabled={!globalDirty || loading}>
            {globalDirty ? 'Commit Global Changes' : 'No Global Changes'}
          </button>
          <p>Compiles impacted resumes and records Git history.</p>
        </div>
      </aside>

      <main className="main-area">
        <header className="top-bar">
          <div>
            <strong>Workspace</strong>
            <p>
              {selectedResumeId
                ? `Selected resume: ${selectedResumeId}`
                : 'Select a resume to open studio'}
            </p>
          </div>
          <div className="status-area">
            {loading && <span className="badge">Working...</span>}
            {notice && <span className="badge success">{notice}</span>}
            {error && <span className="badge error">{error}</span>}
          </div>
        </header>

        <section className="content-area">
          {activeTab === 'resumes' && (
            <>
              <ResumesTab
                resumes={state.resumes}
                selectedId={selectedResumeId}
                onSelect={(id) => {
                  setSelectedResumeId(id);
                  setActiveTab('resumes');
                }}
                onCreate={handleCreateResume}
                onCompileAll={handleCompileAllResumes}
                compilingAll={loading}
              />

              {detail && selectedResumeId === detail.resume.id && (
                <ResumeStudio
                  global={draftGlobal}
                  detail={detail}
                  history={history}
                  onSaveResume={handleSaveResume}
                  onCompile={handleCompileResume}
                  onOverridePoint={handleOverridePoint}
                  onSaveCustomLatex={handleSaveCustomLatex}
                  onClearCustomLatex={handleClearCustomLatex}
                  onLoadSnapshot={handleLoadSnapshot}
                  snapshot={snapshot}
                />
              )}
            </>
          )}

          {activeTab === 'header' && (
            <HeaderEditor global={draftGlobal} onChange={setDraftGlobal} />
          )}
          {activeTab === 'output' && (
            <OutputSettingsEditor
              settings={draftSettings}
              onChange={setDraftSettings}
              onSave={commitSettings}
              saving={loading}
              dirty={settingsDirty}
            />
          )}
          {activeTab === 'education' && (
            <EducationEditor global={draftGlobal} onChange={setDraftGlobal} />
          )}
          {activeTab === 'skills' && (
            <SkillsEditor global={draftGlobal} onChange={setDraftGlobal} />
          )}
          {activeTab === 'experience' && (
            <ExperienceEditor global={draftGlobal} onChange={setDraftGlobal} />
          )}
          {activeTab === 'projects' && (
            <ProjectsEditor global={draftGlobal} onChange={setDraftGlobal} />
          )}
          {activeTab === 'openSource' && (
            <OpenSourceEditor global={draftGlobal} onChange={setDraftGlobal} />
          )}
        </section>
      </main>
    </div>
  );
}
