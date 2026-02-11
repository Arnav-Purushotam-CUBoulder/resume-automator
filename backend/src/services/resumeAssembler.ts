import {
  EducationEntry,
  ExperienceEntry,
  GlobalCatalog,
  OpenSourceEntry,
  ProjectEntry,
  RenderedResumeData,
  ResumeDocument,
  ResumeSummary,
  SectionKey,
  SkillCategory,
} from '../domain/types.js';

function clonePointIdsWithOverrides(
  pointIds: string[],
  pointOverrides: Record<string, string> | undefined,
  includePointIds: string[] | undefined,
): string[] {
  const included = includePointIds?.length
    ? pointIds.filter((pointId) => includePointIds.includes(pointId))
    : [...pointIds];

  if (!pointOverrides) {
    return included;
  }

  return included.map((pointId) => pointOverrides[pointId] ?? pointId);
}

function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  return items.reduce<Record<string, T>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function resolveEducation(
  global: GlobalCatalog,
  resume: ResumeDocument,
): EducationEntry[] {
  const globalIndex = indexById(global.sections.education);
  const localIndex = indexById(resume.local.education);

  return resume.sections.education
    .map((ref) => {
      if (ref.globalId) {
        return globalIndex[ref.globalId];
      }
      if (ref.localId) {
        return localIndex[ref.localId];
      }
      return null;
    })
    .filter((entry): entry is EducationEntry => Boolean(entry));
}

function resolveSkills(global: GlobalCatalog, resume: ResumeDocument): SkillCategory[] {
  const globalIndex = indexById(global.sections.skills);
  const localIndex = indexById(resume.local.skills);

  return resume.sections.skills
    .map((ref) => {
      if (ref.globalId) {
        return globalIndex[ref.globalId];
      }
      if (ref.localId) {
        return localIndex[ref.localId];
      }
      return null;
    })
    .filter((entry): entry is SkillCategory => Boolean(entry));
}

function resolveOpenSource(
  global: GlobalCatalog,
  resume: ResumeDocument,
): OpenSourceEntry[] {
  const globalIndex = indexById(global.sections.openSource);
  const localIndex = indexById(resume.local.openSource);

  return resume.sections.openSource
    .map((ref) => {
      let base: OpenSourceEntry | undefined;
      if (ref.globalId) {
        base = globalIndex[ref.globalId];
      } else if (ref.localId) {
        base = localIndex[ref.localId];
      }

      if (!base) {
        return null;
      }

      return {
        ...base,
        pointIds: clonePointIdsWithOverrides(
          base.pointIds,
          ref.pointOverrides,
          ref.includePointIds,
        ),
      };
    })
    .filter((entry): entry is OpenSourceEntry => Boolean(entry));
}

function resolveProjects(global: GlobalCatalog, resume: ResumeDocument): ProjectEntry[] {
  const globalIndex = indexById(global.sections.projects);
  const localIndex = indexById(resume.local.projects);

  return resume.sections.projects
    .map((ref) => {
      let base: ProjectEntry | undefined;
      if (ref.globalId) {
        base = globalIndex[ref.globalId];
      } else if (ref.localId) {
        base = localIndex[ref.localId];
      }

      if (!base) {
        return null;
      }

      return {
        ...base,
        pointIds: clonePointIdsWithOverrides(
          base.pointIds,
          ref.pointOverrides,
          ref.includePointIds,
        ),
      };
    })
    .filter((entry): entry is ProjectEntry => Boolean(entry));
}

function resolveExperience(
  global: GlobalCatalog,
  resume: ResumeDocument,
): ExperienceEntry[] {
  const globalIndex = indexById(global.sections.experience);
  const localIndex = indexById(resume.local.experience);

  return resume.sections.experience
    .map((ref) => {
      let base: ExperienceEntry | undefined;
      if (ref.globalId) {
        base = globalIndex[ref.globalId];
      } else if (ref.localId) {
        base = localIndex[ref.localId];
      }

      if (!base) {
        return null;
      }

      return {
        ...base,
        pointIds: clonePointIdsWithOverrides(
          base.pointIds,
          ref.pointOverrides,
          ref.includePointIds,
        ),
      };
    })
    .filter((entry): entry is ExperienceEntry => Boolean(entry));
}

export function toResumeSummary(resume: ResumeDocument): ResumeSummary {
  return {
    id: resume.id,
    name: resume.name,
    updatedAt: resume.updatedAt,
    lastCompiledAt: resume.lastCompiledAt,
    lastCompileStatus: resume.lastCompileStatus,
  };
}

export function buildRenderedResumeData(
  global: GlobalCatalog,
  resume: ResumeDocument,
): RenderedResumeData {
  const header = resume.headerMode === 'local' && resume.localHeader
    ? resume.localHeader
    : global.header;

  const mergedPoints = {
    ...global.points,
    ...resume.local.points,
  };

  return {
    header,
    points: mergedPoints,
    sectionOrder: resume.sectionOrder,
    sectionVisibility: resume.sectionVisibility,
    sections: {
      education: resolveEducation(global, resume),
      skills: resolveSkills(global, resume),
      openSource: resolveOpenSource(global, resume),
      projects: resolveProjects(global, resume),
      experience: resolveExperience(global, resume),
    },
  };
}

function refHasPoint(
  refGlobalId: string | undefined,
  section: SectionKey,
  pointId: string,
  global: GlobalCatalog,
): boolean {
  if (!refGlobalId) {
    return false;
  }

  switch (section) {
    case 'experience': {
      const entry = global.sections.experience.find((item) => item.id === refGlobalId);
      return Boolean(entry?.pointIds.includes(pointId));
    }
    case 'projects': {
      const entry = global.sections.projects.find((item) => item.id === refGlobalId);
      return Boolean(entry?.pointIds.includes(pointId));
    }
    case 'openSource': {
      const entry = global.sections.openSource.find((item) => item.id === refGlobalId);
      return Boolean(entry?.pointIds.includes(pointId));
    }
    default:
      return false;
  }
}

function refHasPointInLocalEntry(
  resume: ResumeDocument,
  section: SectionKey,
  localId: string | undefined,
  includePointIds: string[] | undefined,
  pointId: string,
): boolean {
  if (!localId || (section !== 'experience' && section !== 'projects' && section !== 'openSource')) {
    return false;
  }

  const localEntry = resume.local[section].find((item) => item.id === localId);
  if (!localEntry) {
    return false;
  }

  const pointIds = includePointIds?.length
    ? localEntry.pointIds.filter((id) => includePointIds.includes(id))
    : localEntry.pointIds;

  return pointIds.includes(pointId);
}

export function resumesReferencingGlobalPoint(
  resumes: ResumeDocument[],
  global: GlobalCatalog,
  pointId: string,
): ResumeDocument[] {
  return resumes.filter((resume) => {
    const sectionsWithPoints: SectionKey[] = ['experience', 'projects', 'openSource'];
    return sectionsWithPoints.some((section) =>
      resume.sections[section].some((ref) => {
        if (ref.pointOverrides && ref.pointOverrides[pointId]) {
          return false;
        }
        return (
          refHasPoint(ref.globalId, section, pointId, global)
          || refHasPointInLocalEntry(
            resume,
            section,
            ref.localId,
            ref.includePointIds,
            pointId,
          )
        );
      }),
    );
  });
}

export function allSectionKeys(): SectionKey[] {
  return ['education', 'skills', 'openSource', 'projects', 'experience'];
}
