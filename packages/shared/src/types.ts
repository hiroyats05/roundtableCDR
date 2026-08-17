export type ChannelType = "TEXT" | "VOICE";
export type UserRole = "ADMIN" | "MEMBER";

export interface User {
  id: string;
  username: string;
  role: UserRole;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  position: number;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: string;
}
