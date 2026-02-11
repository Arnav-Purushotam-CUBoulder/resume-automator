export type SectionKey =
  | 'education'
  | 'skills'
  | 'openSource'
  | 'projects'
  | 'experience';

export type CompileStatus = 'success' | 'failed';

export interface HeaderInfo {
  name: string;
  phone: string;
  email: string;
  linkedinUrl: string;
  linkedinLabel: string;
  githubUrl: string;
  githubLabel: string;
  location: string;
}

export interface Point {
  id: string;
  text: string;
}

export interface EducationEntry {
  id: string;
  institution: string;
  rightMeta: string;
  degree: string;
  detail: string;
}

export interface SkillCategory {
  id: string;
  label: string;
  value: string;
}

export interface ExperienceEntry {
  id: string;
  company: string;
  dateRange: string;
  role: string;
  location: string;
  pointIds: string[];
}

export interface ProjectEntry {
  id: string;
  title: string;
  dateRange: string;
  link: string;
  pointIds: string[];
}

export interface OpenSourceEntry {
  id: string;
  title: string;
  dateRange: string;
  role: string;
  link: string;
  pointIds: string[];
}

export interface GlobalSections {
  education: EducationEntry[];
  skills: SkillCategory[];
  openSource: OpenSourceEntry[];
  projects: ProjectEntry[];
  experience: ExperienceEntry[];
}

export interface GlobalSpacing {
  headerToFirstSectionPt: number;
  betweenSectionsPt: number;
  afterSectionTitlePt: number;
}

export interface GlobalCatalog {
  header: HeaderInfo;
  contactVariants: {
    emails: string[];
    locations: string[];
  };
  spacing: GlobalSpacing;
  points: Record<string, Point>;
  sections: GlobalSections;
  updatedAt: string;
}

export interface SectionRef {
  globalId?: string;
  localId?: string;
  pointOverrides?: Record<string, string>;
  includePointIds?: string[];
}

export interface ResumeLocalEntities {
  points: Record<string, Point>;
  education: EducationEntry[];
  skills: SkillCategory[];
  openSource: OpenSourceEntry[];
  projects: ProjectEntry[];
  experience: ExperienceEntry[];
}

export interface ResumeDocument {
  id: string;
  templateId: string;
  variantEmail: string;
  variantLocation: string;
  name: string;
  sectionOrder: SectionKey[];
  sectionVisibility: Record<SectionKey, boolean>;
  sections: {
    education: SectionRef[];
    skills: SectionRef[];
    openSource: SectionRef[];
    projects: SectionRef[];
    experience: SectionRef[];
  };
  headerMode: 'global' | 'local';
  localHeader?: HeaderInfo;
  local: ResumeLocalEntities;
  customLatex?: string;
  createdAt: string;
  updatedAt: string;
  lastCompiledAt?: string;
  lastCompileStatus?: CompileStatus;
  lastCompileMessage?: string;
}

export interface ResumeSummary {
  id: string;
  templateId: string;
  variantEmail: string;
  variantLocation: string;
  name: string;
  updatedAt: string;
  lastCompiledAt?: string;
  lastCompileStatus?: CompileStatus;
}

export interface CommitEvent {
  id: string;
  createdAt: string;
  message: string;
  commitHash: string;
  affectedResumes: string[];
}

export interface AppSettings {
  exportPdfDir?: string;
  updatedAt: string;
}

export interface RenderedResumeData {
  header: HeaderInfo;
  spacing: GlobalSpacing;
  sections: {
    education: EducationEntry[];
    skills: SkillCategory[];
    openSource: OpenSourceEntry[];
    projects: ProjectEntry[];
    experience: ExperienceEntry[];
  };
  points: Record<string, Point>;
  sectionOrder: SectionKey[];
  sectionVisibility: Record<SectionKey, boolean>;
}
