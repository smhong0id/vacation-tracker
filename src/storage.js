import { getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import { get, getDatabase, onValue, ref, remove, set, update } from "firebase/database";
import {
  ADMIN_AUTH_EMAIL,
  authEmailFor,
  countDashboardTeams,
  hashPassword,
  normalizeUsername,
  usernameKey,
} from "./auth";
import { firebaseConfig } from "./firebaseConfig";
import { peopleFromRecord, personHasLeaveOnDate } from "./vacation";

const LOCAL_KEY = "vacation-tracker-data";
const ADMIN_BOOT_KEY = "vacation-tracker-admin-boot";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "ghdtnals";
const SECONDARY_APP = "vacation-secondary";

export const isFirebaseEnabled = Boolean(
  firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId,
);

let db = null;
let auth = null;
let persistenceReady = null;
let pendingUid = null;

if (isFirebaseEnabled) {
  const app = getApps().find((item) => item.name === "[DEFAULT]") || initializeApp(firebaseConfig);
  db = getDatabase(app, firebaseConfig.databaseURL);
  auth = getAuth(app);
}

function readyAuth() {
  if (!auth) return Promise.resolve();
  if (!persistenceReady) {
    persistenceReady = setPersistence(auth, browserSessionPersistence);
  }
  return persistenceReady;
}

export function startAuth() {
  return readyAuth();
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { people: [] };
    return { people: peopleFromRecord(JSON.parse(raw).people, { keepSecret: true }) };
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
  const currentBonus = {};
  for (const item of person.bonus_leaves || []) {
    currentBonus[item.id] = item;
  }
  const currentGrants = {};
  for (const grant of person.access_grants || []) {
    currentGrants[grant.id] = grant;
  }
  const payload = {
    id: person.id,
    name: person.name,
    username: person.username || "",
    team: person.team || "",
    rank: person.rank || "member",
    hire_date: person.hire_date,
    duty_weeks: currentWeeks,
    used_leaves: currentLeaves,
    bonus_leaves: currentBonus,
    access_grants: currentGrants,
  };
  if (person.uid) payload.uid = person.uid;
  return payload;
}

export function mapAuthError(error, fallback = "요청을 처리하지 못했습니다.") {
  const code = error?.code || "";
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-email"
  ) {
    return new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  if (code === "auth/email-already-in-use") return new Error("이미 있는 아이디입니다.");
  if (code === "auth/weak-password") return new Error("비밀번호는 6자 이상이어야 합니다.");
  if (code === "auth/too-many-requests") {
    return new Error("시도가 너무 많습니다. 잠시 후 다시 하세요.");
  }
  if (code === "auth/configuration-not-found" || code === "auth/operation-not-allowed") {
    return new Error(
      "Firebase 콘솔에서 Authentication을 시작한 뒤, 이메일/비밀번호 로그인을 켜 주세요.",
    );
  }
  if (code === "auth/requires-recent-login") {
    return new Error("보안을 위해 다시 로그인한 뒤 비밀번호를 바꿔 주세요.");
  }
  const message = String(error?.message || "");
  if (code === "PERMISSION_DENIED" || message.includes("PERMISSION_DENIED")) {
    return new Error("권한이 없습니다.");
  }
  if (error instanceof Error && !code) return error;
  return new Error(fallback);
}

function assertPassword(password) {
  if (!password || password.length < 6) {
    throw new Error("비밀번호는 6자 이상이어야 합니다.");
  }
}

async function getSecondaryAuth() {
  const existing = getApps().find((item) => item.name === SECONDARY_APP);
  const app = existing || initializeApp(firebaseConfig, SECONDARY_APP);
  const secondary = getAuth(app);
  await setPersistence(secondary, inMemoryPersistence);
  return { auth: secondary, db: getDatabase(app, firebaseConfig.databaseURL) };
}

async function writeStats(people) {
  const stats = countDashboardTeams(people);
  if (!isFirebaseEnabled) {
    const data = readLocal();
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ people: data.people, stats }));
    return stats;
  }
  await set(ref(db, "stats"), stats);
  return stats;
}

