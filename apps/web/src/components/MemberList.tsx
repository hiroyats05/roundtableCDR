import { ArrowDown, ArrowUp, SidebarSimple, X } from "@phosphor-icons/react";
import type { User, UserRole } from "@saladereunioes/shared";
import { Avatar } from "./Avatar";

interface MemberListProps {
  onlineUsers: Set<string>;
  users: Map<string, User>;
  currentUserId: string;
  isAdmin: boolean;
  isOpen: boolean;
  onClose: () => void;
  /** Collapses the column on desktop. */
  onHide: () => void;
  onUpdateUserRole: (userId: string, role: UserRole) => void;
}

export function MemberList({
  onlineUsers,
  users,
  currentUserId,
  isAdmin,
  isOpen,
  onClose,
  onHide,
  onUpdateUserRole,
}: MemberListProps) {
  const online = Array.from(onlineUsers).map((id) => ({ id, user: users.get(id) }));
  const groups = [
    { label: "admin", members: online.filter((m) => m.user?.role === "ADMIN") },
    { label: "users", members: online.filter((m) => m.user?.role !== "ADMIN") },
  ];

  return (
    <aside className={`member-list ${isOpen ? "open" : ""}`}>
      <div className="member-list-header">
        <button className="icon-button column-hide-button" onClick={onHide} aria-label="Esconder membros" title="Esconder membros">
          <SidebarSimple size={18} mirrored />
        </button>
        <button className="icon-button member-list-close" onClick={onClose} aria-label="Fechar">
          <X size={18} />
        </button>
      </div>

      {groups.map(
        (group) =>
          group.members.length > 0 && (
            <section key={group.label} className="member-group">
              <h3>{group.label}</h3>
              <ul>
                {group.members.map(({ id, user: u }) => {
                  const isSelf = id === currentUserId;
                  return (
                    <li key={id} className="member">
                      <Avatar />
                      <span className="member-name" title={isSelf ? "você" : undefined}>
                        {u?.username ?? "…"}
                      </span>
                      {isAdmin && !isSelf && u && (
                        <button
                          className="role-toggle-button"
                          onClick={() => onUpdateUserRole(id, u.role === "ADMIN" ? "MEMBER" : "ADMIN")}
                          aria-label={u.role === "ADMIN" ? "Rebaixar" : "Promover"}
                          title={u.role === "ADMIN" ? "Rebaixar" : "Promover"}
                        >
                          {u.role === "ADMIN" ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )
      )}
    </aside>
  );
}
