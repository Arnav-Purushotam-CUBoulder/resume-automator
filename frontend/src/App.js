import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import Editor from '@monaco-editor/react';
import { useEffect, useMemo, useState } from 'react';
import { compileAllResumes, clearCustomLatex, compileResume, createResume, getHistory, getHistorySnapshot, getResumeDetail, getState, overridePoint, saveCustomLatex, saveGlobal, saveSettings, updateResume, } from './api/client';
import { deepClone } from './utils/clone';
const tabOrder = [
    'resumes',
    'header',
    'output',
    'experience',
    'education',
    'skills',
    'projects',
    'openSource',
];
const tabLabels = {
    resumes: 'Resumes',
    header: 'Header & Location',
    output: 'PDF Sync',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    projects: 'Projects',
    openSource: 'Open Source',
};
const sectionTitles = {
    education: 'Education',
    skills: 'Skills',
    openSource: 'Open Source Contributions',
    projects: 'Projects',
    experience: 'Experience',
};
const sectionColors = {
    experience: 'var(--section-experience)',
    education: 'var(--section-education)',
    skills: 'var(--section-skills)',
    projects: 'var(--section-projects)',
    openSource: 'var(--section-open-source)',
};
function makeId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function formatDateTime(value) {
    if (!value) {
        return 'Never';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}
function sectionHasPoints(section) {
    return section === 'experience' || section === 'projects' || section === 'openSource';
}
function sortByName(resumes) {
    return [...resumes].sort((a, b) => a.name.localeCompare(b.name));
}
function SectionPanel({ title, subtitle, children }) {
    return (_jsxs("div", { className: "section-panel", children: [_jsxs("div", { className: "section-panel-header", children: [_jsx("h2", { children: title }), _jsx("p", { children: subtitle })] }), children] }));
}
function HeaderEditor({ global, onChange }) {
    const header = global.header;
    const setField = (key, value) => {
        const next = deepClone(global);
        next.header[key] = value;
        onChange(next);
    };
    return (_jsx(SectionPanel, { title: "Header & Location", subtitle: "Changes here update every resume still using the global header.", children: _jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Name", _jsx("input", { value: header.name, onChange: (e) => setField('name', e.target.value) })] }), _jsxs("label", { children: ["Phone", _jsx("input", { value: header.phone, onChange: (e) => setField('phone', e.target.value) })] }), _jsxs("label", { children: ["Email", _jsx("input", { value: header.email, onChange: (e) => setField('email', e.target.value) })] }), _jsxs("label", { children: ["Location", _jsx("input", { value: header.location, onChange: (e) => setField('location', e.target.value) })] }), _jsxs("label", { children: ["LinkedIn URL", _jsx("input", { value: header.linkedinUrl, onChange: (e) => setField('linkedinUrl', e.target.value) })] }), _jsxs("label", { children: ["LinkedIn Label", _jsx("input", { value: header.linkedinLabel, onChange: (e) => setField('linkedinLabel', e.target.value) })] }), _jsxs("label", { children: ["GitHub URL", _jsx("input", { value: header.githubUrl, onChange: (e) => setField('githubUrl', e.target.value) })] }), _jsxs("label", { children: ["GitHub Label", _jsx("input", { value: header.githubLabel, onChange: (e) => setField('githubLabel', e.target.value) })] })] }) }));
}
function OutputSettingsEditor({ settings, onChange, onSave, saving, dirty, }) {
    const chooseFolderAvailable = typeof window !== 'undefined' && Boolean(window.desktopApi?.chooseFolder);
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
    return (_jsxs(SectionPanel, { title: "PDF Sync Folder", subtitle: "Set your iCloud folder path. After successful compile, changed resumes replace their PDF in this folder.", children: [_jsx("div", { className: "field-grid", children: _jsxs("label", { children: ["iCloud / Export Folder Path", _jsx("input", { placeholder: "/Users/your-user/Library/Mobile Documents/com~apple~CloudDocs/Resumes", value: settings.exportPdfDir ?? '', onChange: (e) => onChange({
                                ...settings,
                                exportPdfDir: e.target.value,
                            }) })] }) }), _jsxs("div", { className: "row-actions", children: [chooseFolderAvailable && _jsx("button", { onClick: chooseFolder, children: "Choose Folder" }), _jsx("button", { onClick: onSave, disabled: saving || !dirty, children: saving ? 'Saving...' : dirty ? 'Save Sync Folder' : 'Sync Folder Saved' })] }), _jsx("p", { className: "muted-note", children: "Only changed resumes are replaced. Existing PDFs for unchanged resumes are left as-is." })] }));
}
function EducationEditor({ global, onChange }) {
    const education = global.sections.education;
    const patchEntry = (idx, key, value) => {
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
    const removeEntry = (idx) => {
        const next = deepClone(global);
        next.sections.education.splice(idx, 1);
        onChange(next);
    };
    return (_jsxs(SectionPanel, { title: "Education", subtitle: "Maintain all education blocks used by resume variants.", children: [_jsx("div", { className: "stack", children: education.map((entry, idx) => (_jsxs("div", { className: "editor-card", children: [_jsxs("div", { className: "editor-card-header", children: [_jsx("strong", { children: entry.institution || 'Education Entry' }), _jsx("button", { onClick: () => removeEntry(idx), className: "danger", children: "Remove" })] }), _jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Institution", _jsx("input", { value: entry.institution, onChange: (e) => patchEntry(idx, 'institution', e.target.value) })] }), _jsxs("label", { children: ["Right Meta", _jsx("input", { value: entry.rightMeta, onChange: (e) => patchEntry(idx, 'rightMeta', e.target.value) })] }), _jsxs("label", { children: ["Degree", _jsx("input", { value: entry.degree, onChange: (e) => patchEntry(idx, 'degree', e.target.value) })] }), _jsxs("label", { children: ["Detail", _jsx("input", { value: entry.detail, onChange: (e) => patchEntry(idx, 'detail', e.target.value) })] })] })] }, entry.id))) }), _jsx("button", { onClick: addEntry, children: "Add Education Entry" })] }));
}
function SkillsEditor({ global, onChange }) {
    const skills = global.sections.skills;
    const patchEntry = (idx, key, value) => {
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
    const removeEntry = (idx) => {
        const next = deepClone(global);
        next.sections.skills.splice(idx, 1);
        onChange(next);
    };
    return (_jsxs(SectionPanel, { title: "Skills", subtitle: "These rows map directly to your LaTeX skills item list.", children: [_jsx("div", { className: "stack", children: skills.map((entry, idx) => (_jsxs("div", { className: "editor-card", children: [_jsxs("div", { className: "editor-card-header", children: [_jsx("strong", { children: entry.label || 'Skills Row' }), _jsx("button", { onClick: () => removeEntry(idx), className: "danger", children: "Remove" })] }), _jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Label", _jsx("input", { value: entry.label, onChange: (e) => patchEntry(idx, 'label', e.target.value) })] }), _jsxs("label", { children: ["Value", _jsx("input", { value: entry.value, onChange: (e) => patchEntry(idx, 'value', e.target.value) })] })] })] }, entry.id))) }), _jsx("button", { onClick: addEntry, children: "Add Skills Row" })] }));
}
function ExperienceEditor({ global, onChange }) {
    const experience = global.sections.experience;
    const patchEntry = (idx, key, value) => {
        const next = deepClone(global);
        next.sections.experience[idx][key] = value;
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
    const addPoint = (idx) => {
        const next = deepClone(global);
        const pointId = makeId('pt');
        next.points[pointId] = {
            id: pointId,
            text: 'New bullet point',
        };
        next.sections.experience[idx].pointIds.push(pointId);
        onChange(next);
    };
    const removePoint = (idx, pointId) => {
        const next = deepClone(global);
        next.sections.experience[idx].pointIds = next.sections.experience[idx].pointIds.filter((id) => id !== pointId);
        onChange(next);
    };
    const patchPoint = (pointId, value) => {
        const next = deepClone(global);
        next.points[pointId] = { ...next.points[pointId], text: value };
        onChange(next);
    };
    const removeExperience = (idx) => {
        const next = deepClone(global);
        next.sections.experience.splice(idx, 1);
        onChange(next);
    };
    return (_jsxs(SectionPanel, { title: "Experience", subtitle: "Edit global roles and points. Commit compiles resumes that reference changed content.", children: [_jsx("div", { className: "stack", children: experience.map((entry, idx) => (_jsxs("div", { className: "editor-card", children: [_jsxs("div", { className: "editor-card-header", children: [_jsx("strong", { children: entry.company || 'Experience Entry' }), _jsx("button", { onClick: () => removeExperience(idx), className: "danger", children: "Remove" })] }), _jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Company", _jsx("input", { value: entry.company, onChange: (e) => patchEntry(idx, 'company', e.target.value) })] }), _jsxs("label", { children: ["Date Range", _jsx("input", { value: entry.dateRange, onChange: (e) => patchEntry(idx, 'dateRange', e.target.value) })] }), _jsxs("label", { children: ["Role", _jsx("input", { value: entry.role, onChange: (e) => patchEntry(idx, 'role', e.target.value) })] }), _jsxs("label", { children: ["Right-side secondary line", _jsx("input", { value: entry.location, onChange: (e) => patchEntry(idx, 'location', e.target.value) })] })] }), _jsxs("div", { className: "points-list", children: [_jsx("h4", { children: "Points" }), entry.pointIds.map((pointId) => (_jsxs("div", { className: "point-row", children: [_jsx("textarea", { value: global.points[pointId]?.text ?? '', onChange: (e) => patchPoint(pointId, e.target.value) }), _jsx("button", { className: "danger", onClick: () => removePoint(idx, pointId), children: "Remove" })] }, pointId))), _jsx("button", { onClick: () => addPoint(idx), children: "Add Point" })] })] }, entry.id))) }), _jsx("button", { onClick: addExperience, children: "Add Experience" })] }));
}
function ProjectsEditor({ global, onChange }) {
    const projects = global.sections.projects;
    const patchEntry = (idx, key, value) => {
        const next = deepClone(global);
        next.sections.projects[idx][key] = value;
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
    const removeProject = (idx) => {
        const next = deepClone(global);
        next.sections.projects.splice(idx, 1);
        onChange(next);
    };
    const patchPoint = (pointId, value) => {
        const next = deepClone(global);
        next.points[pointId] = { ...next.points[pointId], text: value };
        onChange(next);
    };
    const addPoint = (idx) => {
        const next = deepClone(global);
        const pointId = makeId('pt');
        next.points[pointId] = { id: pointId, text: 'New project bullet point' };
        next.sections.projects[idx].pointIds.push(pointId);
        onChange(next);
    };
    const removePoint = (idx, pointId) => {
        const next = deepClone(global);
        next.sections.projects[idx].pointIds = next.sections.projects[idx].pointIds.filter((id) => id !== pointId);
        onChange(next);
    };
    return (_jsxs(SectionPanel, { title: "Projects", subtitle: "Project blocks are rendered with the same `resumeSubheading` + bullet layout.", children: [_jsx("div", { className: "stack", children: projects.map((entry, idx) => (_jsxs("div", { className: "editor-card", children: [_jsxs("div", { className: "editor-card-header", children: [_jsx("strong", { children: entry.title || 'Project Entry' }), _jsx("button", { onClick: () => removeProject(idx), className: "danger", children: "Remove" })] }), _jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Title", _jsx("input", { value: entry.title, onChange: (e) => patchEntry(idx, 'title', e.target.value) })] }), _jsxs("label", { children: ["Date Range", _jsx("input", { value: entry.dateRange, onChange: (e) => patchEntry(idx, 'dateRange', e.target.value) })] }), _jsxs("label", { className: "span-2", children: ["Link LaTeX", _jsx("input", { value: entry.link, onChange: (e) => patchEntry(idx, 'link', e.target.value) })] })] }), _jsxs("div", { className: "points-list", children: [_jsx("h4", { children: "Points" }), entry.pointIds.map((pointId) => (_jsxs("div", { className: "point-row", children: [_jsx("textarea", { value: global.points[pointId]?.text ?? '', onChange: (e) => patchPoint(pointId, e.target.value) }), _jsx("button", { className: "danger", onClick: () => removePoint(idx, pointId), children: "Remove" })] }, pointId))), _jsx("button", { onClick: () => addPoint(idx), children: "Add Point" })] })] }, entry.id))) }), _jsx("button", { onClick: addProject, children: "Add Project" })] }));
}
function OpenSourceEditor({ global, onChange }) {
    const openSource = global.sections.openSource;
    const patchEntry = (idx, key, value) => {
        const next = deepClone(global);
        next.sections.openSource[idx][key] = value;
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
    const removeEntry = (idx) => {
        const next = deepClone(global);
        next.sections.openSource.splice(idx, 1);
        onChange(next);
    };
    const patchPoint = (pointId, value) => {
        const next = deepClone(global);
        next.points[pointId] = { ...next.points[pointId], text: value };
        onChange(next);
    };
    const addPoint = (idx) => {
        const next = deepClone(global);
        const pointId = makeId('pt');
        next.points[pointId] = { id: pointId, text: 'New open source point' };
        next.sections.openSource[idx].pointIds.push(pointId);
        onChange(next);
    };
    const removePoint = (idx, pointId) => {
        const next = deepClone(global);
        next.sections.openSource[idx].pointIds = next.sections.openSource[idx].pointIds.filter((id) => id !== pointId);
        onChange(next);
    };
    return (_jsxs(SectionPanel, { title: "Open Source Contributions", subtitle: "Track contribution blocks separately from work experience and projects.", children: [_jsx("div", { className: "stack", children: openSource.map((entry, idx) => (_jsxs("div", { className: "editor-card", children: [_jsxs("div", { className: "editor-card-header", children: [_jsx("strong", { children: entry.title || 'Open Source Entry' }), _jsx("button", { onClick: () => removeEntry(idx), className: "danger", children: "Remove" })] }), _jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Title LaTeX", _jsx("input", { value: entry.title, onChange: (e) => patchEntry(idx, 'title', e.target.value) })] }), _jsxs("label", { children: ["Date Range", _jsx("input", { value: entry.dateRange, onChange: (e) => patchEntry(idx, 'dateRange', e.target.value) })] }), _jsxs("label", { children: ["Role", _jsx("input", { value: entry.role, onChange: (e) => patchEntry(idx, 'role', e.target.value) })] }), _jsxs("label", { children: ["Link", _jsx("input", { value: entry.link, onChange: (e) => patchEntry(idx, 'link', e.target.value) })] })] }), _jsxs("div", { className: "points-list", children: [_jsx("h4", { children: "Points" }), entry.pointIds.map((pointId) => (_jsxs("div", { className: "point-row", children: [_jsx("textarea", { value: global.points[pointId]?.text ?? '', onChange: (e) => patchPoint(pointId, e.target.value) }), _jsx("button", { className: "danger", onClick: () => removePoint(idx, pointId), children: "Remove" })] }, pointId))), _jsx("button", { onClick: () => addPoint(idx), children: "Add Point" })] })] }, entry.id))) }), _jsx("button", { onClick: addEntry, children: "Add Open Source Entry" })] }));
}
function ResumesTab({ resumes, selectedId, onSelect, onCreate, onCompileAll, compilingAll, }) {
    const [name, setName] = useState('');
    const [sourceResumeId, setSourceResumeId] = useState(selectedId);
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
        }
        finally {
            setCreating(false);
        }
    };
    return (_jsxs(SectionPanel, { title: "Resumes", subtitle: "Open any resume to edit blocks, inspect LaTeX, compile, and browse version history.", children: [_jsx("div", { className: "resume-grid", children: resumes.map((resume) => (_jsxs("button", { className: `resume-card ${resume.id === selectedId ? 'selected' : ''}`, onClick: () => onSelect(resume.id), children: [_jsx("div", { className: "resume-card-top", children: _jsx("span", { className: `badge ${resume.lastCompileStatus === 'success'
                                    ? 'success'
                                    : resume.lastCompileStatus === 'failed'
                                        ? 'error'
                                        : ''}`, children: resume.lastCompileStatus ?? 'not compiled' }) }), _jsx("h3", { className: "resume-name-full", title: resume.name, children: resume.name }), _jsxs("p", { children: ["Updated: ", formatDateTime(resume.updatedAt)] }), _jsxs("p", { children: ["Last compile: ", formatDateTime(resume.lastCompiledAt)] })] }, resume.id))) }), _jsxs("div", { className: "new-resume-form", children: [_jsx("h3", { children: "Create New Resume" }), _jsx("div", { className: "row-actions", children: _jsx("button", { onClick: onCompileAll, disabled: compilingAll, children: compilingAll ? 'Compiling all...' : 'Compile All Resumes' }) }), _jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Name", _jsx("input", { placeholder: "e.g. Backend Resume - Austin", value: name, onChange: (e) => setName(e.target.value) })] }), _jsxs("label", { children: ["Clone from", _jsx("select", { value: sourceResumeId, onChange: (e) => setSourceResumeId(e.target.value), children: resumes.map((resume) => (_jsx("option", { value: resume.id, children: resume.name }, resume.id))) })] })] }), _jsx("button", { onClick: handleCreate, disabled: creating || !name.trim(), children: creating ? 'Creating...' : 'Create Resume' })] })] }));
}
function ResumeStudio({ global, detail, history, onSaveResume, onCompile, onOverridePoint, onSaveCustomLatex, onClearCustomLatex, onLoadSnapshot, snapshot, }) {
    const [mode, setMode] = useState('blocks');
    const [draft, setDraft] = useState(deepClone(detail.resume));
    const [latexDraft, setLatexDraft] = useState(detail.latex);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        setDraft(deepClone(detail.resume));
    }, [detail.resume.id, detail.resume.updatedAt]);
    useEffect(() => {
        setLatexDraft(detail.latex);
    }, [detail.latex]);
    const globalIndexes = useMemo(() => {
        const toIndex = (items) => {
            return items.reduce((acc, item) => {
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
    const hasDraftChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(detail.resume), [draft, detail.resume]);
    const saveDraft = async () => {
        setBusy(true);
        try {
            await onSaveResume(draft, `Update resume ${draft.name} blocks`);
        }
        finally {
            setBusy(false);
        }
    };
    const moveSection = (section, direction) => {
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
    const toggleSectionVisibility = (section) => {
        setDraft((prev) => {
            const next = deepClone(prev);
            next.sectionVisibility[section] = !next.sectionVisibility[section];
            return next;
        });
    };
    const removeRef = (section, index) => {
        setDraft((prev) => {
            const next = deepClone(prev);
            next.sections[section].splice(index, 1);
            return next;
        });
    };
    const addGlobalRef = (section, globalId) => {
        setDraft((prev) => {
            const next = deepClone(prev);
            next.sections[section].push({ globalId });
            return next;
        });
    };
    const addLocalEntry = (section) => {
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
    const findSectionRefId = (section, index) => {
        const ref = draft.sections[section][index];
        return ref.globalId ?? ref.localId ?? '';
    };
    const detachRefToLocal = (section, refIndex) => {
        if (!sectionHasPoints(section)) {
            return;
        }
        setDraft((prev) => {
            const next = deepClone(prev);
            const ref = next.sections[section][refIndex];
            if (!ref || !ref.globalId) {
                return prev;
            }
            const clonePointIds = (sourcePointIds) => {
                const localPointIds = [];
                for (const basePointId of sourcePointIds) {
                    const effectivePointId = ref.pointOverrides?.[basePointId] ?? basePointId;
                    const text = next.local.points[effectivePointId]?.text ?? global.points[effectivePointId]?.text;
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
    const updateLocalEntryField = (section, localId, field, value) => {
        setDraft((prev) => {
            const next = deepClone(prev);
            if (section === 'education') {
                const entry = next.local.education.find((item) => item.id === localId);
                if (!entry) {
                    return prev;
                }
                entry[field] = value;
                return next;
            }
            if (section === 'skills') {
                const entry = next.local.skills.find((item) => item.id === localId);
                if (!entry) {
                    return prev;
                }
                entry[field] = value;
                return next;
            }
            if (section === 'experience') {
                const entry = next.local.experience.find((item) => item.id === localId);
                if (!entry) {
                    return prev;
                }
                entry[field] = value;
                return next;
            }
            if (section === 'projects') {
                const entry = next.local.projects.find((item) => item.id === localId);
                if (!entry) {
                    return prev;
                }
                entry[field] = value;
                return next;
            }
            if (section === 'openSource') {
                const entry = next.local.openSource.find((item) => item.id === localId);
                if (!entry) {
                    return prev;
                }
                entry[field] = value;
                return next;
            }
            return next;
        });
    };
    const updateLocalPoint = (pointId, text) => {
        setDraft((prev) => {
            const next = deepClone(prev);
            if (!next.local.points[pointId]) {
                return prev;
            }
            next.local.points[pointId].text = text;
            return next;
        });
    };
    const addLocalPointToEntry = (section, localId) => {
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
    const removePointFromRef = (section, refIndex, sourcePointId, localPointId) => {
        setDraft((prev) => {
            const next = deepClone(prev);
            const ref = next.sections[section][refIndex];
            if (!ref) {
                return prev;
            }
            if (ref.localId) {
                const list = next.local[section];
                const entry = list.find((item) => item.id === ref.localId);
                if (!entry) {
                    return prev;
                }
                const targetPointId = localPointId ?? sourcePointId;
                entry.pointIds = entry.pointIds.filter((id) => id !== targetPointId);
                return next;
            }
            if (ref.globalId) {
                const globalEntry = section === 'experience'
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
    const handleOverride = async (section, refId, pointId, currentText) => {
        const edited = window.prompt('Create resume-only point text (this will detach from global updates):', currentText);
        if (!edited || !edited.trim()) {
            return;
        }
        setBusy(true);
        try {
            await onOverridePoint(section, refId, pointId, edited.trim());
        }
        finally {
            setBusy(false);
        }
    };
    const renderEntryBlock = (section, refIndex) => {
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
            return (_jsxs("div", { className: "block-card missing", children: ["Missing source for reference ", refId] }, refId));
        }
        const points = sectionHasPoints(section)
            ? (() => {
                const typed = source;
                const sourcePointIds = ref.localId
                    ? typed.pointIds
                    : ref.includePointIds?.length
                        ? typed.pointIds.filter((id) => ref.includePointIds?.includes(id))
                        : typed.pointIds;
                return sourcePointIds.map((sourcePointId) => {
                    const effectivePointId = ref.pointOverrides?.[sourcePointId] ?? sourcePointId;
                    const text = draft.local.points[effectivePointId]?.text ??
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
        return (_jsxs("div", { className: "block-card", children: [_jsxs("div", { className: "block-card-header", children: [_jsxs("div", { children: [_jsxs("strong", { children: [isLocal ? 'Local' : 'Global', " Block"] }), _jsx("p", { children: refId })] }), _jsxs("div", { className: "row-actions", children: [!isLocal && sectionHasPoints(section) && (_jsx("button", { onClick: () => detachRefToLocal(section, refIndex), children: "Detach to Resume-only" })), _jsx("button", { className: "danger", onClick: () => removeRef(section, refIndex), children: "Remove Block" })] })] }), section === 'education' && (_jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Institution", _jsx("input", { value: source.institution, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'institution', e.target.value) })] }), _jsxs("label", { children: ["Right Meta", _jsx("input", { value: source.rightMeta, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'rightMeta', e.target.value) })] }), _jsxs("label", { children: ["Degree", _jsx("input", { value: source.degree, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'degree', e.target.value) })] }), _jsxs("label", { children: ["Detail", _jsx("input", { value: source.detail, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'detail', e.target.value) })] })] })), section === 'skills' && (_jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Label", _jsx("input", { value: source.label, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'label', e.target.value) })] }), _jsxs("label", { children: ["Value", _jsx("input", { value: source.value, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'value', e.target.value) })] })] })), section === 'experience' && (_jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Company", _jsx("input", { value: source.company, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'company', e.target.value) })] }), _jsxs("label", { children: ["Date Range", _jsx("input", { value: source.dateRange, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'dateRange', e.target.value) })] }), _jsxs("label", { children: ["Role", _jsx("input", { value: source.role, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'role', e.target.value) })] }), _jsxs("label", { children: ["Secondary Line", _jsx("input", { value: source.location, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'location', e.target.value) })] })] })), section === 'projects' && (_jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Title", _jsx("input", { value: source.title, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'title', e.target.value) })] }), _jsxs("label", { children: ["Date Range", _jsx("input", { value: source.dateRange, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'dateRange', e.target.value) })] }), _jsxs("label", { className: "span-2", children: ["Link", _jsx("input", { value: source.link, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'link', e.target.value) })] })] })), section === 'openSource' && (_jsxs("div", { className: "field-grid two-col", children: [_jsxs("label", { children: ["Title", _jsx("input", { value: source.title, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'title', e.target.value) })] }), _jsxs("label", { children: ["Date Range", _jsx("input", { value: source.dateRange, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'dateRange', e.target.value) })] }), _jsxs("label", { children: ["Role", _jsx("input", { value: source.role, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'role', e.target.value) })] }), _jsxs("label", { children: ["Link", _jsx("input", { value: source.link, disabled: !isLocal, onChange: (e) => isLocal &&
                                        updateLocalEntryField(section, ref.localId, 'link', e.target.value) })] })] })), sectionHasPoints(section) && (_jsxs("div", { className: "points-list", children: [_jsx("h4", { children: "Points" }), points.map((point) => (_jsxs("div", { className: "point-row", children: [point.isLocalPoint ? (_jsx("textarea", { value: point.text, onChange: (e) => updateLocalPoint(point.effectivePointId, e.target.value) })) : (_jsx("textarea", { value: point.text, readOnly: true })), _jsxs("div", { className: "row-actions", children: [!point.isLocalPoint && (_jsx("button", { onClick: () => handleOverride(section, refId, point.sourcePointId, point.text), children: "Override in this resume" })), _jsx("button", { className: "danger", onClick: () => removePointFromRef(section, refIndex, point.sourcePointId, point.isLocalPoint ? point.effectivePointId : undefined), children: "Remove" })] })] }, `${point.sourcePointId}-${point.effectivePointId}`))), isLocal && (_jsx("button", { onClick: () => addLocalPointToEntry(section, ref.localId), children: "Add Local Point" }))] }))] }, refId));
    };
    const allGlobalIdsBySection = {
        education: global.sections.education.map((item) => item.id),
        skills: global.sections.skills.map((item) => item.id),
        experience: global.sections.experience.map((item) => item.id),
        projects: global.sections.projects.map((item) => item.id),
        openSource: global.sections.openSource.map((item) => item.id),
    };
    const usedGlobalIdsBySection = {
        education: new Set(draft.sections.education.map((ref) => ref.globalId).filter(Boolean)),
        skills: new Set(draft.sections.skills.map((ref) => ref.globalId).filter(Boolean)),
        experience: new Set(draft.sections.experience.map((ref) => ref.globalId).filter(Boolean)),
        projects: new Set(draft.sections.projects.map((ref) => ref.globalId).filter(Boolean)),
        openSource: new Set(draft.sections.openSource.map((ref) => ref.globalId).filter(Boolean)),
    };
    const availableGlobalIds = (section) => {
        return allGlobalIdsBySection[section].filter((id) => !usedGlobalIdsBySection[section].has(id));
    };
    const [pendingAdd, setPendingAdd] = useState({
        education: '',
        skills: '',
        experience: '',
        projects: '',
        openSource: '',
    });
    const displayedPdfUrl = snapshot?.pdfUrl ?? detail.pdfUrl;
    return (_jsxs("div", { className: "studio-shell", children: [_jsxs("div", { className: "studio-toolbar", children: [_jsxs("div", { children: [_jsx("h2", { children: detail.resume.name }), _jsxs("p", { children: ["Last compile: ", formatDateTime(detail.resume.lastCompiledAt), " | status:", ' ', detail.resume.lastCompileStatus ?? 'unknown'] })] }), _jsxs("div", { className: "row-actions", children: [_jsx("button", { onClick: () => setMode('blocks'), className: mode === 'blocks' ? 'active' : '', children: "Block View" }), _jsx("button", { onClick: () => setMode('latex'), className: mode === 'latex' ? 'active' : '', children: "LaTeX View" }), _jsx("button", { onClick: onCompile, disabled: busy, children: "Compile Resume" }), _jsx("button", { onClick: saveDraft, disabled: !hasDraftChanges || busy, children: "Save Blocks" })] })] }), _jsxs("div", { className: "studio-grid", children: [_jsxs("div", { className: "studio-left", children: [mode === 'blocks' ? (_jsx("div", { className: "stack", children: draft.sectionOrder.map((section) => (_jsxs("div", { className: "section-stack", style: { borderColor: sectionColors[section] }, children: [_jsxs("div", { className: "section-stack-header", children: [_jsx("h3", { children: sectionTitles[section] }), _jsxs("div", { className: "row-actions", children: [_jsxs("label", { className: "toggle", children: [_jsx("input", { type: "checkbox", checked: draft.sectionVisibility[section], onChange: () => toggleSectionVisibility(section) }), "Visible"] }), _jsx("button", { onClick: () => moveSection(section, -1), children: "Up" }), _jsx("button", { onClick: () => moveSection(section, 1), children: "Down" })] })] }), _jsx("div", { className: "stack", children: draft.sections[section].map((_, idx) => renderEntryBlock(section, idx)) }), _jsxs("div", { className: "section-actions", children: [_jsxs("select", { value: pendingAdd[section], onChange: (e) => setPendingAdd((prev) => ({ ...prev, [section]: e.target.value })), children: [_jsx("option", { value: "", children: "Add existing global block..." }), availableGlobalIds(section).map((id) => (_jsx("option", { value: id, children: id }, id)))] }), _jsx("button", { onClick: () => {
                                                        const id = pendingAdd[section];
                                                        if (!id) {
                                                            return;
                                                        }
                                                        addGlobalRef(section, id);
                                                        setPendingAdd((prev) => ({ ...prev, [section]: '' }));
                                                    }, disabled: !pendingAdd[section], children: "Add Global Block" }), _jsx("button", { onClick: () => addLocalEntry(section), children: "Add Local Block" })] })] }, section))) })) : (_jsxs("div", { className: "code-pane", children: [_jsxs("div", { className: "row-actions", children: [_jsx("button", { onClick: async () => {
                                                    setBusy(true);
                                                    try {
                                                        await onSaveCustomLatex(latexDraft);
                                                    }
                                                    finally {
                                                        setBusy(false);
                                                    }
                                                }, disabled: busy, children: "Save as Custom LaTeX" }), _jsx("button", { onClick: async () => {
                                                    setBusy(true);
                                                    try {
                                                        await onClearCustomLatex();
                                                    }
                                                    finally {
                                                        setBusy(false);
                                                    }
                                                }, disabled: busy, children: "Clear Custom LaTeX" })] }), _jsx(Editor, { height: "72vh", defaultLanguage: "latex", value: latexDraft, onChange: (value) => setLatexDraft(value ?? ''), options: {
                                            minimap: { enabled: false },
                                            fontFamily: 'IBM Plex Mono',
                                            fontSize: 13,
                                            wordWrap: 'on',
                                        } })] })), _jsxs("div", { className: "history-panel", children: [_jsx("h3", { children: "History" }), _jsxs("div", { className: "history-list", children: [history.map((entry) => (_jsxs("button", { className: snapshot?.commitHash === entry.commitHash ? 'active' : '', onClick: () => onLoadSnapshot(entry.commitHash), children: [_jsx("strong", { children: entry.message }), _jsx("span", { children: formatDateTime(entry.createdAt) }), _jsx("span", { className: "hash", children: entry.commitHash.slice(0, 10) })] }, entry.id))), !history.length && _jsx("p", { children: "No history yet." })] })] })] }), _jsxs("div", { className: "studio-right", children: [_jsxs("div", { className: "preview-header", children: [_jsx("h3", { children: snapshot ? `Snapshot ${snapshot.commitHash.slice(0, 10)}` : 'Current PDF' }), _jsx("p", { children: snapshot
                                            ? 'Historical snapshot is rendered from Git commit data.'
                                            : 'Live compile preview' })] }), displayedPdfUrl ? (_jsx("iframe", { src: displayedPdfUrl, title: "Resume PDF Preview" })) : (_jsxs("div", { className: "preview-empty", children: [_jsx("p", { children: "No PDF available yet." }), _jsx("p", { children: "Compile this resume after installing a LaTeX compiler or Docker image." })] }))] })] })] }));
}
export default function App() {
    const [state, setState] = useState(null);
    const [draftGlobal, setDraftGlobal] = useState(null);
    const [draftSettings, setDraftSettings] = useState(null);
    const [activeTab, setActiveTab] = useState('resumes');
    const [selectedResumeId, setSelectedResumeId] = useState();
    const [detail, setDetail] = useState(null);
    const [history, setHistory] = useState([]);
    const [snapshot, setSnapshot] = useState(null);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
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
    const loadResumeContext = async (resumeId) => {
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
    const withTask = async (task) => {
        setLoading(true);
        setError('');
        setNotice('');
        try {
            await task();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Unexpected error');
        }
        finally {
            setLoading(false);
        }
    };
    const commitGlobal = async () => {
        if (!draftGlobal) {
            return;
        }
        await withTask(async () => {
            const updated = await saveGlobal(draftGlobal, 'Commit global section edits and compile affected resumes');
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
    const handleCreateResume = async (name, sourceResumeId) => {
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
    const handleSaveResume = async (resume, message) => {
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
            const updated = await compileAllResumes('Compile all resumes from dashboard action');
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
    const handleOverridePoint = async (section, refId, pointId, currentText) => {
        if (!selectedResumeId) {
            return;
        }
        await withTask(async () => {
            const updated = await overridePoint(selectedResumeId, {
                section,
                refId,
                pointId,
                text: currentText,
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
    const handleSaveCustomLatex = async (latex) => {
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
    const handleLoadSnapshot = async (commitHash) => {
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
        return (_jsxs("div", { className: "centered-screen", children: [_jsx("h1", { children: "Resume Automator" }), _jsx("p", { children: loading ? 'Loading...' : 'No data available' }), error && _jsx("p", { className: "error-text", children: error })] }));
    }
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("div", { className: "brand", children: [_jsx("h1", { children: "Resume Automator" }), _jsx("p", { children: "Git-backed LaTeX resume studio" })] }), _jsx("nav", { children: tabOrder.map((tab) => (_jsx("button", { className: activeTab === tab ? 'active' : '', onClick: () => setActiveTab(tab), children: tabLabels[tab] }, tab))) }), _jsxs("div", { className: "sidebar-footer", children: [_jsx("button", { onClick: commitGlobal, disabled: !globalDirty || loading, children: globalDirty ? 'Commit Global Changes' : 'No Global Changes' }), _jsx("p", { children: "Compiles impacted resumes and records Git history." })] })] }), _jsxs("main", { className: "main-area", children: [_jsxs("header", { className: "top-bar", children: [_jsxs("div", { children: [_jsx("strong", { children: "Workspace" }), _jsx("p", { children: selectedResumeId
                                            ? `Selected resume: ${selectedResumeId}`
                                            : 'Select a resume to open studio' })] }), _jsxs("div", { className: "status-area", children: [loading && _jsx("span", { className: "badge", children: "Working..." }), notice && _jsx("span", { className: "badge success", children: notice }), error && _jsx("span", { className: "badge error", children: error })] })] }), _jsxs("section", { className: "content-area", children: [activeTab === 'resumes' && (_jsxs(_Fragment, { children: [_jsx(ResumesTab, { resumes: state.resumes, selectedId: selectedResumeId, onSelect: (id) => {
                                            setSelectedResumeId(id);
                                            setActiveTab('resumes');
                                        }, onCreate: handleCreateResume, onCompileAll: handleCompileAllResumes, compilingAll: loading }), detail && selectedResumeId === detail.resume.id && (_jsx(ResumeStudio, { global: draftGlobal, detail: detail, history: history, onSaveResume: handleSaveResume, onCompile: handleCompileResume, onOverridePoint: handleOverridePoint, onSaveCustomLatex: handleSaveCustomLatex, onClearCustomLatex: handleClearCustomLatex, onLoadSnapshot: handleLoadSnapshot, snapshot: snapshot }))] })), activeTab === 'header' && (_jsx(HeaderEditor, { global: draftGlobal, onChange: setDraftGlobal })), activeTab === 'output' && (_jsx(OutputSettingsEditor, { settings: draftSettings, onChange: setDraftSettings, onSave: commitSettings, saving: loading, dirty: settingsDirty })), activeTab === 'education' && (_jsx(EducationEditor, { global: draftGlobal, onChange: setDraftGlobal })), activeTab === 'skills' && (_jsx(SkillsEditor, { global: draftGlobal, onChange: setDraftGlobal })), activeTab === 'experience' && (_jsx(ExperienceEditor, { global: draftGlobal, onChange: setDraftGlobal })), activeTab === 'projects' && (_jsx(ProjectsEditor, { global: draftGlobal, onChange: setDraftGlobal })), activeTab === 'openSource' && (_jsx(OpenSourceEditor, { global: draftGlobal, onChange: setDraftGlobal }))] })] })] }));
}
