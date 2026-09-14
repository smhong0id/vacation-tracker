import { getApps, initializeApp } from "firebase/app";
import { get, getDatabase, onValue, ref, remove, set, update } from "firebase/database";
import { countDashboardTeams, hashPassword, normalizeUsername, usernameKey } from "./auth";
import { firebaseConfig } from "./firebaseConfig";
import { peopleFromRecord } from "./vacation";

const LOCAL_KEY = "vacation-tracker-data";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "ghdtnals";

export const isFirebaseEnabled = Boolean(
  firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId,
);

let db = null;
if (isFirebaseEnabled) {
  const app = getApps()[0] || initializeApp(firebaseConfig);
  db = getDatabase(app, firebaseConfig.databaseURL);
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { people: [] };
    return { people: peopleFromRecord(JSON.parse(raw).people) };
  } catch {
    return { people: [] };
  }
}

function writeLocal(people) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ people }));
}

function usernameIndexPath(username) {
  return `usernames/${usernameKey(username)}`;
}

function personPayload(person) {
  const currentLeaves = {};
  for (const leave of person.used_leaves || []) {
    currentLeaves[leave.id] = leave;
  }
  const currentWeeks = {};
  for (const week of person.duty_weeks || []) {
    currentWeeks[week.id] = week;
  }
  return {
    id: person.id,
    name: person.name,
    username: person.username || "",
    passwordHash: person.passwordHash || "",
    team: person.team || "",
    rank: person.rank || "member",
    hire_date: person.hire_date,
    duty_weeks: currentWeeks,
    used_leaves: currentLeaves,
  };
}

async function writeStats(people) {
  const stats = countDashboardTeams(people);
  if (!isFirebaseEnabled) {
    const data = readLocal();
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({ people: data.people, stats }),
    );
    return stats;
  }
  await set(ref(db, "stats"), stats);
  return stats;
}

async function refreshStatsFromDb() {
  if (!isFirebaseEnabled) {
    return writeStats(readLocal().people);
  }
  const snap = await get(ref(db, "people"));
  const people = snap.exists() ? peopleFromRecord(snap.val()) : [];
  return writeStats(people);
}

export async function ensureAdminAccount() {
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  if (!isFirebaseEnabled) return;
  const adminSnap = await get(ref(db, "admin"));
  if (!adminSnap.exists()) {
    await set(ref(db, "admin"), {
      username: ADMIN_USERNAME,
      passwordHash,
    });
  }
  await set(ref(db, usernameIndexPath(ADMIN_USERNAME)), { type: "admin" });
  await refreshStatsFromDb();
}

export function subscribeStats(onData) {
  if (!isFirebaseEnabled) {
    const people = readLocal().people;
    onData({ stats: countDashboardTeams(people), mode: "local" });
    return () => {};
  }

  let gotShared = false;
  const timeout = setTimeout(() => {
    if (gotShared) return;
    onData({
      stats: { ta: 0, dba: 0 },
      mode: "local",
      error:
        "Realtime Database에 아직 연결되지 않았습니다. Firebase 콘솔에서 Realtime Database를 생성하고, 규칙을 읽기/쓰기 허용으로 열어 주세요.",
    });
  }, 8000);

  const unsub = onValue(
    ref(db, "stats"),
    (snap) => {
      gotShared = true;
      clearTimeout(timeout);
      const stats = snap.val() || { ta: 0, dba: 0 };
      onData({ stats, mode: "shared" });
    },
    (error) => {
      clearTimeout(timeout);
      if (gotShared) return;
      onData({ stats: { ta: 0, dba: 0 }, mode: "local", error: error.message });
    },
  );

  return () => {
    clearTimeout(timeout);
    unsub();
  };
}

export function subscribePeople(onData) {
  if (!isFirebaseEnabled) {
    onData({ people: readLocal().people, mode: "local" });
    return () => {};
  }
  const apply = (snap) => {
    onData({
      people: snap.exists() ? peopleFromRecord(snap.val()) : [],
      mode: "shared",
    });
  };
  get(ref(db, "people")).then(apply).catch(() => {});
  return onValue(ref(db, "people"), apply);
}

export function subscribePerson(personId, onData) {
  if (!isFirebaseEnabled) {
    const person = readLocal().people.find((p) => p.id === personId) || null;
    onData({ person, mode: "local" });
    return () => {};
  }
  return onValue(ref(db, `people/${personId}`), (snap) => {
    const raw = snap.val();
    onData({
      person: raw ? peopleFromRecord({ [raw.id]: raw })[0] : null,
      mode: "shared",
    });
  });
}

async function resolveUsernameRecord(id) {
  const snap = await get(ref(db, usernameIndexPath(id)));
  if (snap.exists()) return snap.val();
  const peopleSnap = await get(ref(db, "people"));
  const people = peopleSnap.exists() ? peopleFromRecord(peopleSnap.val()) : [];
  const person = people.find((p) => normalizeUsername(p.username) === id);
  if (!person) return null;
  const rec = { type: "person", personId: person.id };
  await set(ref(db, usernameIndexPath(id)), rec);
  return rec;
}

