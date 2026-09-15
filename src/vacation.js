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

export function isOnDutyWeek(week, dateIso) {
  return Boolean(week?.start && week?.end && week.start <= dateIso && dateIso <= week.end);
}

export function personOnDutyOnDate(person, dateIso) {
  return (person?.duty_weeks || []).some((week) => isOnDutyWeek(week, dateIso));
}

export function todayBoard(people, dateIso = localToday()) {
  const onLeave = [];
  const onDuty = [];
  for (const person of people || []) {
    const dayLeaves = (person.used_leaves || []).filter((item) => item.date === dateIso);
    if (dayLeaves.length) {
      const amount = dayLeaves.reduce((sum, leave) => sum + Number(leave.amount || 0), 0);
      onLeave.push({
        id: person.id,
        name: person.name,
        amount,
      });
    }
    if (personOnDutyOnDate(person, dateIso)) {
      onDuty.push({ id: person.id, name: person.name });
    }
  }
  onLeave.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  onDuty.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { onLeave, onDuty };
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
  const earnedBonus = (person.bonus_leaves || []).reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const totalEarned = earnedAnnual + earnedDuty + earnedBonus;
  const used = (person.used_leaves || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    earnedAnnual,
    earnedDuty,
    earnedBonus,
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
    bonus_leaves: [],
    access_grants: [],
  };
}

export const LEAVE_FULL = "하루 휴가";
export const LEAVE_HALF = "반일 휴가";

export const ACCESS_SERVICES = {
  RBS: "RBS",
  SCOP: "SCOP",
  SBC: "SBC",
};

export const ACCESS_WARNING_DAYS = 14;

export function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  const da = new Date(a.y, a.m - 1, a.d);
  const db = new Date(b.y, b.m - 1, b.d);
  return Math.round((db - da) / 86400000);
}

export function latestAccessEnd(person, service) {
  const svc = String(service || "").toUpperCase();
  const grants = (person?.access_grants || []).filter(
    (grant) => String(grant.service || "").toUpperCase() === svc && grant.end,
  );
  if (!grants.length) return "";
  return grants.reduce((latest, grant) => (grant.end > latest ? grant.end : latest), "");
}

export function isAccessUrgent(endIso, todayIso = localToday(), warningDays = ACCESS_WARNING_DAYS) {
  if (!endIso) return false;
  return todayIso >= addDays(endIso, -warningDays);
}

export function isHalfLeave(type) {
  const text = String(type || "");
  return (
    type === LEAVE_HALF ||
    type === "반차(0.5일)" ||
    type === "반차" ||
    text.includes("반차")
  );
}

export function formatLeaveType(type) {
  if (!type) return LEAVE_FULL;
  if (type === "연차(1일)" || type === "연차" || type === LEAVE_FULL) return LEAVE_FULL;
  if (type === LEAVE_HALF || type === "반차(0.5일)" || type === "반차") return LEAVE_HALF;
  return type;
}

export function personHasLeaveOnDate(person, date) {
  return (person?.used_leaves || []).some((item) => item.date === date);
}

export function newLeave({ date, type, reason }) {
  const raw = String(type || "").trim();
  const label = formatLeaveType(raw);
  const note = String(reason || "").trim();
  return {
    id: crypto.randomUUID(),
    date,
    amount: isHalfLeave(raw) ? 0.5 : 1,
    type: label,
    reason: note,
  };
}

function isStandardLeaveType(type) {
  return (
    type === LEAVE_FULL ||
    type === LEAVE_HALF ||
    type === "연차(1일)" ||
    type === "반차(0.5일)" ||
    type === "연차" ||
    type === "반차"
  );
}

export function patchLeaveFields(leave, { amount, reason }) {
  const nextAmount = Number(amount) === 0.5 ? 0.5 : 1;
  return {
    ...leave,
    amount: nextAmount,
    type: isStandardLeaveType(leave.type)
      ? nextAmount === 0.5
        ? LEAVE_HALF
        : LEAVE_FULL
      : leave.type,
    reason: String(reason ?? "").trim(),
  };
}

export function newBonusLeave({ amount, reason, date }) {
  const days = Number(amount);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("추가할 일수는 0보다 커야 합니다.");
  }
  const note = String(reason || "").trim();
  if (!note) throw new Error("사유를 입력하세요.");
  return {
    id: crypto.randomUUID(),
    date: date || localToday(),
    amount: days,
    reason: note,
  };
}

export function newAccessGrant({ service, end }) {
  const svc = String(service || "").trim().toUpperCase();
  if (!ACCESS_SERVICES[svc]) {
    throw new Error("구분자(RBS/SCOP/SBC)를 선택하세요.");
  }
  if (!end) throw new Error("만료일을 입력하세요.");
  return {
    id: crypto.randomUUID(),
    service: svc,
    end,
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
        bonus_leaves: listFromRecord(person.bonus_leaves).map((item, index) => ({
          id: item.id || `bonus-${person.id}-${index}-${item.date}`,
          date: item.date || "",
          amount: Number(item.amount) || 0,
          reason: item.reason || "",
        })),
        access_grants: listFromRecord(person.access_grants).map((grant, index) => ({
          id: grant.id || `access-${person.id}-${index}-${grant.service}-${grant.end || grant.start}`,
          service: String(grant.service || "").toUpperCase(),
          end: grant.end || grant.start || "",
        })),
      };
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
}
