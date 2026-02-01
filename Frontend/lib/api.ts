// Standardized API Client with Timeout & Error Handling

let envApi = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api';
if (envApi.endsWith('/')) envApi = envApi.slice(0, -1);
// If it refers to root (no /api), append it. If it has /api, keep it.
// Simple heuristic: if it doesn't end in /api, append it.
const API_BASE = envApi.endsWith('/api') ? envApi : `${envApi}/api`;

// Custom Error Class
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Robust Fetch Wrapper
async function fetchClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  // Default timeout: 5 seconds for read ops, 15s for write
  const timeoutMs = options.method === 'POST' ? 15000 : 5000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(id);

    if (!res.ok) {
        // Try to parse error message from JSON, fallback to status text
        let errorMessage = `HTTP Error ${res.status}`;
        try {
            const errorBody = await res.json();
            if (errorBody.error) errorMessage = errorBody.error;
        } catch { /* ignore parsing error */ }
        
        throw new ApiError(res.status, errorMessage);
    }

    // Handle 204 No Content
    if (res.status === 204) return {} as T;

    return await res.json();
  } catch (error: any) {
    clearTimeout(id);
    
    // Distinguish between Abort (Timeout) and Network Error
    if (error.name === 'AbortError') {
      throw new ApiError(408, 'Request timed out - Backend slow or unreachable.');
    }
    if (error instanceof ApiError) {
        throw error;
    }
    // "Failed to fetch" usually lands here
    throw new ApiError(503, 'Network Error - Backend unavailable or refused connection.');
  }
}

// --- Interfaces ---

export interface Session {
  id: string;
  status:
    | "DISCONNECTED"
    | "QR"
    | "LOADING"
    | "SYNCING"
    | "READY"
    | "ONLINE"
    | "CONNECTING"
    | "AUTHENTICATED"
    | "ERROR";
  name?: string;
  photo?: string;
  battery?: number;
  phone?: string | null;
  displayOrder?: number;
  qrTimestamp?: number | null;
}

export interface SystemStatus {
  active_campaigns: number;
  total_sent: number;
  delivery_rate: number;
  queue_current: number;
  queue_total: number;
}

export interface HourlyData {
  hour: string;
  sent: number;
}

// --- Typed API Methods ---

export async function getStatus(): Promise<SystemStatus> {
  return fetchClient<SystemStatus>('/status');
}

export async function getSessions(): Promise<Session[]> {
  return fetchClient<Session[]>('/sessions');
}

export async function getHourlyData(): Promise<HourlyData[]> {
    try {
        return await fetchClient<HourlyData[]>('/dashboard/hourly');
    } catch {
        return [];
    }
}

export async function createSession(): Promise<{ id: string; status?: string }> {
  return fetchClient<{ id: string; status?: string }>('/session/new', { method: 'POST' });
}

export async function connectSession(chipId: string): Promise<{ success: boolean }> {
  // Logic handled by createSession basically
  return fetchClient<{ success: boolean }>(`/session/${chipId}/connect`, { method: 'POST' });
}

export async function deleteSession(chipId: string): Promise<{ success: boolean }> {
  return fetchClient<{ success: boolean }>(`/session/${chipId}`, { method: 'DELETE' });
}

export async function startCampaign(data: {
  file: File;
  message: string;
  delayMin: number;
  delayMax: number;
}): Promise<{ success: boolean; campaignId: string }> {
  
  // FormData handling is special (no JSON header)
  const formData = new FormData();
  formData.append('file', data.file);
  formData.append('message', data.message);
  formData.append('delayMin', data.delayMin.toString());
  formData.append('delayMax', data.delayMax.toString());

  const url = `${API_BASE}/campaign/start`;
  
  try {
      const res = await fetch(url, {
          method: 'POST',
          body: formData, // fetch automatically sets Content-Type boundary
      });
      if (!res.ok) throw new ApiError(res.status, 'Failed to upload campaign');
      return await res.json();
  } catch (e: any) {
      throw new ApiError(500, e.message || 'Campaign upload failed');
  }
}
