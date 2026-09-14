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

function formatDate(dt) {
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function addDays(iso, days) {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(y, m - 1, d + days);
  return formatDate(dt);
}

export function mondayOf(iso) {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(y, m - 1, d);
  const offset = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - offset);
  return formatDate(dt);
}

export function sundayOf(mondayIso) {
  return addDays(mondayIso, 6);
}

export function dutyWeekFromDate(iso) {
  const start = mondayOf(iso);
  return { start, end: sundayOf(start) };
}

export function formatDutyWeek(week) {
  return `${week.start} ~ ${week.end}`;
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

export function dutyLeaveCount(todayIso, dutyWeeks) {
  return (dutyWeeks || []).filter((week) => week.start && week.start <= todayIso).length;
}

export function personSummary(person, todayIso = localToday()) {
  const earnedAnnual = monthlyLeaveCount(todayIso, person.hire_date);
  const earnedDuty = dutyLeaveCount(todayIso, person.duty_weeks);
  const totalEarned = earnedAnnual + earnedDuty;
  const used = (person.used_leaves || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    earnedAnnual,
    earnedDuty,
    totalEarned,
    used,
    remaining: totalEarned - used,
  };
}

export function newPerson({
  name,
  hire_date,
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
    duty_weeks: [],
    used_leaves: [],
  };
}

export const LEAVE_FULL = "하루 휴가";
export const LEAVE_HALF = "반일 휴가";

export function isHalfLeave(type) {
  return type === LEAVE_HALF || type === "반차(0.5일)" || type === "반차";
}

export function formatLeaveType(type) {
  if (isHalfLeave(type)) return LEAVE_HALF;
  if (type === "연차(1일)" || type === "연차" || !type) return LEAVE_FULL;
  return type;
}

export function newLeave({ date, type, reason }) {
  const label = formatLeaveType(type);
  const note = String(reason || "").trim();
  return {
    id: crypto.randomUUID(),
    date,
    amount: isHalfLeave(type) ? 0.5 : 1,
    type: label,
    reason: note,
  };
}

export function newDutyWeek(iso) {
  const range = dutyWeekFromDate(iso);
  return {
    id: crypto.randomUUID(),
    start: range.start,
    end: range.end,
  };
}

function listFromRecord(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
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
        duty_weeks: listFromRecord(person.duty_weeks).map((week, index) => {
          const source = typeof week === "string" ? { start: week } : week;
          const start = mondayOf(source.start || source.date);
          return {
            id: source.id || `duty-${person.id}-${index}-${start}`,
            start,
            end: source.end || sundayOf(start),
          };
        }),
        used_leaves: listFromRecord(person.used_leaves).map((leave, index) => ({
          ...leave,
          id: leave.id || `legacy-${person.id}-${index}-${leave.date}`,
        })),
      };
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
}
