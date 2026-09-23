import Link from "next/link";

import { displayNameFromEmail } from "../../_lib/format";
import { Avatar } from "../ui/Avatar";

/** Compact user reference (users have only an email: the name is derived from it). */
export function UserCell({ id, email, showAvatar = true }) {
  if (!id) return <span className="text-app-muted">—</span>;
  const name = displayNameFromEmail(email);
  return (
    <Link href={`/admin/users/${id}`} className="group flex min-w-0 items-center gap-2.5">
      {showAvatar ? <Avatar name={name} /> : null}
      <span className="min-w-0">
        <span className="block truncate text-sm text-app-text group-hover:text-app-accent">{name}</span>
        <span className="block truncate text-xs text-app-muted">{email}</span>
      </span>
    </Link>
  );
}
