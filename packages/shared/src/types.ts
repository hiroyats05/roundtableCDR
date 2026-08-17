export type ChannelType = "TEXT" | "VOICE";

export interface User {
  id: string;
  username: string;
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
