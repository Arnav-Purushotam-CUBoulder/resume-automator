import {
  AppStateResponse,
  AppSettings,
  CommitEvent,
  GlobalCatalog,
  ResumeDetailResponse,
  ResumeDocument,
} from '../types/domain';

const apiBase =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  'http://127.0.0.1:4100';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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

  return (await response.json()) as T;
}

export function getState(): Promise<AppStateResponse> {
  return request<AppStateResponse>('/api/state');
}

export function saveGlobal(global: GlobalCatalog, message: string): Promise<AppStateResponse> {
  return request<AppStateResponse>('/api/global', {
    method: 'PUT',
    body: JSON.stringify({ global, message }),
  });
}

export async function getSettings(): Promise<AppSettings> {
  const data = await request<{ settings: AppSettings }>('/api/settings');
  return data.settings;
}

export async function saveSettings(settings: {
  exportPdfDir?: string;
}): Promise<AppSettings> {
  const data = await request<{ settings: AppSettings }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
  return data.settings;
}

export function getResumeDetail(id: string): Promise<ResumeDetailResponse> {
  return request<ResumeDetailResponse>(`/api/resumes/${id}`);
}

export function updateResume(
  id: string,
  resume: ResumeDocument,
  message: string,
): Promise<ResumeDetailResponse> {
  return request<ResumeDetailResponse>(`/api/resumes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ resume, message }),
  });
}

export function compileResume(id: string, message: string): Promise<ResumeDetailResponse> {
  return request<ResumeDetailResponse>(`/api/resumes/${id}/compile`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function compileAllResumes(message: string): Promise<AppStateResponse> {
  return request<AppStateResponse>('/api/resumes/compile-all', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function createResume(
  name: string,
  sourceResumeId?: string,
): Promise<ResumeDetailResponse> {
  return request<ResumeDetailResponse>('/api/resumes', {
    method: 'POST',
    body: JSON.stringify({ name, sourceResumeId }),
  });
}

export function overridePoint(
  resumeId: string,
  payload: { section: string; refId: string; pointId: string; text: string },
): Promise<ResumeDetailResponse> {
  return request<ResumeDetailResponse>(`/api/resumes/${resumeId}/override-point`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveCustomLatex(
  resumeId: string,
  latex: string,
): Promise<ResumeDetailResponse> {
  return request<ResumeDetailResponse>(`/api/resumes/${resumeId}/custom-latex`, {
    method: 'PUT',
    body: JSON.stringify({ latex }),
  });
}

export function clearCustomLatex(resumeId: string): Promise<ResumeDetailResponse> {
  return request<ResumeDetailResponse>(`/api/resumes/${resumeId}/custom-latex`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}

export async function getHistory(resumeId: string): Promise<CommitEvent[]> {
  const data = await request<{ history: CommitEvent[] }>(`/api/resumes/${resumeId}/history`);
  return data.history;
}

export function getHistorySnapshot(
  resumeId: string,
  commitHash: string,
): Promise<{ latex: string; pdfUrl?: string; texUrl?: string; logUrl?: string }> {
  return request(`/api/resumes/${resumeId}/history/${commitHash}`);
}

export function getBuildFiles(
  resumeId: string,
): Promise<{ tex?: string; log?: string }> {
  return request(`/api/resumes/${resumeId}/build-files`);
}
