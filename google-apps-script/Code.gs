/**
 * 휴가일정 시트 → Firebase Realtime Database 동기화
 *
 * 시트 컬럼: 휴가자 | 휴가 시작일 | 휴가 종료일 | (선택) 동기화
 * 규칙: 주말 포함, 공휴일 제외, 반차 포함 시 0.5일, 이름은 people.name 과 완전 일치
 */

const SHEET_NAME = "휴가일정";
const HOLIDAY_SHEET_NAME = "공휴일";
const FIREBASE_DB_URL =
  "https://company-vacation-default-rtdb.asia-southeast1.firebasedatabase.app";
const TIMEZONE = "Asia/Seoul";

const LEAVE_FULL = "하루 휴가";
const LEAVE_HALF = "반일 휴가";

const COL = {
  REQUESTER: 0,
  START: 1,
  END: 2,
  STATUS: 3,
};

/** 매년 공휴일·대체공휴일을 갱신하거나, 시트 "공휴일" 탭 A열에 YYYY-MM-DD 추가 */
const BUILTIN_HOLIDAYS = [
  // 2025
  "2025-01-01",
  "2025-01-28",
  "2025-01-29",
  "2025-01-30",
  "2025-03-01",
  "2025-03-03",
  "2025-05-05",
  "2025-05-06",
  "2025-06-06",
  "2025-08-15",
  "2025-10-03",
  "2025-10-05",
  "2025-10-06",
  "2025-10-07",
  "2025-10-08",
  "2025-10-09",
  "2025-12-25",
  // 2026
  "2026-01-01",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-03-01",
  "2026-03-02",
  "2026-05-05",
  "2026-05-24",
  "2026-05-25",
  "2026-06-06",
  "2026-08-15",
  "2026-08-17",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
  "2026-10-03",
  "2026-10-05",
  "2026-10-09",
  "2026-12-25",
  // 2027
  "2027-01-01",
  "2027-02-06",
  "2027-02-07",
  "2027-02-08",
  "2027-02-09",
  "2027-03-01",
  "2027-05-05",
  "2027-05-13",
  "2027-06-06",
  "2027-08-15",
  "2027-08-16",
  "2027-09-14",
  "2027-09-15",
  "2027-09-16",
  "2027-10-03",
  "2027-10-04",
  "2027-10-09",
  "2027-10-11",
  "2027-12-25",
];

function syncVacationSheet() {
  ensureStatusHeader();
  const holidaySet = loadHolidaySet();
  const peopleByName = fetchPeopleByName();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error(`"${SHEET_NAME}" 시트를 찾을 수 없습니다.`);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, 1, lastRow - 1, COL.STATUS + 1);
  const rows = range.getValues();

  for (let i = 0; i < rows.length; i += 1) {
    const rowIndex = i + 2;
    const row = rows[i];
    const status = String(row[COL.STATUS] || "").trim();
    if (status === "완료") continue;

    const requesterRaw = String(row[COL.REQUESTER] || "").trim();
    const startIso = toIsoDate(row[COL.START]);
    const endIso = toIsoDate(row[COL.END]);

    if (!requesterRaw || !startIso || !endIso) {
      sheet.getRange(rowIndex, COL.STATUS + 1).setValue("오류: 빈 칸");
      continue;
    }

    const parsed = parseRequester(requesterRaw);
    const personId = peopleByName[parsed.name];
    if (!personId) {
      sheet.getRange(rowIndex, COL.STATUS + 1).setValue(`오류: 미등록 ${parsed.name}`);
      continue;
    }

    const dates = expandDates(startIso, endIso, holidaySet);
    if (dates.length === 0) {
      sheet.getRange(rowIndex, COL.STATUS + 1).setValue("완료(적용일 없음)");
      continue;
    }

    const half = requesterRaw.indexOf("반차") >= 0;
    const existingDates = fetchLeaveDates(personId);
    let added = 0;
    let skipped = 0;

    for (let d = 0; d < dates.length; d += 1) {
      const date = dates[d];
      if (existingDates[date]) {
        skipped += 1;
        continue;
      }
      const leave = {
        id: Utilities.getUuid(),
        date: date,
        amount: half ? 0.5 : 1,
        type: half ? LEAVE_HALF : LEAVE_FULL,
        reason: parsed.reason,
      };
      firebasePut(`people/${personId}/used_leaves/${leave.id}`, leave);
      existingDates[date] = true;
      added += 1;
    }

    let result = "완료";
    if (added > 0 && skipped > 0) result = `완료 +${added} 중복${skipped}`;
    else if (added > 0) result = `완료 +${added}`;
    else if (skipped > 0) result = `완료(중복${skipped})`;
    sheet.getRange(rowIndex, COL.STATUS + 1).setValue(result);
  }
}

