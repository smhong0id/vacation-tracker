import { useEffect, useState } from "react";
import {
  hashPassword,
  normalizeUsername,
  personRoleLabel,
  RANKS,
  TEAMS,
} from "./auth";
import {
  addAccessGrant,
  addBonusLeave,
  addDutyWeek,
  addLeave,
  deletePerson,
  ensureAdminAccount,
  isFirebaseEnabled,
  login,
  patchPerson,
  removeAccessGrant,
  removeBonusLeave,
  removeDutyWeek,
  removeLeave,
  updateLeave,
  savePerson,
  setPersonPassword,
  subscribePeople,
  subscribePerson,
  subscribeStats,
  usernameTaken,
} from "./storage";
import {
  ACCESS_SERVICES,
  daysBetween,
  dutyWeekFromDate,
  formatDutyWeek,
  formatLeaveType,
  isAccessUrgent,
  latestAccessEnd,
  LEAVE_FULL,
  LEAVE_HALF,
  localToday,
  personHasLeaveOnDate,
  newAccessGrant,
  newBonusLeave,
  newDutyWeek,
  newLeave,
  newPerson,
  patchLeaveFields,
  personSummary,
  todayBoard,
} from "./vacation";

const SESSION_KEY = "vacation-tracker-session";

function formatDay(n) {
  return Number(n).toFixed(1);
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export default function App() {
  const [stats, setStats] = useState({ ta: 0, dba: 0 });
  const [people, setPeople] = useState([]);
  const [person, setPerson] = useState(null);
  const [mode, setMode] = useState(isFirebaseEnabled ? "shared" : "local");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(loadSession);
  const [selectedId, setSelectedId] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [signupDraft, setSignupDraft] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [leaveEditTarget, setLeaveEditTarget] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adminView, setAdminView] = useState("dashboard");

  const isAdmin = session?.type === "admin";
  const isEmployee = session?.type === "employee";
  const viewingId = isEmployee ? session.personId : selectedId;
  const selected = isEmployee
    ? person
    : people.find((p) => p.id === viewingId) || null;

  useEffect(() => {
    ensureAdminAccount().catch(() => {});
    return subscribeStats(({ stats: next, mode: nextMode, error: nextError }) => {
      setStats({ ta: next?.ta || 0, dba: next?.dba || 0 });
      setMode(nextMode);
      setError(nextError || "");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!isAdmin && !isEmployee) {
      setPeople([]);
      return undefined;
    }
    return subscribePeople(({ people: next }) => setPeople(next));
  }, [isAdmin, isEmployee]);

  useEffect(() => {
    if (!isEmployee || !session.personId) {
      setPerson(null);
      return undefined;
    }
    return subscribePerson(session.personId, ({ person: next }) => setPerson(next));
  }, [isEmployee, session?.personId]);

  const today = localToday();
  const roster = isEmployee ? todayBoard(people, today) : null;
  const summary = selected ? personSummary(selected, today) : null;
  const leaves = selected
    ? [...(selected.used_leaves || [])].sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];
  const dutyWeeks = selected
    ? [...(selected.duty_weeks || [])].sort((a, b) => (a.start < b.start ? 1 : -1))
    : [];
  const bonusLeaves = selected
    ? [...(selected.bonus_leaves || [])].sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];
  const accessGrants = selected
    ? [...(selected.access_grants || [])].sort((a, b) => {
        if (a.service !== b.service) return a.service.localeCompare(b.service);
        return a.end < b.end ? 1 : -1;
      })
    : [];

  function persistSession(next) {
    setSession(next);
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
    setSelectedId("");
    setAdminView("dashboard");
    setConfirmDelete(false);
    setLeaveEditTarget(null);
    setSheet(null);
  }

  async function onLogin(username, password) {
    const next = await login(username, password);
    persistSession(next);
    setShowLogin(false);
  }

  async function onSignup(fields) {
    const username = normalizeUsername(fields.username);
    if (!username) throw new Error("아이디를 입력하세요.");
    if (await usernameTaken(username)) throw new Error("이미 있는 아이디입니다.");
    if (!fields.password) throw new Error("비밀번호를 입력하세요.");
    if (!fields.team) throw new Error("팀을 선택하세요.");
    const personData = newPerson({
      ...fields,
      username,
      passwordHash: await hashPassword(fields.password),
    });
    setBusy(true);
    try {
      await savePerson(personData);
      persistSession({
        type: "employee",
        username: personData.username,
        personId: personData.id,
      });
      setShowSignup(false);
      setSignupDraft(null);
    } finally {
      setBusy(false);
    }
  }

  async function onAddPerson(fields) {
    const username = normalizeUsername(fields.username);
    if (!username) throw new Error("아이디를 입력하세요.");
    if (await usernameTaken(username)) throw new Error("이미 있는 아이디입니다.");
    if (!fields.password) throw new Error("비밀번호를 입력하세요.");
    const personData = newPerson({
      ...fields,
      username,
      passwordHash: await hashPassword(fields.password),
    });
    if (people.some((p) => p.name === personData.name)) {
      throw new Error("같은 이름이 이미 있습니다.");
    }
    setBusy(true);
    try {
      await savePerson(personData);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onEditPerson(fields) {
    if (!selected) return;
    const name = fields.name.trim();
    if (!name) throw new Error("이름을 입력하세요.");
    const username = normalizeUsername(fields.username);
    if (!username) throw new Error("아이디를 입력하세요.");
    if (await usernameTaken(username, selected.id)) {
      throw new Error("이미 있는 아이디입니다.");
    }
    const next = {
      name,
      username,
      team: fields.team,
      rank: fields.rank || "member",
      hire_date: fields.hire_date,
    };
    setBusy(true);
    try {
      await patchPerson(selected.id, next);
      if (isEmployee) {
        const nextSession = { ...session, username };
        setSession(nextSession);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      }
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePerson() {
    if (!isAdmin || !selected) return;
    setBusy(true);
    try {
      await deletePerson(selected.id);
      setConfirmDelete(false);
      setSelectedId("");
    } finally {
      setBusy(false);
    }
  }

  async function onAddLeave(fields) {
    if (!selected) return;
    if (personHasLeaveOnDate(selected, fields.date)) {
      throw new Error("이미 같은 날짜에 등록된 휴가가 있습니다.");
    }
    const leave = newLeave(fields);
    setBusy(true);
    try {
      await addLeave(selected.id, leave);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveLeave(leaveId) {
    if (!selected) return;
    await removeLeave(selected.id, leaveId);
  }

  async function onEditLeave(fields) {
    if (!selected || !leaveEditTarget) return;
    const next = patchLeaveFields(leaveEditTarget, fields);
    setBusy(true);
    try {
      await updateLeave(selected.id, next);
      setLeaveEditTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function onAddBonusLeave(fields) {
    if (!selected) return;
    const bonus = newBonusLeave(fields);
    setBusy(true);
    try {
      await addBonusLeave(selected.id, bonus);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveBonusLeave(bonusId) {
    if (!selected) return;
    await removeBonusLeave(selected.id, bonusId);
  }

  async function onAddDutyWeek(iso) {
    if (!selected) return;
    const week = newDutyWeek(iso);
    if ((selected.duty_weeks || []).some((item) => item.start === week.start)) {
      throw new Error("이미 등록된 당직 주간입니다.");
    }
    setBusy(true);
    try {
      await addDutyWeek(selected.id, week);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveDutyWeek(weekId) {
    if (!selected) return;
    await removeDutyWeek(selected.id, weekId);
  }

  async function onAddAccessGrant(fields) {
    if (!selected) return;
    const grant = newAccessGrant(fields);
    setBusy(true);
    try {
      await addAccessGrant(selected.id, grant);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveAccessGrant(grantId) {
    if (!selected) return;
    await removeAccessGrant(selected.id, grantId);
  }

  async function onChangePassword(password) {
    if (!passwordTarget) return;
    setBusy(true);
    try {
      await setPersonPassword(passwordTarget.id, password);
      setPasswordTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const showPerson = Boolean(selected && (isAdmin || isEmployee));
  const showAdminDashboard = isAdmin && !selectedId && adminView === "dashboard";
  const showAdminPeople = isAdmin && !selectedId && adminView === "people";

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>휴가 관리기</h1>
          <p>
            {selected
              ? `${selected.name}의 휴가 기록`
              : isAdmin
                ? showAdminPeople
                  ? "직원 관리"
                  : "전체 휴가 현황"
                : "팀 인원 현황"}
          </p>
        </div>
        <div className="top-actions">
          <div className={`badge ${mode === "shared" ? "shared" : ""}`}>
            {mode === "shared" ? "공유 저장 중" : "이 브라우저만"}
          </div>
          {isAdmin ? (
            <button className="linkish" onClick={() => persistSession(null)}>
              로그아웃
            </button>
          ) : null}
        </div>
      </header>

      {error && <div className="warning">{error}</div>}

      {loading ? (
        <div className="empty">불러오는 중…</div>
      ) : isEmployee && !selected ? (
        <div className="empty">불러오는 중…</div>
      ) : showPerson ? (
        <PersonView
          selected={selected}
          summary={summary}
          leaves={leaves}
          dutyWeeks={dutyWeeks}
          bonusLeaves={bonusLeaves}
          accessGrants={accessGrants}
          roster={roster}
          today={today}
          isAdmin={isAdmin}
          confirmDelete={confirmDelete}
          busy={busy}
          onBack={isAdmin ? () => setSelectedId("") : () => persistSession(null)}
          adminBackLabel={adminView === "people" ? "← 직원 목록" : "← 대시보드"}
          onAddLeave={() => setSheet("leave")}
          onAddCustomLeave={() => setSheet("bonus-leave")}
          onAddDutyWeek={() => setSheet("duty")}
          onAddAccessGrant={() => setSheet("access")}
          onChangePassword={() => setPasswordTarget(selected)}
          onEditPerson={() => setSheet("person-edit")}
          onAskDelete={() => setConfirmDelete(true)}
          onConfirmDelete={onDeletePerson}
          onEditLeave={setLeaveEditTarget}
          onRemoveLeave={onRemoveLeave}
          onRemoveBonusLeave={onRemoveBonusLeave}
          onRemoveDutyWeek={onRemoveDutyWeek}
          onRemoveAccessGrant={onRemoveAccessGrant}
        />
      ) : showAdminDashboard ? (
        <AdminDashboard
          people={people}
          today={today}
          onManagePeople={() => setAdminView("people")}
          onOpenPerson={setSelectedId}
        />
      ) : showAdminPeople ? (
        <AdminHome
          people={people}
          onBack={() => setAdminView("dashboard")}
          onAddPerson={() => setSheet("person-add")}
          onOpenPerson={setSelectedId}
          onEditPassword={setPasswordTarget}
        />
      ) : (
        <Dashboard
          stats={stats}
          onLogin={() => setShowLogin(true)}
          onSignup={() => setShowSignup(true)}
        />
      )}

      {showLogin && (
        <LoginSheet onClose={() => setShowLogin(false)} onSubmit={onLogin} />
      )}
      {showSignup && (
        <PersonSheet
          title="계정 만들기"
          busy={busy}
          today={today}
          requireAccount
          requirePassword
          initial={signupDraft}
          onClose={(draft) => {
            setSignupDraft(draft || null);
            setShowSignup(false);
          }}
          onSubmit={onSignup}
        />
      )}
      {sheet === "leave" && selected && (
        <LeaveSheet
          today={today}
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={onAddLeave}
        />
      )}
      {leaveEditTarget && selected && (
        <LeaveEditSheet
          leave={leaveEditTarget}
          busy={busy}
          onClose={() => setLeaveEditTarget(null)}
          onSubmit={onEditLeave}
        />
      )}
      {sheet === "bonus-leave" && selected && (
        <BonusLeaveSheet
          today={today}
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={onAddBonusLeave}
        />
      )}
      {sheet === "duty" && selected && (
        <DutyWeekSheet
          today={today}
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={onAddDutyWeek}
        />
      )}
      {sheet === "access" && selected && (
        <AccessGrantSheet
          today={today}
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={onAddAccessGrant}
        />
      )}
      {sheet === "person-add" && isAdmin && (
        <PersonSheet
          title="사람 추가"
          busy={busy}
          today={today}
          requireAccount
          requirePassword
          onClose={() => setSheet(null)}
          onSubmit={onAddPerson}
        />
      )}
      {sheet === "person-edit" && selected && (
        <PersonSheet
          title="정보 수정"
          busy={busy}
          today={today}
          requireAccount
          initial={selected}
          onClose={() => setSheet(null)}
          onSubmit={onEditPerson}
        />
      )}
      {passwordTarget && (
        <PasswordResetSheet
          name={passwordTarget.name}
          busy={busy}
          onClose={() => setPasswordTarget(null)}
          onSubmit={onChangePassword}
        />
      )}
    </div>
  );
}

function Dashboard({ stats, onLogin, onSignup }) {
  return (
    <>
      <section className="card">
        <h2>대시보드</h2>
        <div className="metrics two">
          <div className="metric main">
            <span>TA 팀</span>
            <strong>{stats.ta}명</strong>
          </div>
          <div className="metric">
            <span>DBA 팀</span>
            <strong>{stats.dba}명</strong>
          </div>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          PM은 인원 현황에서 제외됩니다. PL은 소속 팀 인원에 포함됩니다.
        </p>
      </section>
      <div className="actions">
        <button className="secondary" onClick={onSignup}>
          계정 만들기
        </button>
        <button className="primary" onClick={onLogin}>
          로그인
        </button>
      </div>
    </>
  );
}

function buildLeaveIndex(people) {
  const byDate = {};
  for (const person of people) {
    for (const leave of person.used_leaves || []) {
      if (!leave.date) continue;
      if (!byDate[leave.date]) byDate[leave.date] = [];
      byDate[leave.date].push({
        personId: person.id,
        name: person.name,
        type: leave.type,
        amount: leave.amount,
        reason: leave.reason || "",
      });
    }
  }
  return byDate;
}

function calendarCells(year, month) {
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const dim = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let d = 1; d <= dim; d += 1) {
    const mm = String(month).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    cells.push(`${year}-${mm}-${dd}`);
  }
  return cells;
}

function accessEndMeta(end, today) {
  if (!end) return { label: "—", hint: "", urgent: false, expired: false };
  const days = daysBetween(today, end);
  const urgent = isAccessUrgent(end, today);
  if (days < 0) return { label: end, hint: "만료됨", urgent: true, expired: true };
  if (days === 0) return { label: end, hint: "오늘 만료", urgent: true, expired: false };
  if (urgent) return { label: end, hint: `D-${days}`, urgent: true, expired: false };
  return { label: end, hint: "", urgent: false, expired: false };
}

function personAccessEnds(person) {
  return Object.keys(ACCESS_SERVICES).map((service) => ({
    service,
    end: latestAccessEnd(person, service),
  }));
}

function AccessDateCell({ end, today }) {
  const meta = accessEndMeta(end, today);
  if (!end) return <span className="access-empty">—</span>;
  return (
    <span className={`access-date${meta.urgent ? " urgent" : ""}`}>
      {meta.label}
      {meta.hint ? <small>{meta.hint}</small> : null}
    </span>
  );
}

function shiftMonth(year, month, delta) {
  let m = month + delta;
  let y = year;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

function AdminDashboard({ people, today, onManagePeople, onOpenPerson }) {
  const [y, m] = today.split("-").map(Number);
  const [ym, setYm] = useState({ year: y, month: m });
  const [selectedDate, setSelectedDate] = useState(today);
  const leaveIndex = buildLeaveIndex(people);
  const cells = calendarCells(ym.year, ym.month);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>휴가 달력</h2>
          <div className="calendar-nav">
            <button
              type="button"
              className="ghost tiny"
              onClick={() => setYm((prev) => shiftMonth(prev.year, prev.month, -1))}
            >
              ←
            </button>
            <strong>
              {ym.year}년 {ym.month}월
            </strong>
            <button
              type="button"
              className="ghost tiny"
              onClick={() => setYm((prev) => shiftMonth(prev.year, prev.month, 1))}
            >
              →
            </button>
          </div>
        </div>
        <div className="calendar-weekdays">
          {["월", "화", "수", "목", "금", "토", "일"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((iso, index) => {
            if (!iso) return <div className="calendar-cell empty" key={`e-${index}`} />;
            const count = leaveIndex[iso]?.length || 0;
            return (
              <button
                type="button"
                key={iso}
                className={[
                  "calendar-cell",
                  count ? "has-leave" : "",
                  iso === today ? "today" : "",
                  iso === selectedDate ? "selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelectedDate(iso)}
              >
                <span>{Number(iso.slice(-2))}</span>
                {count ? <em>{count}</em> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>{selectedDate} 휴가</h2>
        {!leaveIndex[selectedDate]?.length ? (
          <p className="muted">이 날 등록된 휴가가 없습니다.</p>
        ) : (
          leaveIndex[selectedDate].map((item) => (
            <div className="row" key={`${item.personId}-${item.type}-${item.reason}`}>
              <div>
                <button type="button" className="name-link" onClick={() => onOpenPerson(item.personId)}>
                  {item.name}
                </button>
                <div className="muted">
                  {formatLeaveType(item.type)} · {formatDay(item.amount)}일
                  {item.reason ? ` · ${item.reason}` : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>직원별 권한 만료일</h2>
        <p className="muted">RBS / SCOP / SBC 만료일입니다. 2주 전부터 빨간색으로 표시됩니다.</p>
        {people.length === 0 ? (
          <p className="muted">등록된 직원이 없습니다.</p>
        ) : (
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>이름</th>
                  {Object.keys(ACCESS_SERVICES).map((service) => (
                    <th key={service}>{service}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const ends = personAccessEnds(p);
                  const hasUrgent = ends.some(({ end }) => isAccessUrgent(end, today));
                  return (
                    <tr key={p.id} className={hasUrgent ? "has-urgent" : ""}>
                      <td>
                        <button type="button" className="name-link" onClick={() => onOpenPerson(p.id)}>
                          {p.name}
                        </button>
                      </td>
                      {ends.map(({ service, end }) => (
                        <td key={service}>
                          <AccessDateCell end={end} today={today} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>직원별 휴가 현황</h2>
        {people.length === 0 ? (
          <p className="muted">등록된 직원이 없습니다.</p>
        ) : (
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>구분</th>
                  <th>남음</th>
                  <th>발생</th>
                  <th>사용</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const s = personSummary(p, today);
                  return (
                    <tr key={p.id}>
                      <td>
                        <button type="button" className="name-link" onClick={() => onOpenPerson(p.id)}>
                          {p.name}
                        </button>
                      </td>
                      <td className="muted">{personRoleLabel(p)}</td>
                      <td>
                        <strong>{formatDay(s.remaining)}</strong>
                      </td>
                      <td>{formatDay(s.totalEarned)}</td>
                      <td>{formatDay(s.used)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <button className="primary" onClick={onManagePeople}>
        직원 관리
      </button>
    </>
  );
}

function AdminHome({ people, onBack, onAddPerson, onOpenPerson, onEditPassword }) {
  return (
    <>
      <button className="back" onClick={onBack}>
        ← 대시보드
      </button>
      <section className="card">
        <h2>직원</h2>
        {people.length === 0 ? (
          <p className="muted">아직 등록된 사람이 없습니다.</p>
        ) : (
          <div className="person-grid">
            {people.map((p) => (
              <div className="person-card" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="role-tag">
                    {personRoleLabel(p)}
                    {p.username ? ` · ${p.username}` : " · 아이디 없음"}
                  </div>
                </div>
                <div>
                  <button className="ghost" onClick={() => onOpenPerson(p.id)}>
                    휴가
                  </button>
                  <button className="ghost" onClick={() => onEditPassword(p)}>
                    비밀번호
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <button className="primary" onClick={onAddPerson}>
        사람 추가
      </button>
    </>
  );
}

function PersonView({
  selected,
  summary,
  leaves,
  dutyWeeks,
  bonusLeaves,
  accessGrants,
  roster,
  today,
  isAdmin,
  adminBackLabel,
  confirmDelete,
  busy,
  onBack,
  onAddLeave,
  onAddCustomLeave,
  onAddDutyWeek,
  onAddAccessGrant,
  onChangePassword,
  onEditPerson,
  onAskDelete,
  onConfirmDelete,
  onEditLeave,
  onRemoveLeave,
  onRemoveBonusLeave,
  onRemoveDutyWeek,
  onRemoveAccessGrant,
}) {
  return (
    <>
      <button className="back" onClick={onBack}>
        {isAdmin ? adminBackLabel : "← 로그아웃"}
      </button>

      {!isAdmin && roster ? (
        <section className="card today-board">
          <h2>오늘 · {today}</h2>
          <div className="today-board-grid">
            <div className="today-board-block">
              <span>휴가자</span>
              {roster.onLeave.length === 0 ? (
                <p className="muted">없음</p>
              ) : (
                <ul>
                  {roster.onLeave.map((item) => (
                    <li key={item.id}>
                      <strong>
                        {item.name} ({item.amount}일)
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="today-board-block">
              <span>당직자</span>
              {roster.onDuty.length === 0 ? (
                <p className="muted">없음</p>
              ) : (
                <ul>
                  {roster.onDuty.map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>
          {selected.name}의 휴가
          <span className="role-tag"> {personRoleLabel(selected)}</span>
        </h2>
        <div className="metrics">
          <div className="metric main">
            <span>남은 휴가</span>
            <strong>{formatDay(summary.remaining)}</strong>
          </div>
          <div className="metric">
            <span>총 발생</span>
            <strong>{formatDay(summary.totalEarned)}</strong>
          </div>
          <div className="metric">
            <span>사용</span>
            <strong>{formatDay(summary.used)}</strong>
          </div>
        </div>
      </section>

      <div className="actions">
        <button className="secondary" onClick={onAddDutyWeek}>
          당직 주간 추가
        </button>
        <button className="primary" onClick={onAddLeave}>
          휴가 사용 등록
        </button>
      </div>
      {!isAdmin ? (
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="secondary" onClick={onAddCustomLeave}>
            기타 휴가 추가
          </button>
          <button className="secondary" onClick={onAddAccessGrant}>
            계정 이용 권한일
          </button>
        </div>
      ) : null}

      <section className="card" style={{ marginTop: 14 }}>
        <h2>사용 내역</h2>
        {leaves.length === 0 ? (
          <p className="muted">아직 사용 내역이 없습니다.</p>
        ) : (
          leaves.map((item) => (
            <div className="row" key={item.id}>
              <div>
                <div>{item.date}</div>
                <div className="muted">
                  {formatLeaveType(item.type)} · {formatDay(item.amount)}일
                </div>
                {item.reason ? <div className="leave-reason">{item.reason}</div> : null}
              </div>
              <div className="row-actions">
                <button className="tiny" onClick={() => onEditLeave(item)}>
                  수정
                </button>
                <button className="tiny" onClick={() => onRemoveLeave(item.id)}>
                  삭제
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>기타 휴가 (보상)</h2>
        <p className="muted">특별 사유로 추가로 부여받은 휴가 일수입니다. 총 발생·남은 휴가에 합산됩니다.</p>
        {bonusLeaves.length === 0 ? (
          <p className="muted">등록된 기타 휴가가 없습니다.</p>
        ) : (
          bonusLeaves.map((item) => (
            <div className="row" key={item.id}>
              <div>
                <div>
                  +{formatDay(item.amount)}일
                  {item.date ? <span className="muted"> · {item.date}</span> : null}
                </div>
                {item.reason ? <div className="leave-reason">{item.reason}</div> : null}
              </div>
              <button className="tiny" onClick={() => onRemoveBonusLeave(item.id)}>
                삭제
              </button>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>당직 주간</h2>
        <p className="muted">월요일~일요일 1주당 당직휴가 1일이 발생합니다. 연속 주도 각각 추가하세요.</p>
        {dutyWeeks.length === 0 ? (
          <p className="muted">등록된 당직 주간이 없습니다.</p>
        ) : (
          dutyWeeks.map((week) => (
            <div className="row" key={week.id}>
              <div>
                <div>{formatDutyWeek(week)}</div>
                <div className="muted">
                  {week.start <= localToday() ? "당직휴가 1일" : "아직 발생 전"}
                </div>
              </div>
              <button className="tiny" onClick={() => onRemoveDutyWeek(week.id)}>
                삭제
              </button>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>계정 이용 권한일</h2>
        <p className="muted">서비스별 계정 이용 만료일입니다.</p>
        {accessGrants.length === 0 ? (
          <p className="muted">등록된 권한일이 없습니다.</p>
        ) : (
          accessGrants.map((grant) => (
            <div className="row" key={grant.id}>
              <div>
                <div className="access-service">{grant.service}</div>
                <div className="muted">
                  만료일 <AccessDateCell end={grant.end} today={localToday()} />
                </div>
              </div>
              {!isAdmin ? (
                <button className="tiny" onClick={() => onRemoveAccessGrant(grant.id)}>
                  삭제
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>계산 기준</h2>
        <ul className="criteria">
          <li>연차 생성 시작일: {selected.hire_date}</li>
          <li>연차 생성 시작일 기준 월 1일 발생 · 현재 {formatDay(summary.earnedAnnual)}일</li>
          <li>당직 1주 = 휴가 1일 · 현재 {formatDay(summary.earnedDuty)}일</li>
          <li>기타(보상) 휴가 · 현재 {formatDay(summary.earnedBonus)}일</li>
        </ul>
      </section>

      <div className="actions">
        <button className="ghost" onClick={onChangePassword}>
          비밀번호 변경
        </button>
        {confirmDelete ? (
          <button className="danger" disabled={busy} onClick={onConfirmDelete}>
            정말 삭제
          </button>
        ) : (
          <button className="ghost" onClick={onEditPerson}>
            정보 수정
          </button>
        )}
      </div>
      {isAdmin && !confirmDelete ? (
        <button className="danger" style={{ marginTop: 8 }} onClick={onAskDelete}>
          이 사람 삭제
        </button>
      ) : null}
    </>
  );
}

function LoginSheet({ onClose, onSubmit }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSubmit(username, password);
    } catch (err) {
      setError(err.message || "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>로그인</h3>
        <label className="field">
          <span>아이디 (점 포함 가능)</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            입장
          </button>
        </div>
      </form>
    </div>
  );
}

function LeaveSheet({ today, busy, onClose, onSubmit }) {
  const [date, setDate] = useState(today);
  const [type, setType] = useState(LEAVE_FULL);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit({ date, type, reason });
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>휴가 사용 등록</h3>
        <label className="field">
          <span>사용 날짜</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>종류</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value={LEAVE_FULL}>하루 휴가 (1일)</option>
            <option value={LEAVE_HALF}>반일 휴가 (0.5일)</option>
          </select>
        </label>
        <label className="field">
          <span>사유</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={80}
            placeholder="한 줄로 적어 주세요"
          />
        </label>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            추가
          </button>
        </div>
      </form>
    </div>
  );
}

function LeaveEditSheet({ leave, busy, onClose, onSubmit }) {
  const [amount, setAmount] = useState(String(leave.amount));
  const [reason, setReason] = useState(leave.reason || "");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit({ amount: Number(amount), reason });
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>휴가 내역 수정</h3>
        <label className="field">
          <span>날짜</span>
          <input type="date" value={leave.date} readOnly />
        </label>
        <label className="field">
          <span>종류</span>
          <div className="readonly-value">{formatLeaveType(leave.type)}</div>
        </label>
        <label className="field">
          <span>일수</span>
          <select value={amount} onChange={(e) => setAmount(e.target.value)}>
            <option value="1">1일</option>
            <option value="0.5">0.5일</option>
          </select>
        </label>
        <label className="field">
          <span>사유</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={80}
            placeholder="한 줄로 적어 주세요"
          />
        </label>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            저장
          </button>
        </div>
      </form>
    </div>
  );
}

function BonusLeaveSheet({ today, busy, onClose, onSubmit }) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit({ date, amount, reason });
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>기타 휴가 추가</h3>
        <p className="muted">보상·특별 사유로 휴가 일수를 추가로 부여합니다. 남은 휴가가 늘어납니다.</p>
        <label className="field">
          <span>부여일</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>추가 일수</span>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>사유</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={80}
            placeholder="예: 주말 근무 보상"
            required
          />
        </label>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            추가
          </button>
        </div>
      </form>
    </div>
  );
}

function AccessGrantSheet({ today, busy, onClose, onSubmit }) {
  const [service, setService] = useState("RBS");
  const [end, setEnd] = useState(today);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit({ service, end });
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>계정 이용 권한일</h3>
        <p className="muted">서비스별 계정 이용 만료일을 등록합니다.</p>
        <label className="field">
          <span>구분자</span>
          <select value={service} onChange={(e) => setService(e.target.value)}>
            {Object.keys(ACCESS_SERVICES).map((key) => (
              <option key={key} value={key}>
                {ACCESS_SERVICES[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>만료일</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            추가
          </button>
        </div>
      </form>
    </div>
  );
}

function DutyWeekSheet({ today, busy, onClose, onSubmit }) {
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const week = dutyWeekFromDate(date);

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit(date);
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>당직 주간 추가</h3>
        <p className="muted">
          당직을 선 주의 아무 날짜나 고르면 월요일~일요일로 맞춰집니다. 1주당 휴가 1일입니다.
        </p>
        <label className="field">
          <span>당직 날짜</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <p className="week-preview">{formatDutyWeek(week)} · 휴가 1일</p>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            추가
          </button>
        </div>
      </form>
    </div>
  );
}

function PersonSheet({
  title,
  busy,
  today,
  initial,
  requireAccount,
  requirePassword,
  onClose,
  onSubmit,
}) {
  const [name, setName] = useState(initial?.name || "");
  const [username, setUsername] = useState(initial?.username || "");
  const [password, setPassword] = useState(initial?.password || "");
  const [team, setTeam] = useState(initial?.team || "ta");
  const [rank, setRank] = useState(initial?.rank || "member");
  const [hireDate, setHireDate] = useState(initial?.hire_date || today);
  const [error, setError] = useState("");

  function draft() {
    return {
      name,
      username,
      password,
      team,
      rank,
      hire_date: hireDate,
    };
  }

  function close() {
    onClose(draft());
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    try {
      await onSubmit({
        name,
        username,
        password,
        team,
        rank,
        hire_date: hireDate,
      });
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={close}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        <label className="field">
          <span>이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        {requireAccount && (
          <label className="field">
            <span>아이디 (점 포함 가능)</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
        )}
        {requirePassword && (
          <label className="field">
            <span>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        )}
        <label className="field">
          <span>팀</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            {Object.keys(TEAMS).map((key) => (
              <option key={key} value={key}>
                {TEAMS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>직급</span>
          <select value={rank} onChange={(e) => setRank(e.target.value)}>
            {Object.keys(RANKS).map((key) => (
              <option key={key} value={key}>
                {RANKS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>연차 생성 시작일</span>
          <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
        </label>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={close}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            저장
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordResetSheet({ name, busy, onClose, onSubmit }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 4) {
      setError("비밀번호를 4자 이상 입력하세요.");
      return;
    }
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err.message || "변경에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{name} 비밀번호 변경</h3>
        <label className="field">
          <span>새 비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
            required
          />
        </label>
        {error && <p className="warning">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            변경
          </button>
        </div>
      </form>
    </div>
  );
}