async function refreshStatsFromDb() {
  if (!isFirebaseEnabled) return writeStats(readLocal().people);
  const snap = await get(ref(db, "people"));
  const people = snap.exists() ? peopleFromRecord(snap.val()) : [];
  return writeStats(people);
}

let scrubbedSecrets = false;

async function scrubPasswordHashes() {
  if (!isFirebaseEnabled || scrubbedSecrets || !auth?.currentUser) return;
  scrubbedSecrets = true;
  try {
    const snap = await get(ref(db, "people"));
    if (snap.exists()) {
      const updates = {};
      for (const [id, person] of Object.entries(snap.val() || {})) {
        if (person && Object.prototype.hasOwnProperty.call(person, "passwordHash")) {
          updates[`people/${id}/passwordHash`] = null;
        }
      }
      if (Object.keys(updates).length) await update(ref(db), updates);
    }
    await remove(ref(db, "admin"));
  } catch (error) {
    scrubbedSecrets = false;
    throw error;
  }
}

export async function ensureAdminAccount() {
  if (!isFirebaseEnabled) return;
  try {
    if (sessionStorage.getItem(ADMIN_BOOT_KEY) === "ok") return;
  } catch {
    /* sessionStorage를 쓸 수 없어도 계정 확인은 계속합니다. */
  }
  const secondary = await getSecondaryAuth();
  let created = null;
  try {
    try {
      created = await createUserWithEmailAndPassword(
        secondary.auth,
        ADMIN_AUTH_EMAIL,
        ADMIN_PASSWORD,
      );
    } catch (error) {
      if (error.code === "auth/email-already-in-use") {
        try {
          sessionStorage.setItem(ADMIN_BOOT_KEY, "ok");
        } catch {
          /* ignore */
        }
        return;
      }
      throw error;
    }
    const uid = created.user.uid;
    await set(ref(secondary.db, `accounts/${uid}`), {
      role: "admin",
      username: ADMIN_USERNAME,
      personId: "",
    });
    await set(ref(secondary.db, usernameIndexPath(ADMIN_USERNAME)), {
      uid,
      email: ADMIN_AUTH_EMAIL,
    });
    await remove(ref(secondary.db, "admin")).catch(() => {});
    try {
      sessionStorage.setItem(ADMIN_BOOT_KEY, "ok");
    } catch {
      /* ignore */
    }
  } catch (error) {
    if (created?.user) await created.user.delete().catch(() => {});
    throw error;
  } finally {
    await signOut(secondary.auth).catch(() => {});
  }
}

export function subscribeAuthSession(onData) {
  if (!isFirebaseEnabled || !auth) return () => {};
  let active = true;
  const unsub = onAuthStateChanged(auth, async (user) => {
    if (!active) return;
    if (!user) {
      onData(null);
      return;
    }
    let account = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (!active) return;
      const snap = await get(ref(db, `accounts/${user.uid}`));
      account = snap.val();
      if (account) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!active) return;
    if (!account) {
      if (pendingUid === user.uid || pendingUid === "pending") return;
      onData(null);
      return;
    }
    if (account.role === "admin") {
      onData({ type: "admin", username: ADMIN_USERNAME });
      scrubPasswordHashes().catch(() => {});
      return;
    }
    if (!account.personId) {
      onData(null);
      return;
    }
    onData({
      type: "employee",
      username: account.username || "",
      personId: account.personId,
    });
  });
  return () => {
    active = false;
    unsub();
  };
}