export async function login(username, password) {
  const id = normalizeUsername(username);
  const passwordHash = await hashPassword(password);
  if (!id) throw new Error("아이디를 입력하세요.");

  if (!isFirebaseEnabled) {
    if (id === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      return { type: "admin", username: ADMIN_USERNAME };
    }
    const person = readLocal().people.find((p) => normalizeUsername(p.username) === id);
    if (!person || !person.passwordHash || person.passwordHash !== passwordHash) {
      throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    return { type: "employee", username: person.username, personId: person.id };
  }

  const rec = await resolveUsernameRecord(id);
  if (!rec) {
    throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  if (rec.type === "admin") {
    const adminSnap = await get(ref(db, "admin"));
    const admin = adminSnap.val() || {};
    if (admin.passwordHash !== passwordHash) {
      throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    return { type: "admin", username: ADMIN_USERNAME };
  }

  const personSnap = await get(ref(db, `people/${rec.personId}`));
  const person = personSnap.val();
  if (!person || person.passwordHash !== passwordHash) {
    throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  return { type: "employee", username: person.username, personId: person.id };
}

async function updateUsernameIndex(person, previousUsername) {
  const next = normalizeUsername(person.username);
  const prev = normalizeUsername(previousUsername);
  if (!isFirebaseEnabled) return;
  if (prev && prev !== next) {
    await remove(ref(db, usernameIndexPath(prev)));
  }
  if (next) {
    if (next === ADMIN_USERNAME) {
      throw new Error("admin 아이디는 사용할 수 없습니다.");
    }
    await set(ref(db, usernameIndexPath(next)), { type: "person", personId: person.id });
  }
}

export async function savePerson(person, previousUsername = "") {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const idx = data.people.findIndex((p) => p.id === person.id);
    if (idx >= 0) data.people[idx] = person;
    else data.people.push(person);
    writeLocal(data.people);
    await writeStats(data.people);
    return;
  }
  await set(ref(db, `people/${person.id}`), personPayload(person));
  await updateUsernameIndex(person, previousUsername);
  await refreshStatsFromDb();
}

export async function patchPerson(personId, fields) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const idx = data.people.findIndex((p) => p.id === personId);
    if (idx < 0) return;
    const previousUsername = data.people[idx].username;
    data.people[idx] = { ...data.people[idx], ...fields };
    writeLocal(data.people);
    if ("username" in fields) {
      await updateUsernameIndex(data.people[idx], previousUsername);
    }
    await writeStats(data.people);
    return;
  }
  const currentSnap = await get(ref(db, `people/${personId}`));
  const current = currentSnap.val() || {};
  await update(ref(db, `people/${personId}`), fields);
  if ("username" in fields) {
    await updateUsernameIndex({ ...current, ...fields, id: personId }, current.username);
  }
  await refreshStatsFromDb();
}

export async function setPersonPassword(personId, password) {
  const passwordHash = await hashPassword(password);
  await patchPerson(personId, { passwordHash });
}

export async function deletePerson(personId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const remaining = data.people.filter((p) => p.id !== personId);
    writeLocal(remaining);
    await writeStats(remaining);
    return;
  }
  const currentSnap = await get(ref(db, `people/${personId}`));
  const current = currentSnap.val();
  if (current?.username) {
    await remove(ref(db, usernameIndexPath(current.username)));
  }
  await remove(ref(db, `people/${personId}`));
  await refreshStatsFromDb();
}

export async function addLeave(personId, leave) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((p) => p.id === personId);
    if (!person) return;
    person.used_leaves = [...(person.used_leaves || []), leave];
    writeLocal(data.people);
    return;
  }
  await set(ref(db, `people/${personId}/used_leaves/${leave.id}`), leave);
}

export async function removeLeave(personId, leaveId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((p) => p.id === personId);
    if (!person) return;
    person.used_leaves = (person.used_leaves || []).filter((item) => item.id !== leaveId);
    writeLocal(data.people);
    return;
  }
  await remove(ref(db, `people/${personId}/used_leaves/${leaveId}`));
}

export async function addDutyWeek(personId, week) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((p) => p.id === personId);
    if (!person) return;
    person.duty_weeks = [...(person.duty_weeks || []), week];
    writeLocal(data.people);
    return;
  }
  await set(ref(db, `people/${personId}/duty_weeks/${week.id}`), week);
}

export async function removeDutyWeek(personId, weekId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((p) => p.id === personId);
    if (!person) return;
    person.duty_weeks = (person.duty_weeks || []).filter((item) => item.id !== weekId);
    writeLocal(data.people);
    return;
  }
  await remove(ref(db, `people/${personId}/duty_weeks/${weekId}`));
}

export async function usernameTaken(username, exceptPersonId = "") {
  const id = normalizeUsername(username);
  if (!id) return false;
  if (id === ADMIN_USERNAME) return true;
  if (!isFirebaseEnabled) {
    return readLocal().people.some(
      (p) => normalizeUsername(p.username) === id && p.id !== exceptPersonId,
    );
  }
  const rec = await resolveUsernameRecord(id);
  if (!rec) return false;
  return rec.type === "admin" || rec.personId !== exceptPersonId;
}
