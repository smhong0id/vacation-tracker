import { useEffect, useMemo, useState } from "react";
import {
  addLeave,
  deletePerson,
  isFirebaseEnabled,
  patchPerson,
  removeLeave,
  savePerson,
  subscribe,
} from "./storage";
import {
  DEFAULT_DUTY_INTERVAL_DAYS,
  localToday,
  newLeave,
  newPerson,
  personSummary,
} from "./vacation";

const SELECTED_KEY = "vacation-tracker-selected";

function formatDay(n) {
  return Number(n).toFixed(1);
}

export default function App() {
  const [people, setPeople] = useState([]);
  const [mode, setMode] = useState(isFirebaseEnabled ? "shared" : "local");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(() => sessionStorage.getItem(SELECTED_KEY) || "");
  const [sheet, setSheet] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return subscribe(({ people: next, mode: nextMode }) => {
      setPeople(next);
      setMode(nextMode);
      setLoading(false);
      setSelectedId((current) => {
        if (next.some((p) => p.id === current)) return current;
        const nextId = next[0]?.id || "";
        if (nextId) sessionStorage.setItem(SELECTED_KEY, nextId);
        return nextId;
      });
    });
  }, []);

  const selected = people.find((p) => p.id === selectedId) || people[0] || null;
  const today = localToday();
  const summary = selected ? personSummary(selected, today) : null;
  const overview = useMemo(
    () => people.map((p) => ({ person: p, ...personSummary(p, today) })),
    [people, today],
  );

  function selectPerson(id) {
    setSelectedId(id);
    sessionStorage.setItem(SELECTED_KEY, id);
    setConfirmDelete(false);
  }

  async function onAddPerson(fields) {
    const person = newPerson({
      ...fields,
      duty_start: fields.hasDuty ? fields.duty_start : null,
    });
    if (people.some((p) => p.name === person.name)) {
      throw new Error("같은 이름이 이미 있습니다.");
    }
    setBusy(true);
    try {
      await savePerson(person);
      if (mode === "local") setPeople((prev) => [...prev, person]);
      selectPerson(person.id);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onEditPerson(fields) {
    if (!selected) return;
    const name = fields.name.trim();
    if (!name) throw new Error("이름을 입력하세요.");
    if (people.some((p) => p.name === name && p.id !== selected.id)) {
      throw new Error("같은 이름이 이미 있습니다.");
    }
    const next = {
      ...selected,
      name,
      hire_date: fields.hire_date,
      duty_start: fields.hasDuty ? fields.duty_start : null,
      duty_interval_days: Number(fields.duty_interval_days) || DEFAULT_DUTY_INTERVAL_DAYS,
    };
    setBusy(true);
    try {
      await patchPerson(selected.id, {
        name: next.name,
        hire_date: next.hire_date,
        duty_start: next.duty_start,
        duty_interval_days: next.duty_interval_days,
      });
      if (mode === "local") {
        setPeople((prev) => prev.map((p) => (p.id === selected.id ? next : p)));
      }
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePerson() {
    if (!selected) return;
    setBusy(true);
    try {
      await deletePerson(selected.id);
      if (mode === "local") setPeople((prev) => prev.filter((p) => p.id !== selected.id));
      setConfirmDelete(false);
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
      if (mode === "local") {
        setPeople((prev) =>
          prev.map((p) =>
            p.id === selected.id ? { ...p, used_leaves: [...(p.used_leaves || []), leave] } : p,
          ),
        );
      }
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveLeave(leaveId) {
    if (!selected) return;
    await removeLeave(selected.id, leaveId);
    if (mode === "local") {
      setPeople((prev) =>
        prev.map((p) =>
          p.id === selected.id
            ? { ...p, used_leaves: p.used_leaves.filter((item) => item.id !== leaveId) }
            : p,
        ),
      );
    }
  }

  const leaves = selected
    ? [...(selected.used_leaves || [])].sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>휴가 관리기</h1>
          <p>여러 사람 휴가를 한 주소에서 같이 보고 수정합니다.</p>
        </div>
        <div className={`badge ${mode === "shared" ? "shared" : ""}`}>
          {mode === "shared" ? "공유 저장 중" : "이 브라우저만"}
        </div>
      </header>

      {mode === "local" && (
        <div className="warning">
          지금은 이 휴대폰/PC에만 저장됩니다. 다른 사람도 같은 기록을 보고 고치려면 README의
          Firebase 설정을 넣은 뒤 GitHub Pages에 배포하세요.
        </div>
      )}

      {loading ? (
        <div className="empty">불러오는 중…</div>
      ) : (
        <>
          <div className="people-row">
            {people.map((p) => (
              <button
                key={p.id}
                className={`chip ${p.id === selected?.id ? "active" : ""}`}
                onClick={() => selectPerson(p.id)}
              >
                {p.name}
              </button>
            ))}
            <button className="chip-add" onClick={() => setSheet("person-add")}>
              + 사람
            </button>
          </div>

          {!selected ? (
            <div className="card empty">왼쪽에서 사람을 추가하면 휴가를 기록할 수 있습니다.</div>
          ) : (
            <>
              {people.length > 1 && (
                <section className="card">
                  <h2>전체 현황</h2>
                  <table className="overview">
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>발생</th>
                        <th>사용</th>
                        <th>잔여</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.map((row) => (
                        <tr
                          key={row.person.id}
                          className={row.person.id === selected?.id ? "selected" : ""}
                        >
                          <td>{row.person.name}</td>
                          <td>{formatDay(row.totalEarned)}</td>
                          <td>{formatDay(row.used)}</td>
                          <td>{formatDay(row.remaining)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              <section className="card">
                <h2>{selected.name}의 휴가</h2>
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

              <button className="primary" onClick={() => setSheet("leave")}>
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
                <button className="ghost" onClick={() => setSheet("person-edit")}>
                  사람 수정
                </button>
                {confirmDelete ? (
                  <button className="danger" disabled={busy} onClick={onDeletePerson}>
                    정말 삭제
                  </button>
                ) : (
                  <button className="danger" onClick={() => setConfirmDelete(true)}>
                    이 사람 삭제
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {sheet === "leave" && selected && (
        <LeaveSheet
          today={today}
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={onAddLeave}
        />
      )}
      {sheet === "person-add" && (
        <PersonSheet
          title="사람 추가"
          busy={busy}
          today={today}
          onClose={() => setSheet(null)}
          onSubmit={onAddPerson}
        />
      )}
      {sheet === "person-edit" && selected && (
        <PersonSheet
          title="사람 수정"
          busy={busy}
          today={today}
          initial={selected}
          onClose={() => setSheet(null)}
          onSubmit={onEditPerson}
        />
      )}
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

function PersonSheet({ title, busy, today, initial, onClose, onSubmit }) {
  const [name, setName] = useState(initial?.name || "");
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
        <label className="field">
          <span>입사일</span>
          <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
        </label>
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
