import { initializeApp } from "firebase/app";
import { getDatabase, onValue, ref, remove, set, update } from "firebase/database";
import { firebaseConfig } from "./firebaseConfig";
import { peopleFromRecord } from "./vacation";
import { seedData } from "./seed";

const LOCAL_KEY = "vacation-tracker-data";

export const isFirebaseEnabled = Boolean(
  firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId,
);

let db = null;
if (isFirebaseEnabled) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return structuredClone(seedData);
    return { people: peopleFromRecord(JSON.parse(raw).people) };
  } catch {
    return structuredClone(seedData);
  }
}

function writeLocal(people) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ people }));
}

export function subscribe(onData) {
  if (!isFirebaseEnabled) {
    onData({ people: readLocal().people, mode: "local" });
    const onStorage = (event) => {
      if (event.key === LOCAL_KEY) {
        onData({ people: readLocal().people, mode: "local" });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }

  const peopleRef = ref(db, "people");
  const unsubscribe = onValue(peopleRef, async (snap) => {
    if (!snap.exists()) {
      const seed = {};
      for (const person of seedData.people) {
        seed[person.id] = toFirebasePerson(person);
      }
      await set(peopleRef, seed);
      onData({ people: seedData.people, mode: "shared" });
      return;
    }
    onData({ people: peopleFromRecord(snap.val()), mode: "shared" });
  });
  return unsubscribe;
}

function toFirebasePerson(person) {
  const leaves = {};
  for (const leave of person.used_leaves || []) {
    const id = leave.id || crypto.randomUUID();
    leaves[id] = { ...leave, id };
  }
  return {
    id: person.id,
    name: person.name,
    hire_date: person.hire_date,
    duty_start: person.duty_start || null,
    duty_interval_days: person.duty_interval_days || 21,
    used_leaves: leaves,
  };
}

export async function savePerson(person) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const idx = data.people.findIndex((p) => p.id === person.id);
    if (idx >= 0) data.people[idx] = person;
    else data.people.push(person);
    writeLocal(data.people);
    return;
  }
  const currentLeaves = {};
  for (const leave of person.used_leaves || []) {
    currentLeaves[leave.id] = leave;
  }
  await set(ref(db, `people/${person.id}`), {
    id: person.id,
    name: person.name,
    hire_date: person.hire_date,
    duty_start: person.duty_start || null,
    duty_interval_days: person.duty_interval_days || 21,
    used_leaves: currentLeaves,
  });
}

export async function patchPerson(personId, fields) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    const idx = data.people.findIndex((p) => p.id === personId);
    if (idx < 0) return;
    data.people[idx] = { ...data.people[idx], ...fields };
    writeLocal(data.people);
    return;
  }
  await update(ref(db, `people/${personId}`), fields);
}

export async function deletePerson(personId) {
  if (!isFirebaseEnabled) {
    const data = readLocal();
    writeLocal(data.people.filter((p) => p.id !== personId));
    return;
  }
  await remove(ref(db, `people/${personId}`));
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
