import type { Channel, Message, User } from "./types.js";

export type ClientEvent =
  | {
      type: "channel:join";
      channelId: string;
    }
  | {
      type: "channel:leave";
      channelId: string;
    }
  | {
      type: "message:send";
      channelId: string;
      content: string;
    };

export type ServerEvent =
  | {
      type: "message:created";
      message: Message;
    }
  | {
      type: "presence:online";
      userId: string;
    }
  | {
      type: "presence:offline";
      userId: string;
    }
  | {
      type: "message:deleted";
      channelId: string;
      messageId: string;
    }
  | {
      type: "channel:created";
      channel: Channel;
    }
  | {
      type: "channel:deleted";
      channelId: string;
    }
  | {
      type: "user:updated";
      user: User;
    };
