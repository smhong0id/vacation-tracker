export const TEAMS = {
  ta: "TA 팀",
  dba: "DBA 팀",
};

export const RANKS = {
  member: "팀원",
  pl: "PL",
  pm: "PM",
};

export function teamLabel(team) {
  return TEAMS[team] || "미지정";
}

export function rankLabel(rank) {
  return RANKS[rank] || "팀원";
}

export function personRoleLabel(person) {
  if (!person) return "미지정";
  if (person.rank === "pm") {
    return person.team ? `PM · ${TEAMS[person.team]}` : "PM";
  }
  if (!person.team) return rankLabel(person.rank);
  if (person.rank === "pl") return `${TEAMS[person.team]} PL`;
  return `${TEAMS[person.team]} 팀원`;
}

export function countDashboardTeams(people) {
  const countable = people.filter((p) => p.rank !== "pm");
  return {
    ta: countable.filter((p) => p.team === "ta").length,
    dba: countable.filter((p) => p.team === "dba").length,
  };
}

export async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

export function usernameKey(username) {
  return normalizeUsername(username).replace(/\./g, ",");
}

const AUTH_EMAIL_DOMAIN = "users.company-vacation.app";

export const ADMIN_AUTH_EMAIL = `admin@${AUTH_EMAIL_DOMAIN}`;

export function authEmailFor(username, uniqueId) {
  const local = normalizeUsername(username);
  const suffix = String(uniqueId || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  return `${local}.${suffix}@${AUTH_EMAIL_DOMAIN}`;
}
