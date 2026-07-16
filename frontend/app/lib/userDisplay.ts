// First letter of the first name + first letter of the surname - falls back
// to the email's first letter for the rare account with neither set (e.g.
// one created before first/last name was required at signup). Shared by
// the sidebar footer avatar and the top-right navbar avatar so both stay
// in sync.
export function getInitials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | undefined
): string {
  const initials = `${firstName?.trim()?.[0] ?? ""}${lastName?.trim()?.[0] ?? ""}`;
  if (initials) return initials.toUpperCase();
  return email?.[0]?.toUpperCase() ?? "?";
}