function parseRequester(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (match) {
    return { name: match[1].trim(), reason: match[2].trim() };
  }
  return { name: trimmed, reason: "" };
}

function expandDates(startIso, endIso, holidaySet) {
  if (startIso > endIso) {
    const tmp = startIso;
    startIso = endIso;
    endIso = tmp;
  }
  const out = [];
  let current = startIso;
  while (current <= endIso) {
    if (!holidaySet[current]) out.push(current);
    current = addDaysIso(current, 1);
  }
  return out;
}

function addDaysIso(iso, days) {
  const parts = iso.split("-").map(Number);
  const dt = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return Utilities.formatDate(dt, TIMEZONE, "yyyy-MM-dd");
}

function toIsoDate(value) {
  if (!value && value !== 0) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd");
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return "";
}

function loadHolidaySet() {
  const set = {};
  for (let i = 0; i < BUILTIN_HOLIDAYS.length; i += 1) {
    set[BUILTIN_HOLIDAYS[i]] = true;
  }
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const holidaySheet = book.getSheetByName(HOLIDAY_SHEET_NAME);
  if (!holidaySheet) return set;

  const lastRow = holidaySheet.getLastRow();
  if (lastRow < 1) return set;

  const values = holidaySheet.getRange(1, 1, lastRow, 1).getValues();
  for (let i = 0; i < values.length; i += 1) {
    const iso = toIsoDate(values[i][0]);
    if (iso) set[iso] = true;
  }
  return set;
}

function fetchPeopleByName() {
  const raw = firebaseGet("people");
  const map = {};
  if (!raw) return map;

  const list = Array.isArray(raw) ? raw : Object.values(raw);
  for (let i = 0; i < list.length; i += 1) {
    const person = list[i];
    if (person && person.name) map[String(person.name)] = person.id;
  }
  return map;
}

function fetchLeaveDates(personId) {
  const raw = firebaseGet(`people/${personId}/used_leaves`);
  const map = {};
  if (!raw) return map;

  const list = Array.isArray(raw) ? raw : Object.values(raw);
  for (let i = 0; i < list.length; i += 1) {
    const leave = list[i];
    if (leave && leave.date) map[leave.date] = true;
  }
  return map;
}

function firebaseGet(path) {
  const url = `${FIREBASE_DB_URL}/${path}.json${authQuery()}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() >= 400) {
    throw new Error(`Firebase GET 실패 (${path}): ${res.getContentText()}`);
  }
  const text = res.getContentText();
  if (!text || text === "null") return null;
  return JSON.parse(text);
}

function firebasePut(path, data) {
  const url = `${FIREBASE_DB_URL}/${path}.json${authQuery()}`;
  const res = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 400) {
    throw new Error(`Firebase PUT 실패 (${path}): ${res.getContentText()}`);
  }
}

function authQuery() {
  const secret = PropertiesService.getScriptProperties().getProperty("FIREBASE_AUTH");
  return secret ? `?auth=${encodeURIComponent(secret)}` : "";
}

function ensureStatusHeader() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;
  const header = String(sheet.getRange(1, COL.STATUS + 1).getValue() || "").trim();
  if (!header) {
    sheet.getRange(1, COL.STATUS + 1).setValue("동기화");
  }
}

function installTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === "syncVacationSheet") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("syncVacationSheet")
    .timeBased()
    .everyMinutes(5)
    .create();
}

function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === "syncVacationSheet") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