export async function logout() {
  if (!isFirebaseEnabled || !auth) return;
  await readyAuth();
  await signOut(auth);
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
        "Realtime Database에 아직 연결되지 않았습니다. Firebase 콘솔에서 Realtime Database를 만들고, 이메일/비밀번호 로그인을 켠 뒤 보안 규칙을 적용해 주세요.",
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
    const person = readLocal().people.find((item) => item.id === personId) || null;
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

async function accountForUser(uid) {
  const snap = await get(ref(db, `accounts/${uid}`));
  return snap.val();
}

export async function login(username, password) {
  const id = normalizeUsername(username);
  if (!id) throw new Error("아이디를 입력하세요.");
  const passwordHash = await hashPassword(password);

  if (!isFirebaseEnabled) {
    if (id === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      return { type: "admin", username: ADMIN_USERNAME };
    }
    const person = readLocal().people.find((item) => normalizeUsername(item.username) === id);
    if (!person || !person.passwordHash || person.passwordHash !== passwordHash) {
      throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    return { type: "employee", username: person.username, personId: person.id };
  }

  assertPassword(password);
  await readyAuth();

  if (id === ADMIN_USERNAME) {
    try {
      const cred = await signInWithEmailAndPassword(auth, ADMIN_AUTH_EMAIL, password);
      let account = await accountForUser(cred.user.uid);
      if (!account) {
        account = { role: "admin", username: ADMIN_USERNAME, personId: "" };
        await set(ref(db, `accounts/${cred.user.uid}`), account);
        await set(ref(db, usernameIndexPath(ADMIN_USERNAME)), {
          uid: cred.user.uid,
          email: ADMIN_AUTH_EMAIL,
        });
      }
      if (account.role !== "admin") {
        await signOut(auth);
        throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
      }
      return { type: "admin", username: ADMIN_USERNAME };
    } catch (error) {
      if (error instanceof Error && !error.code) throw error;
      throw mapAuthError(error);
    }
  }

  const recSnap = await get(ref(db, usernameIndexPath(id)));
  const rec = recSnap.exists() ? recSnap.val() : null;
  if (rec?.email) {
    try {
      const cred = await signInWithEmailAndPassword(auth, rec.email, password);
      const account = await accountForUser(cred.user.uid);
      if (!account || account.role !== "employee" || !account.personId) {
        await signOut(auth);
        throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
      }
      return {
        type: "employee",
        username: account.username || id,
        personId: account.personId,
      };
    } catch (error) {
      if (error instanceof Error && !error.code) throw error;
      throw mapAuthError(error);
    }
  }

  if (!rec?.personId) {
    throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  }

  let person = null;
  try {
    const personSnap = await get(ref(db, `people/${rec.personId}`));
    person = personSnap.val();
  } catch (error) {
    if (String(error?.code || error?.message || "").includes("PERMISSION_DENIED")) {
      throw new Error("기존 계정은 관리자가 비밀번호를 다시 설정해야 로그인할 수 있습니다.");
    }
    throw mapAuthError(error);
  }
  if (!person || person.passwordHash !== passwordHash) {
    throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  return migrateLegacyPerson(person, id, password);
}

async function migrateLegacyPerson(person, username, password) {
  const email = authEmailFor(username, person.id);
  pendingUid = "pending";
  let cred = null;
  let created = false;
  try {
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
      created = true;
    } catch (error) {
      if (error.code !== "auth/email-already-in-use") throw error;
      cred = await signInWithEmailAndPassword(auth, email, password);
    }
    pendingUid = cred.user.uid;
    const uid = cred.user.uid;
    await update(ref(db, `people/${person.id}`), { uid, passwordHash: null });
    await set(ref(db, `accounts/${uid}`), {
      role: "employee",
      username: person.username || username,
      personId: person.id,
    });
    await set(ref(db, usernameIndexPath(username)), {
      uid,
      email,
      personId: person.id,
    });
    return { type: "employee", username: person.username || username, personId: person.id };
  } catch (error) {
    if (created && cred?.user) await cred.user.delete().catch(() => {});
    else if (cred?.user) await signOut(auth).catch(() => {});
    const code = error?.code || "";
    const message = String(error?.message || "");
    if (code === "PERMISSION_DENIED" || message.includes("PERMISSION_DENIED")) {
      throw new Error("기존 계정은 관리자가 비밀번호를 다시 설정해야 로그인할 수 있습니다.");
    }
    if (error instanceof Error && !error.code) throw error;
    throw mapAuthError(error, "기존 계정을 연결하지 못했습니다. 관리자에게 비밀번호 재설정을 요청하세요.");
  } finally {
    pendingUid = null;
  }
}

async function updateUsernameIndex(person, previousUsername) {
  const next = normalizeUsername(person.username);
  const prev = normalizeUsername(previousUsername);
  if (!isFirebaseEnabled) return;
  if (next === ADMIN_USERNAME) throw new Error("admin 아이디는 사용할 수 없습니다.");

  let email = "";
  let uid = person.uid || "";
  let previousRecord = null;
  if (prev) {
    const prevSnap = await get(ref(db, usernameIndexPath(prev)));
    previousRecord = prevSnap.val() || null;
    email = previousRecord?.email || "";
    uid = uid || previousRecord?.uid || "";
  }
  if (!uid) {
    if (prev && next && prev !== next && previousRecord) {
      await set(ref(db, usernameIndexPath(next)), previousRecord);
      await remove(ref(db, usernameIndexPath(prev)));
    }
    return;
  }
  if (!email && next) email = authEmailFor(next, person.id);
  if (prev && prev !== next) await remove(ref(db, usernameIndexPath(prev)));
  if (next) {
    await set(ref(db, usernameIndexPath(next)), {
      uid,
      email,
      personId: person.id,
    });
  }
  await update(ref(db, `accounts/${uid}`), { username: next });
}

export async function registerEmployee(person, password) {
  assertPassword(password);
  const email = authEmailFor(person.username, person.id);
  await readyAuth();
  pendingUid = "pending";
  let cred = null;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
    pendingUid = cred.user.uid;
    const uid = cred.user.uid;
    await set(ref(db, `people/${person.id}`), personPayload({ ...person, uid }));
    await set(ref(db, `accounts/${uid}`), {
      role: "employee",
      username: person.username,
      personId: person.id,
    });
    await set(ref(db, usernameIndexPath(person.username)), {
      uid,
      email,
      personId: person.id,
    });
    try {
      await refreshStatsFromDb();
    } catch {
      /* 계정은 만들어졌고, 인원 집계만 다음 저장 때 맞춰집니다. */
    }
    return { type: "employee", username: person.username, personId: person.id };
  } catch (error) {
    if (cred?.user) {
      const uid = cred.user.uid;
      await remove(ref(db, `accounts/${uid}`)).catch(() => {});
      await remove(ref(db, `people/${person.id}`)).catch(() => {});
      await remove(ref(db, usernameIndexPath(person.username))).catch(() => {});
      await cred.user.delete().catch(() => {});
    }
    throw mapAuthError(error, "계정 만들기에 실패했습니다.");
  } finally {
    pendingUid = null;
  }
}

export async function createEmployeeAsAdmin(person, password) {
  assertPassword(password);
  if (!auth?.currentUser) throw new Error("다시 로그인해 주세요.");
  const email = authEmailFor(person.username, person.id);
  const secondary = await getSecondaryAuth();
  let cred = null;
  try {
    cred = await createUserWithEmailAndPassword(secondary.auth, email, password);
    const uid = cred.user.uid;
    await set(ref(db, `people/${person.id}`), personPayload({ ...person, uid }));
    await set(ref(db, `accounts/${uid}`), {
      role: "employee",
      username: person.username,
      personId: person.id,
    });
    await set(ref(db, usernameIndexPath(person.username)), {
      uid,
      email,
      personId: person.id,
    });
    await refreshStatsFromDb();
  } catch (error) {
    if (cred?.user) {
      const uid = cred.user.uid;
      await remove(ref(db, `accounts/${uid}`)).catch(() => {});
      await remove(ref(db, `people/${person.id}`)).catch(() => {});
      await remove(ref(db, usernameIndexPath(person.username))).catch(() => {});
      await cred.user.delete().catch(() => {});
    }
    throw mapAuthError(error, "계정을 만들지 못했습니다.");
  } finally {
    await signOut(secondary.auth).catch(() => {});
  }
}

export async function savePerson(person, previousUsername = "") {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const idx = data.people.findIndex((item) => item.id === person.id);
    if (idx >= 0) data.people[idx] = person;
    else data.people.push(person);
    writeLocal(data.people);
    await writeStats(data.people);
    return;
  }
  const currentSnap = await get(ref(db, `people/${person.id}`));
  const current = currentSnap.val() || {};
  const payload = personPayload({ ...current, ...person, uid: person.uid || current.uid || "" });
  await set(ref(db, `people/${person.id}`), payload);
  await updateUsernameIndex(
    { ...person, uid: payload.uid },
    previousUsername || current.username || "",
  );
  await refreshStatsFromDb();
}

