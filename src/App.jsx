import { useEffect, useState } from "react";
import {
  hashPassword,
  normalizeUsername,
  personRoleLabel,
  RANKS,
  TEAMS,
} from "./auth";
import {
  addLeave,
  deletePerson,
  ensureAdminAccount,
  isFirebaseEnabled,
  login,
  patchPerson,
  removeLeave,
  savePerson,
  setPersonPassword,
  subscribePeople,
  subscribePerson,
  subscribeStats,
  usernameTaken,
} from "./storage";
import {
  DEFAULT_DUTY_INTERVAL_DAYS,
  localToday,
  newLeave,
  newPerson,
  personSummary,
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
  const [sheet, setSheet] = useState(null);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (!isAdmin) {
      setPeople([]);
      return undefined;
    }
    return subscribePeople(({ people: next }) => setPeople(next));
  }, [isAdmin]);

  useEffect(() => {
    if (!isEmployee || !session.personId) {
      setPerson(null);
      return undefined;
    }
    return subscribePerson(session.personId, ({ person: next }) => setPerson(next));
  }, [isEmployee, session?.personId]);

  const today = localToday();
  const summary = selected ? personSummary(selected, today) : null;
  const leaves = selected
    ? [...(selected.used_leaves || [])].sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  function persistSession(next) {
    setSession(next);
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
    setSelectedId("");
    setConfirmDelete(false);
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
      duty_start: fields.hasDuty ? fields.duty_start : null,
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
      duty_start: fields.hasDuty ? fields.duty_start : null,
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
    if (isAdmin) {
      if (!username) throw new Error("아이디를 입력하세요.");
      if (await usernameTaken(username, selected.id)) {
        throw new Error("이미 있는 아이디입니다.");
      }
    }
    const next = {
      ...selected,
      name,
      username: isAdmin ? username : selected.username,
      team: fields.team,
      rank: fields.rank || "member",
      hire_date: fields.hire_date,
      duty_start: fields.hasDuty ? fields.duty_start : null,
      duty_interval_days: Number(fields.duty_interval_days) || DEFAULT_DUTY_INTERVAL_DAYS,
    };
    setBusy(true);
    try {
      await patchPerson(selected.id, {
        name: next.name,
        username: next.username,
        team: next.team,
        rank: next.rank,
        hire_date: next.hire_date,
        duty_start: next.duty_start,
        duty_interval_days: next.duty_interval_days,
      });
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
  const showAdminHome = isAdmin && !selectedId;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>휴가 관리기</h1>
          <p>
            {selected
              ? `${selected.name}의 휴가 기록`
              : isAdmin
                ? "관리자"
                : "팀 인원 현황"}
          </p>
        </div>
        <div className="top-actions">
          <div className={`badge ${mode === "shared" ? "shared" : ""}`}>
            {mode === "shared" ? "공유 저장 중" : "이 브라우저만"}
          </div>
          {session ? (
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
          isAdmin={isAdmin}
          confirmDelete={confirmDelete}
          busy={busy}
          onBack={isAdmin ? () => setSelectedId("") : () => persistSession(null)}
          onAddLeave={() => setSheet("leave")}
          onChangePassword={() => setPasswordTarget(selected)}
          onEditPerson={() => setSheet("person-edit")}
          onAskDelete={() => setConfirmDelete(true)}
          onConfirmDelete={onDeletePerson}
          onRemoveLeave={onRemoveLeave}
        />
      ) : showAdminHome ? (
        <AdminHome
          people={people}
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
          onClose={() => setShowSignup(false)}
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
      {sheet === "person-add" && isAdmin && (
        <PersonSheet
          title="사람 추가"
          busy={busy}
          today={today}
          admin
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
          admin={isAdmin}
          requireAccount={isAdmin}
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

function AdminHome({ people, onAddPerson, onOpenPerson, onEditPassword }) {
  return (
    <>
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
  isAdmin,
  confirmDelete,
  busy,
  onBack,
  onAddLeave,
  onChangePassword,
  onEditPerson,
  onAskDelete,
  onConfirmDelete,
  onRemoveLeave,
}) {
  return (
    <>
      <button className="back" onClick={onBack}>
        {isAdmin ? "← 직원 목록" : "← 로그아웃"}
      </button>

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

      <button className="primary" onClick={onAddLeave}>
        휴가 사용 등록
      </button>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>사용 내역</h2>
        {leaves.length === 0 ? (
          <p className="muted">아직 사용 내역이 없습니다.</p>
        ) : (
          leaves.map((item) => (
            <div className="row" key={item.id}>
              <div>
                <div>{item.date}</div>
                <div className="muted">{item.type}</div>
              </div>
              <button className="tiny" onClick={() => onRemoveLeave(item.id)}>
                삭제
              </button>
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2>계산 기준</h2>
        <ul className="criteria">
          <li>입사일: {selected.hire_date}</li>
          <li>월 1개 연차 발생</li>
          {selected.duty_start ? (
            <>
              <li>당직휴가 시작일: {selected.duty_start}</li>
              <li>{summary.interval}일마다 1개 발생</li>
            </>
          ) : (
            <li>당직휴가 없음</li>
          )}
        </ul>
      </section>

      <div className="actions">
        <button className="ghost" onClick={onChangePassword}>
          비밀번호 변경
        </button>
        {isAdmin ? (
          confirmDelete ? (
            <button className="danger" disabled={busy} onClick={onConfirmDelete}>
              정말 삭제
            </button>
          ) : (
            <button className="ghost" onClick={onEditPerson}>
              정보 수정
            </button>
          )
        ) : null}
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
          <span>아이디</span>
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
  const [type, setType] = useState("연차(1일)");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit({ date, type });
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
            <option>연차(1일)</option>
            <option>반차(0.5일)</option>
          </select>
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

function PersonSheet({
  title,
  busy,
  today,
  initial,
  admin,
  requireAccount,
  requirePassword,
  onClose,
  onSubmit,
}) {
  const [name, setName] = useState(initial?.name || "");
  const [username, setUsername] = useState(initial?.username || "");
  const [password, setPassword] = useState("");
  const [team, setTeam] = useState(initial?.team || "ta");
  const [rank, setRank] = useState(initial?.rank || "member");
  const [hireDate, setHireDate] = useState(initial?.hire_date || today);
  const [hasDuty, setHasDuty] = useState(Boolean(initial?.duty_start));
  const [dutyStart, setDutyStart] = useState(initial?.duty_start || today);
  const [interval, setInterval] = useState(
    initial?.duty_interval_days || DEFAULT_DUTY_INTERVAL_DAYS,
  );
  const [error, setError] = useState("");

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
        hasDuty,
        duty_start: dutyStart,
        duty_interval_days: interval,
      });
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        <label className="field">
          <span>이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        {requireAccount && (
          <label className="field">
            <span>아이디</span>
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
          <span>입사일</span>
          <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
        </label>
        {admin || !initial ? (
          <>
            <label className="check">
              <input type="checkbox" checked={hasDuty} onChange={(e) => setHasDuty(e.target.checked)} />
              당직 있음
            </label>
            {hasDuty && (
              <>
                <label className="field">
                  <span>당직 시작일</span>
                  <input type="date" value={dutyStart} onChange={(e) => setDutyStart(e.target.value)} />
                </label>
                <label className="field">
                  <span>당직 주기(일)</span>
                  <input
                    type="number"
                    min="1"
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                  />
                </label>
              </>
            )}
          </>
        ) : null}
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
