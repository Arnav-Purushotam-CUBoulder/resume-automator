import {
  EducationEntry,
  ExperienceEntry,
  OpenSourceEntry,
  ProjectEntry,
  RenderedResumeData,
  SectionKey,
  SkillCategory,
} from '../domain/types.js';

function renderPreamble(): string {
  return String.raw`\documentclass[letterpaper,11pt]{article}
\usepackage[margin=0.5in]{geometry}
\usepackage{xcolor}
\usepackage{latexsym}
\usepackage{enumitem}
\usepackage{verbatim}
\usepackage{hyphenat}
\usepackage[hidelinks]{hyperref}
\usepackage{titlesec}
\usepackage{fancyhdr}
\usepackage{fontawesome}

\setlist[itemize]{itemsep=1pt, topsep=0pt, label=\textbullet}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}
\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{\vspace{-2pt}\bfseries\large}{}{0em}{}[\color{black}\titlerule\vspace{2pt}]

\newcommand{\resumeItem}[1]{\item\small{#1}}
\newcommand{\resumeSubheading}[4]{\vspace{0pt}\item
  \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small #3} & \textit{\small #4} \\
  \end{tabular*}\vspace{-2pt}}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}[leftmargin=0.2in]}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-2pt}}

\begin{document}`;
}

function renderHeader(data: RenderedResumeData): string {
  const header = data.header;
  return String.raw`
\begin{center}
  {\fontsize{30pt}{36pt}\bfseries ${header.name}}\\
  \small
  \faMobile\ ${header.phone} \;|\;
  \faAt\ \href{mailto:${header.email}}{${header.email}} \;|\;
  \faLinkedinSquare\ \href{${header.linkedinUrl}}{${header.linkedinLabel}} \;|\;
  \faGithub\ \href{${header.githubUrl}}{${header.githubLabel}} \;|\;
  \faMapMarker\ ${header.location}
\end{center}`;
}

function renderEducation(entries: EducationEntry[]): string {
  const rows = entries
    .map(
      (entry) => String.raw`  \resumeSubheading
    {${entry.institution}}
    {${entry.rightMeta}}
    {${entry.degree}}
    {${entry.detail}}
`,
    )
    .join('\n');

  return String.raw`
\vspace{-20pt}
\section{Education}
\vspace{-5pt}
\resumeSubHeadingListStart
${rows}\resumeSubHeadingListEnd`;
}

function renderSkills(entries: SkillCategory[]): string {
  const rows = entries
    .map(
      (entry) =>
        String.raw`  \item \textbf{${entry.label}:} ${entry.value}`,
    )
    .join('\n');

  return String.raw`
\vspace{-10pt}
\section{Skills}
\vspace{-5pt}
\begin{itemize}[leftmargin=0.15in, label={}, itemsep=1pt, topsep=0pt, parsep=0pt, partopsep=0pt]
${rows}
\end{itemize}`;
}

function renderPointList(pointIds: string[], points: RenderedResumeData['points']): string {
  const items = pointIds
    .map((pointId) => points[pointId])
    .filter((point) => Boolean(point))
    .map((point) => String.raw`    \resumeItem{${point.text}}`)
    .join('\n');

  return String.raw`  \resumeItemListStart
${items}
  \resumeItemListEnd`;
}

function renderOpenSource(entries: OpenSourceEntry[], points: RenderedResumeData['points']): string {
  const body = entries
    .map(
      (entry) => String.raw`
  \resumeSubheading
    {${entry.title}}{${entry.dateRange}}
    {${entry.role}}{}
${renderPointList(entry.pointIds, points)}
`,
    )
    .join('\n');

  return String.raw`
\vspace{-9pt}
\section{Open Source Contributions}
\vspace{-8pt}
\resumeSubHeadingListStart
${body}\resumeSubHeadingListEnd`;
}

function renderProjects(entries: ProjectEntry[], points: RenderedResumeData['points']): string {
  const body = entries
    .map(
      (entry) => String.raw`
\vspace{7pt}
\resumeSubheading
  {${entry.title}}{${entry.dateRange}}
  {${entry.link}}{}
  \vspace{3pt}
${renderPointList(entry.pointIds, points)}
`,
    )
    .join('\n');

  return String.raw`
\vspace{-10pt}
\section{Projects}
\resumeSubHeadingListStart
\vspace{-13pt}
${body}\resumeSubHeadingListEnd`;
}

function renderExperience(entries: ExperienceEntry[], points: RenderedResumeData['points']): string {
  const body = entries
    .map(
      (entry) => String.raw`
\resumeSubheading
  {${entry.company}}{${entry.dateRange}}
  {${entry.role}}{${entry.location}}

  \vspace{3pt}
${renderPointList(entry.pointIds, points)}
`,
    )
    .join('\n');

  return String.raw`
\vspace{-10pt}
\section{Experience}
\vspace{-5pt}
\resumeSubHeadingListStart
${body}\resumeSubHeadingListEnd`;
}

function renderSection(section: SectionKey, data: RenderedResumeData): string {
  if (!data.sectionVisibility[section]) {
    return '';
  }

  switch (section) {
    case 'education':
      return renderEducation(data.sections.education);
    case 'skills':
      return renderSkills(data.sections.skills);
    case 'openSource':
      return renderOpenSource(data.sections.openSource, data.points);
    case 'projects':
      return renderProjects(data.sections.projects, data.points);
    case 'experience':
      return renderExperience(data.sections.experience, data.points);
    default:
      return '';
  }
}

export function renderLatex(data: RenderedResumeData): string {
  const sections = data.sectionOrder
    .map((section) => renderSection(section, data))
    .filter((section) => section.trim().length > 0)
    .join('\n\n');

  return `${renderPreamble()}\n\n${renderHeader(data)}\n\n${sections}\n\n\\end{document}\n`;
}