export async function patchPerson(personId, fields) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const idx = data.people.findIndex((item) => item.id === personId);
    if (idx < 0) return;
    const previousUsername = data.people[idx].username;
    data.people[idx] = { ...data.people[idx], ...fields };
    writeLocal(data.people);
    if ("username" in fields) await updateUsernameIndex(data.people[idx], previousUsername);
    await writeStats(data.people);
    return;
  }
  const currentSnap = await get(ref(db, `people/${personId}`));
  const current = currentSnap.val() || {};
  const nextFields = { ...fields };
  delete nextFields.passwordHash;
  delete nextFields.uid;
  delete nextFields.id;
  await update(ref(db, `people/${personId}`), nextFields);
  if ("username" in fields) {
    await updateUsernameIndex(
      { ...current, ...nextFields, id: personId, uid: current.uid || "" },
      current.username,
    );
  }
  await refreshStatsFromDb();
}

async function resetPasswordAsAdmin(person, password) {
  const username = normalizeUsername(person.username);
  if (!username) throw new Error("아이디가 없는 계정입니다.");
  const email = authEmailFor(username, `${person.id}${Date.now().toString(36)}`);
  const secondary = await getSecondaryAuth();
  let cred = null;
  try {
    cred = await createUserWithEmailAndPassword(secondary.auth, email, password);
    const uid = cred.user.uid;
    const oldUid = person.uid || "";
    await update(ref(db, `people/${person.id}`), { uid });
    await set(ref(db, `accounts/${uid}`), {
      role: "employee",
      username: person.username,
      personId: person.id,
    });
    await set(ref(db, usernameIndexPath(username)), {
      uid,
      email,
      personId: person.id,
    });
    if (Object.prototype.hasOwnProperty.call(person, "passwordHash")) {
      await update(ref(db, `people/${person.id}`), { passwordHash: null });
    }
    if (oldUid && oldUid !== uid) await remove(ref(db, `accounts/${oldUid}`));
  } catch (error) {
    if (cred?.user) await cred.user.delete().catch(() => {});
    throw mapAuthError(error, "비밀번호를 바꾸지 못했습니다.");
  } finally {
    await signOut(secondary.auth).catch(() => {});
  }
}

