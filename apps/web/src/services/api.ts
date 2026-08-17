const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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
    request<{ user: { id: string; username: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, inviteCode }),
    }),

  login: (username: string, password: string) =>
    request<{ user: { id: string; username: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: { id: string; username: string } }>("/auth/me"),

  getChannels: () =>
    request<Array<{ id: string; name: string; type: string; position: number }>>("/channels"),

  getMessages: (channelId: string) =>
    request<
      Array<{
        id: string;
        channelId: string;
        authorId: string;
        content: string;
        createdAt: string;
      }>
    >(`/channels/${channelId}/messages`),

  getVoiceToken: (channelId: string) =>
    request<{ token: string; url: string; roomName: string }>(`/voice/${channelId}/token`, {
      method: "POST",
    }),
};

export { API_URL };
