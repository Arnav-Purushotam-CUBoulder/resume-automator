import {
  GlobalCatalog,
  ResumeDocument,
  ResumeLocalEntities,
  SectionKey,
} from '../domain/types.js';

function emptyLocalEntities(): ResumeLocalEntities {
  return {
    points: {},
    education: [],
    skills: [],
    openSource: [],
    projects: [],
    experience: [],
  };
}

export function createSeedGlobal(now: string): GlobalCatalog {
  return {
    header: {
      name: 'ARNAV PURUSHOTAM',
      phone: '720-351-1267',
      email: 'arnavpsusa@gmail.com',
      linkedinUrl: 'https://www.linkedin.com/in/arnav-purushotam-2375aa203/',
      linkedinLabel: 'LinkedIn',
      githubUrl: 'https://github.com/Arnav-Purushotam-CUBoulder',
      githubLabel: 'GitHub',
      location: 'Boulder, CO, USA',
    },
    contactVariants: {
      emails: ['arnavpsusa@gmail.com'],
      locations: ['Boulder, CO, USA'],
    },
    spacing: {
      headerToFirstSectionPt: -20,
      betweenSectionsPt: -10,
      afterSectionTitlePt: -5,
      topMarginIn: 0.5,
      bottomMarginIn: 0.5,
    },
    points: {
      pt_os_curl_32bit: {
        id: 'pt_os_curl_32bit',
        text:
          'Contributed upstream fixes to \\textbf{curl/libcurl} (large-scale, production, public-facing C codebase), hardening the \\texttt{curl.h} public API bitmask macros against LP64 type-width pitfalls by constraining “ANY/ALL” masks to a \\textbf{32-bit flag domain}, ensuring consistent behavior across 32/64-bit platforms. (\\href{https://github.com/curl/curl/pull/20416}{PR \\#20416})',
      },
      pt_os_curl_woverflow: {
        id: 'pt_os_curl_woverflow',
        text:
          'Eliminated \\textbf{GCC 15.2} \\texttt{-Woverflow/-Wconversion} failures (often promoted to \\texttt{-Werror} in CI) by preventing unintended high-bit propagation from \\texttt{\\textasciitilde{}mask} / \\texttt{\\textasciitilde{}0L} patterns, making auth/protocol/SSH option masks \\textbf{warning-free, portable, and stable} when stored in 32-bit contexts.',
      },
      pt_os_curl_trace: {
        id: 'pt_os_curl_trace',
        text:
          'Proposed and validated a cross-compiler logging strategy that enabled \\textbf{CURL\\_DISABLE\\_VERBOSE\\_STRINGS} to truly compile out verbose trace format strings on \\textbf{MSVC/Windows} via C99-style variadic trace macros; collaborated in public review with maintainers and was \\textbf{credited in the final upstream solution}. (\\href{https://github.com/curl/curl/pull/20387}{PR \\#20387})',
      },
      pt_project_db_1: {
        id: 'pt_project_db_1',
        text:
          'Built a modular database engine in modern C++ (C++17/20): an in-memory hash map and a file-backed key–value store delivering $O(1)$ lookups with durable writes; benchmarked against Redis to sanity-check throughput and latency.',
      },
      pt_project_db_2: {
        id: 'pt_project_db_2',
        text:
          'Designed a pluggable storage layer (PIMPL) to swap memory, disk, and cached-disk backends without changing call sites—setting the stage for sharding and future distribution.',
      },
      pt_project_db_3: {
        id: 'pt_project_db_3',
        text:
          'Added secondary indexes, bucketed namespaces, and templated key/value types (C++20 concepts) to enable fast searches over STL containers with zero-copy paths where possible.',
      },
      pt_project_db_4: {
        id: 'pt_project_db_4',
        text:
          'Automated cross-platform builds and tests with CMake and Catch2, using GitHub CLI; verified on Linux (GCC/Clang), macOS (Clang), and Windows (MSVC).',
      },
      pt_project_db_5: {
        id: 'pt_project_db_5',
        text: 'Used complexity analysis to guide performance trade-offs.',
      },
      pt_exp_bio_1: {
        id: 'pt_exp_bio_1',
        text:
          'Built an LLM AI Agent with RAG, LangChain and python integrating many databases and docs, enabling natural language queries over multiple data sources and saving researchers ~30 minutes per complex request.',
      },
      pt_exp_bio_2: {
        id: 'pt_exp_bio_2',
        text:
          'Automated shift scheduling for \\textbf{200 CU Stores employees} on \\textbf{AWS} by ingesting Excel availability/requirements from S3 and generating assignments via a 3-stage Airflow pipeline, replacing manual scheduling and delivering schedules end-to-end in \\textasciitilde{}5 minutes/run (EC2/Flask trigger, Lambda, RDS, SQS, DynamoDB, SES).',
      },
      pt_exp_bio_3: {
        id: 'pt_exp_bio_3',
        text:
          'Worked on the BioBit internal platform using Java Spring Boot, Maven, HTTP RESTful APIs, PostgreSQL, Docker for 10+ labs and over 100 researchers, significantly accelerating research productivity with a scalable, distributed microservices architecture.',
      },
      pt_exp_bio_4: {
        id: 'pt_exp_bio_4',
        text:
          'Implemented OAuth2-based authentication and multi-tenancy with Keycloak, enforcing secure role based access control (RBAC) for 10+ labs and 100 researchers-boosting usability, data privacy, security.',
      },
    },
    sections: {
      education: [
        {
          id: 'edu_cu_boulder',
          institution: 'University of Colorado, Boulder',
          rightMeta: 'Boulder, USA \\textbar\\ August 2024 -- May 2026',
          degree: 'MS, Computer Science',
          detail: 'GPA: 3.9/4.0',
        },
        {
          id: 'edu_bms',
          institution: 'BMS College of Engineering',
          rightMeta: 'Bengaluru, India \\textbar\\ July 2020 -- July 2024',
          degree: 'B.E., Computer Science',
          detail: 'GPA: 4.0/4.0',
        },
      ],
      skills: [
        {
          id: 'skill_languages',
          label: 'Programming Languages',
          value: 'Python, C/C++, Java',
        },
        {
          id: 'skill_web',
          label: 'Web Development',
          value: 'Flask, REST APIs, Agentic AI LLMs, Langchain, SpringBoot',
        },
        {
          id: 'skill_tools',
          label: 'Tools \\& Technologies',
          value: 'CMake, Git, Docker, CI/CD, Kubernetes, AWS',
        },
        {
          id: 'skill_databases',
          label: 'Databases',
          value: 'PostgreSQL, MongoDB',
        },
      ],
      openSource: [
        {
          id: 'os_curl',
          title: '\\href{https://github.com/curl/curl}{curl/libcurl}',
          dateRange: 'Nov 2025 -- Present',
          role: 'Open Source Contributor (C / Portability / Toolchains)',
          link: 'https://github.com/curl/curl',
          pointIds: ['pt_os_curl_32bit', 'pt_os_curl_woverflow', 'pt_os_curl_trace'],
        },
      ],
      projects: [
        {
          id: 'project_cpp_db',
          title: 'Modular C++ Database Engine',
          dateRange: 'August 2025 -- September 2025',
          link:
            '\\href{https://github.com/Arnav-Purushotam-CUBoulder/cpp-db-engine}{https://github.com/Arnav-Purushotam-CUBoulder/cpp-db-engine}',
          pointIds: [
            'pt_project_db_1',
            'pt_project_db_2',
            'pt_project_db_3',
            'pt_project_db_4',
            'pt_project_db_5',
          ],
        },
      ],
      experience: [
        {
          id: 'exp_biofrontiers',
          company: 'CU-BioFrontiers',
          dateRange: 'October 2024 -- Present',
          role: 'Software Engineer - Part-time',
          location: '',
          pointIds: ['pt_exp_bio_1', 'pt_exp_bio_2', 'pt_exp_bio_3', 'pt_exp_bio_4'],
        },
      ],
    },
    updatedAt: now,
  };
}

export function createSeedResumes(now: string): ResumeDocument[] {
  const order: SectionKey[] = [
    'education',
    'skills',
    'openSource',
    'projects',
    'experience',
  ];

  return [
    {
      id: 'resume_master',
      templateId: 'resume_master',
      variantEmail: 'arnavpsusa@gmail.com',
      variantLocation: 'Boulder, CO, USA',
      name: 'Master Resume',
      sectionOrder: order,
      sectionVisibility: {
        education: true,
        skills: true,
        openSource: true,
        projects: true,
        experience: true,
      },
      sections: {
        education: [{ globalId: 'edu_cu_boulder' }, { globalId: 'edu_bms' }],
        skills: [
          { globalId: 'skill_languages' },
          { globalId: 'skill_web' },
          { globalId: 'skill_tools' },
          { globalId: 'skill_databases' },
        ],
        openSource: [{ globalId: 'os_curl' }],
        projects: [{ globalId: 'project_cpp_db' }],
        experience: [{ globalId: 'exp_biofrontiers' }],
      },
      headerMode: 'global',
      local: emptyLocalEntities(),
      createdAt: now,
      updatedAt: now,
    },
  ];
}
