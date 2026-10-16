import type { Channel, ChannelType, Message, User, UserRole } from "@saladereunioes/shared";

const TOKEN_KEY = "sessionToken";

// Running inside the Tauri desktop shell. The app is served from tauri://localhost,
// so cross-site cookies don't work and we authenticate with a Bearer token instead.
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// The desktop app always talks to the production server; VITE_DESKTOP_API_URL
// overrides it for local development.
const DESKTOP_API_URL = import.meta.env.VITE_DESKTOP_API_URL ?? "https://roundtablecdr.duckdns.org";
const WEB_API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const API_URL = (isDesktop ? DESKTOP_API_URL : WEB_API_URL).replace(/\/+$/, "");

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

export function getApiUrl(): string {
  return API_URL;
}

export function getAuthToken(): string | null {
  return isDesktop ? readStorage(TOKEN_KEY) : null;
}

function setAuthToken(token: string | null) {
  if (isDesktop) writeStorage(TOKEN_KEY, token);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export const api = {
  register: async (username: string, password: string, inviteCode: string) => {
    const result = await request<{ user: User; token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, inviteCode }),
    });
    setAuthToken(result.token);
    return result;
  },

  login: async (username: string, password: string) => {
    const result = await request<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setAuthToken(result.token);
    return result;
  },

  logout: async () => {
    try {
      return await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
    } finally {
      setAuthToken(null);
    }
  },

  me: () => request<{ user: User }>("/auth/me"),

  getChannels: () => request<Channel[]>("/channels"),

  createChannel: (name: string, type: ChannelType) =>
    request<Channel>("/channels", {
      method: "POST",
      body: JSON.stringify({ name, type }),
    }),

  deleteChannel: (channelId: string) =>
    request<{ ok: boolean }>(`/channels/${channelId}`, { method: "DELETE" }),

  getMessages: (channelId: string) =>
    request<Message[]>(`/channels/${channelId}/messages`),

  deleteMessage: (messageId: string) =>
    request<{ ok: boolean }>(`/messages/${messageId}`, { method: "DELETE" }),

  getVoiceToken: (channelId: string) =>
    request<{ token: string; url: string; roomName: string }>(`/voice/${channelId}/token`, {
      method: "POST",
    }),

  getScreenShareToken: (channelId: string) =>
    request<{ token: string; url: string }>(`/voice/${channelId}/screen-token`, { method: "POST" }),

  getVoiceTestTokens: () =>
    request<{ url: string; roomName: string; publisherToken: string; listenerToken: string }>(
      "/voice/test/token",
      { method: "POST" }
    ),

  kickParticipant:(channelId: string, userId: string) =>
    request<{ ok: boolean }>(`/voice/${channelId}/kick`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  muteParticipant: (channelId: string, userId: string) =>
    request<{ ok: boolean }>(`/voice/${channelId}/mute`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  getUsers: () => request<User[]>("/users"),

  updateUserRole: (userId: string, role: UserRole) =>
    request<User>(`/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
};

