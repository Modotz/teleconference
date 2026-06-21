import { getServerBase } from './config';

/** @deprecated use getServerBase() — kept for any external import. */
export { getServerBase };

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export interface UploadedAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export async function uploadFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadedAttachment> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);

  // Use XHR so we can report upload progress (fetch doesn't expose it).
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getServerBase()}/api/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed: ${xhr.status}`));
      } catch {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(form);
  });
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${getServerBase()}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }
  return data as T;
}

export const api = {
  register: (body: { email: string; username: string; password: string }) =>
    request<{ user: any; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ user: any; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  googleLogin: (idToken: string) =>
    request<{ user: any; token: string }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),
  verifyEmail: (token: string) =>
    request<{ ok: boolean }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: (email: string) =>
    request<{ ok: boolean }>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  me: () => request<{ user: any }>('/auth/me'),

  listRooms: () => request<{ rooms: any[] }>('/rooms'),
  createRoom: (body: { name: string; description?: string; scheduledAt?: string }) =>
    request<{ room: any }>('/rooms', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getRoom: (id: string) => request<{ room: any }>(`/rooms/${id}`),
  endRoom: (id: string) =>
    request<{ ok: boolean }>(`/rooms/${id}/end`, { method: 'POST' }),

  // Users + Chat
  listUsers: (q?: string) =>
    request<{ users: any[] }>(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  listConversations: () =>
    request<{ conversations: any[] }>('/conversations'),
  createConversation: (body: { userIds: string[]; name?: string; isGroup?: boolean }) =>
    request<{ conversation: any }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getConversation: (id: string) =>
    request<{ conversation: any }>(`/conversations/${id}`),
  listMessages: (id: string, before?: string) =>
    request<{ messages: any[] }>(
      `/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`
    ),
  addMember: (id: string, userId: string) =>
    request<{ conversation: any }>(`/conversations/${id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  removeMember: (id: string, userId: string) =>
    request<{ conversation: any }>(`/conversations/${id}/members/${userId}`, {
      method: 'DELETE',
    }),
  markRead: (id: string) =>
    request<{ ok: boolean }>(`/conversations/${id}/read`, { method: 'POST' }),
};
