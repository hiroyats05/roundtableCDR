import type { Channel, ChannelType, Message, User, UserRole } from "@saladereunioes/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
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
  register: (username: string, password: string, inviteCode: string) =>
    request<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, inviteCode }),
    }),

  login: (username: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

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

  kickParticipant: (channelId: string, userId: string) =>
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

export { API_URL };