export async function setPersonPassword(personId, password) {
  assertPassword(password);
  if (!isFirebaseEnabled) {
    await patchPerson(personId, { passwordHash: await hashPassword(password) });
    return;
  }
  const current = auth.currentUser;
  if (!current) throw new Error("다시 로그인해 주세요.");
  const account = await accountForUser(current.uid);
  const personSnap = await get(ref(db, `people/${personId}`));
  const person = personSnap.val();
  if (!person) throw new Error("계정을 찾을 수 없습니다.");
  const isAdmin = account?.role === "admin";
  if (!isAdmin && account?.personId !== personId) throw new Error("권한이 없습니다.");
  if (!isAdmin) {
    await updatePassword(current, password);
    return;
  }
  await resetPasswordAsAdmin(person, password);
}

export async function deletePerson(personId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const remaining = data.people.filter((item) => item.id !== personId);
    writeLocal(remaining);
    await writeStats(remaining);
    return;
  }
  const currentSnap = await get(ref(db, `people/${personId}`));
  const current = currentSnap.val();
  if (current?.username) await remove(ref(db, usernameIndexPath(current.username)));
  if (current?.uid) await remove(ref(db, `accounts/${current.uid}`));
  await remove(ref(db, `people/${personId}`));
  await refreshStatsFromDb();
}

