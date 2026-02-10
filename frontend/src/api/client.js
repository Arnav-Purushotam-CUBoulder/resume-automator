const apiBase = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') ??
    'http://127.0.0.1:4100';
async function request(url, init) {
    const targetUrl = url.startsWith('http') ? url : `${apiBase}${url}`;
    const response = await fetch(targetUrl, {
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
        },
        ...init,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed: ${response.status}`);
    }
    return (await response.json());
}
export function getState() {
    return request('/api/state');
}
export function saveGlobal(global, message) {
    return request('/api/global', {
        method: 'PUT',
        body: JSON.stringify({ global, message }),
    });
}
export async function getSettings() {
    const data = await request('/api/settings');
    return data.settings;
}
export async function saveSettings(settings) {
    const data = await request('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
    });
    return data.settings;
}
export function getResumeDetail(id) {
    return request(`/api/resumes/${id}`);
}
export function updateResume(id, resume, message) {
    return request(`/api/resumes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ resume, message }),
    });
}
export function compileResume(id, message) {
    return request(`/api/resumes/${id}/compile`, {
        method: 'POST',
        body: JSON.stringify({ message }),
    });
}
export function compileAllResumes(message) {
    return request('/api/resumes/compile-all', {
        method: 'POST',
        body: JSON.stringify({ message }),
    });
}
export function createResume(name, sourceResumeId) {
    return request('/api/resumes', {
        method: 'POST',
        body: JSON.stringify({ name, sourceResumeId }),
    });
}
export function overridePoint(resumeId, payload) {
    return request(`/api/resumes/${resumeId}/override-point`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
export function saveCustomLatex(resumeId, latex) {
    return request(`/api/resumes/${resumeId}/custom-latex`, {
        method: 'PUT',
        body: JSON.stringify({ latex }),
    });
}
export function clearCustomLatex(resumeId) {
    return request(`/api/resumes/${resumeId}/custom-latex`, {
        method: 'DELETE',
        body: JSON.stringify({}),
    });
}
export async function getHistory(resumeId) {
    const data = await request(`/api/resumes/${resumeId}/history`);
    return data.history;
}
export function getHistorySnapshot(resumeId, commitHash) {
    return request(`/api/resumes/${resumeId}/history/${commitHash}`);
}
export function getBuildFiles(resumeId) {
    return request(`/api/resumes/${resumeId}/build-files`);
}
