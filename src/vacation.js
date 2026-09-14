export const DEFAULT_DUTY_INTERVAL_DAYS = 21;

export function localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function toNum({ y, m, d }) {
  return y * 10000 + m * 100 + d;
}

function isValidDate({ y, m, d }) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function addDays(iso, days) {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function monthlyLeaveCount(todayIso, hireIso) {
  if (!hireIso) return 0;
  const hire = parseIso(hireIso);
  const today = parseIso(todayIso);
  let count = 0;
  let cy = hire.y;
  let cm = hire.m;
  while (true) {
    let month = cm + 1;
    let year = cy;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const nxt = { y: year, m: month, d: hire.d };
    if (!isValidDate(nxt)) break;
    if (toNum(nxt) <= toNum(today)) {
      count += 1;
      cy = year;
      cm = month;
    } else {
      break;
    }
  }
  return count;
}

export function dutyLeaveCount(todayIso, startIso, intervalDays) {
  if (!startIso || !intervalDays) return 0;
  let count = 0;
  let d = startIso;
  while (d <= todayIso) {
    count += 1;
    d = addDays(d, intervalDays);
  }
  return count;
}

export function personSummary(person, todayIso = localToday()) {
  const interval = person.duty_interval_days || DEFAULT_DUTY_INTERVAL_DAYS;
  const earnedAnnual = monthlyLeaveCount(todayIso, person.hire_date);
  const earnedDuty = dutyLeaveCount(todayIso, person.duty_start, interval);
  const totalEarned = earnedAnnual + earnedDuty;
  const used = (person.used_leaves || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    earnedAnnual,
    earnedDuty,
    totalEarned,
    used,
    remaining: totalEarned - used,
    interval,
  };
}

export function newPerson({
  name,
  hire_date,
  duty_start,
  duty_interval_days,
  username,
  passwordHash,
  team,
  rank,
}) {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    username: username || "",
    passwordHash: passwordHash || "",
    team: team || "",
    rank: rank || "member",
    hire_date,
    duty_start: duty_start || null,
    duty_interval_days: Number(duty_interval_days) || DEFAULT_DUTY_INTERVAL_DAYS,
    used_leaves: [],
  };
}

export function newLeave({ date, type }) {
  const amount = type === "반차(0.5일)" ? 0.5 : 1;
  return {
    id: crypto.randomUUID(),
    date,
    amount,
    type,
  };
}

export function peopleFromRecord(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  return list
    .filter(Boolean)
    .map((person) => {
      const legacyTeam = person.team;
      const team = legacyTeam === "ta" || legacyTeam === "dba" ? legacyTeam : "";
      const rank =
        person.rank ||
        (legacyTeam === "pl" ? "pl" : legacyTeam === "pm" ? "pm" : "member");
      return {
        ...person,
        team,
        rank,
        used_leaves: (Array.isArray(person.used_leaves)
          ? person.used_leaves
          : Object.values(person.used_leaves || {})
        ).map((leave, index) => ({
          ...leave,
          id: leave.id || `legacy-${person.id}-${index}-${leave.date}`,
        })),
      };
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
}