export async function addLeave(personId, leave) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    if (personHasLeaveOnDate(person, leave.date)) {
      throw new Error("이미 같은 날짜에 등록된 휴가가 있습니다.");
    }
    person.used_leaves = [...(person.used_leaves || []), leave];
    writeLocal(data.people);
    return;
  }
  const personSnap = await get(ref(db, `people/${personId}`));
  const rawLeaves = personSnap.val()?.used_leaves;
  const existing = rawLeaves
    ? Array.isArray(rawLeaves)
      ? rawLeaves
      : Object.values(rawLeaves)
    : [];
  if (existing.some((item) => item.date === leave.date)) {
    throw new Error("이미 같은 날짜에 등록된 휴가가 있습니다.");
  }
  await set(ref(db, `people/${personId}/used_leaves/${leave.id}`), leave);
}

export async function removeLeave(personId, leaveId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    person.used_leaves = (person.used_leaves || []).filter((item) => item.id !== leaveId);
    writeLocal(data.people);
    return;
  }
  await remove(ref(db, `people/${personId}/used_leaves/${leaveId}`));
}

export async function updateLeave(personId, leave) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    person.used_leaves = (person.used_leaves || []).map((item) =>
      item.id === leave.id ? leave : item,
    );
    writeLocal(data.people);
    return;
  }
  await update(ref(db, `people/${personId}/used_leaves/${leave.id}`), {
    amount: leave.amount,
    type: leave.type,
    reason: leave.reason,
  });
}

export async function addDutyWeek(personId, week) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
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
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    person.duty_weeks = (person.duty_weeks || []).filter((item) => item.id !== weekId);
    writeLocal(data.people);
    return;
  }
  await remove(ref(db, `people/${personId}/duty_weeks/${weekId}`));
}

export async function addBonusLeave(personId, bonus) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    person.bonus_leaves = [...(person.bonus_leaves || []), bonus];
    writeLocal(data.people);
    return;
  }
  await set(ref(db, `people/${personId}/bonus_leaves/${bonus.id}`), bonus);
}

export async function removeBonusLeave(personId, bonusId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    person.bonus_leaves = (person.bonus_leaves || []).filter((item) => item.id !== bonusId);
    writeLocal(data.people);
    return;
  }
  await remove(ref(db, `people/${personId}/bonus_leaves/${bonusId}`));
}

export async function addAccessGrant(personId, grant) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    person.access_grants = [...(person.access_grants || []), grant];
    writeLocal(data.people);
    return;
  }
  await set(ref(db, `people/${personId}/access_grants/${grant.id}`), grant);
}

export async function removeAccessGrant(personId, grantId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const person = data.people.find((item) => item.id === personId);
    if (!person) return;
    person.access_grants = (person.access_grants || []).filter((item) => item.id !== grantId);
    writeLocal(data.people);
    return;
  }
  await remove(ref(db, `people/${personId}/access_grants/${grantId}`));
}

export async function usernameTaken(username, exceptPersonId = "") {
  const id = normalizeUsername(username);
  if (!id) return false;
  if (id === ADMIN_USERNAME) return true;
  if (!isFirebaseEnabled) {
    return readLocal().people.some(
      (item) => normalizeUsername(item.username) === id && item.id !== exceptPersonId,
    );
  }
  const snap = await get(ref(db, usernameIndexPath(id)));
  if (!snap.exists()) return false;
  const rec = snap.val() || {};
  if (rec.type === "admin" || !rec.personId) return true;
  return rec.personId !== exceptPersonId;
}
