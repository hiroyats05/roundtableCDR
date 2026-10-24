import { User } from "@phosphor-icons/react";

interface AvatarProps {
  size?: "md" | "sm";
  speaking?: boolean;
}

export function Avatar({ size = "md", speaking = false }: AvatarProps) {
  return (
    <span className={`avatar avatar-${size} ${speaking ? "speaking" : ""}`} aria-hidden>
      <User size={size === "md" ? 24 : 14} />
    </span>
  );
}
