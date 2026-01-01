// main.js (루트) — index.html: <script type="module" src="./main.js"></script>
window.__MAIN_LOADED__ = true;

window.addEventListener("error", (e) => {
  console.error("GLOBAL ERROR:", e.error || e.message, e);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("UNHANDLED REJECTION:", e.reason);
});

import { GameEngine } from "./engine/game.js";
import { COMMAND_DEFS, statEligible as cmdStatEligible } from "./engine/commands.js";

// -------------------------------
// DOM helpers
// -------------------------------
const $ = (id) => document.getElementById(id);
const pick = (...ids) => ids.map($).find(Boolean) || null;

function elAssert(el, name) {
  if (!el) console.warn(`[main.js] missing element: ${name}`);
  return el;
}

// ---- Containers (호환 대응) ----
const statsGrid = elAssert(pick("statsGrid", "statusGrid"), "statsGrid/statusGrid");
const persGrid = elAssert(pick("persGrid", "personalityGrid"), "persGrid/personalityGrid");
const commandGrid = elAssert(pick("commandList", "commandsGrid"), "commandList/commandsGrid");

const charList = elAssert(pick("charList"), "charList");
const logBox = elAssert(pick("log"), "log");

const runBtn = elAssert(pick("runBtn"), "runBtn");
const addBtn = elAssert(pick("addChar"), "addChar");

const applyEditBtn = pick("applyEditBtn");
const cancelEditBtn = pick("cancelEditBtn");
const editBanner = pick("editBanner");

const saveBtn = pick("saveBtn");
const loadBtn = pick("loadBtn");
const loadFile = pick("loadFile");

// 입력들
const elName = pick("name");
const elGender = pick("gender");
const elAge = pick("age");

// 게임 설정(HTML마다 id가 달라서 pick으로 흡수)
const setEngineerEl = pick("setEngineer", "enableEngineer");
const setDoctorEl = pick("setDoctor", "enableDoctor");
const setGuardianEl = pick("setGuardian", "enableGuardian");
const setGuardDutyEl = pick("setGuardDuty", "enableGuardDuty", "enableGuardDutyEl");
const setACEl = pick("setAC", "enableAC");
const setBugEl = pick("setBug", "enableBug");
const gnosiaCountEl = pick("gnosiaCount");

// 관계도 컨테이너(있으면)
const relationsView = pick("relationsView", "relationBox", "relationsBox");

// -------------------------------
// Constants: 스탯/성격 키(HTML 라벨용)
// -------------------------------
const STAT_FIELDS = [
  { key: "charisma", label: "카리스마", min: 0, max: 50, step: 0.1 },
  { key: "logic", label: "논리력", min: 0, max: 50, step: 0.1 },
  { key: "acting", label: "연기력", min: 0, max: 50, step: 0.1 },
  { key: "charm", label: "귀염성", min: 0, max: 50, step: 0.1 },
  { key: "stealth", label: "스텔스", min: 0, max: 50, step: 0.1 },
  { key: "intuition", label: "직감", min: 0, max: 50, step: 0.1 },
];

const PERS_FIELDS = [
  { key: "cheer", label: "쾌활함", min: 0, max: 1, step: 0.01 },
  { key: "social", label: "사회성", min: 0, max: 1, step: 0.01 },
  { key: "logical", label: "논리성향", min: 0, max: 1, step: 0.01 },
  { key: "kindness", label: "상냥함", min: 0, max: 1, step: 0.01 },
  { key: "desire", label: "욕망", min: 0, max: 1, step: 0.01 },
  { key: "courage", label: "용기", min: 0, max: 1, step: 0.01 },
];

// -------------------------------
// State
// -------------------------------
let characters = [];
let editingId = null; // 수정중인 캐릭터 id
let engine = null;

const cmdCheckboxById = new Map(); // cmdId -> checkbox
const statInputByKey = new Map();  // key -> input
const persInputByKey = new Map();  // key -> input

// -------------------------------
// Logging UI
// -------------------------------
function log(msg) {
  if (!logBox) return console.log(msg);
  const div = document.createElement("div");
  div.textContent = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  if (logBox) logBox.innerHTML = "";
}

// -------------------------------
// UI builders
// -------------------------------
function makeNumberField({ key, label, min, max, step }, group = "stat") {
  const wrap = document.createElement("label");
  wrap.className = "kv";

  const lab = document.createElement("span");
  lab.className = "k";
  lab.textContent = label;

  const input = document.createElement("input");
  input.className = "input";
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = group === "stat" ? "0" : "0.00";

  wrap.appendChild(lab);
  wrap.appendChild(input);
  return { wrap, input };
}

function renderStatsAndPersonality() {
  if (!statsGrid || !persGrid) return;

  statsGrid.innerHTML = "";
  persGrid.innerHTML = "";
  statInputByKey.clear();
  persInputByKey.clear();

  for (const f of STAT_FIELDS) {
    const { wrap, input } = makeNumberField(f, "stat");
    statsGrid.appendChild(wrap);
    statInputByKey.set(f.key, input);

    input.addEventListener("input", () => {
      // 스탯 바뀌면 커맨드 eligibility 갱신
      updateCommandEligibility();
    });
  }

  for (const f of PERS_FIELDS) {
    const { wrap, input } = makeNumberField(f, "pers");
    persGrid.appendChild(wrap);
    persInputByKey.set(f.key, input);
  }
}

function renderCommandChecklist() {
  if (!commandGrid) return;

  commandGrid.innerHTML = "";
  cmdCheckboxById.clear();

  // COMMAND_DEFS는 배열이어야 함(너가 고친 commands.js 기준 OK)
  for (const def of COMMAND_DEFS) {
    const cmdId = def?.id;
    const labelText = def?.label || String(cmdId);
    if (!cmdId) continue;

    const label = document.createElement("label");
    label.className = "cmd";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true; // 기본: 전부 사용으로 시작(원하면 false로 바꿔도 됨)

    const txt = document.createElement("span");
    txt.textContent = labelText;

    label.appendChild(cb);
    label.appendChild(txt);

    commandGrid.appendChild(label);
    cmdCheckboxById.set(cmdId, cb);

    cb.addEventListener("change", () => {
      // 체크 바뀌어도 eligibility 다시 확인(특히 disabled 풀렸다가 다시 막힐 때)
      updateCommandEligibility();
    });
  }

  updateCommandEligibility();
}

function getCurrentStatsFromForm() {
  const stats = {};
  for (const f of STAT_FIELDS) {
    const el = statInputByKey.get(f.key);
    const v = Number(el?.value);
    stats[f.key] = Number.isFinite(v) ? v : 0;
  }
  return stats;
}

function getCurrentPersonalityFromForm() {
  const p = {};
  for (const f of PERS_FIELDS) {
    const el = persInputByKey.get(f.key);
    const v = Number(el?.value);
    p[f.key] = Number.isFinite(v) ? v : 0;
  }
  return p;
}

function updateCommandEligibility() {
  // “캐릭터 스탯상 사용 불가 커맨드”는 체크도 못하게: disabled 처리
  const tempChar = { stats: getCurrentStatsFromForm() };

  for (const [cmdId, cb] of cmdCheckboxById.entries()) {
    let ok = true;
    try {
      ok = cmdStatEligible(tempChar, cmdId);
    } catch (e) {
      console.warn("[main.js] cmdStatEligible failed:", cmdId, e);
      ok = true; // 에러면 막지 말고 보여주기
    }

    cb.disabled = !ok;

    // 이미 체크돼 있었는데 스탯 바뀌어서 불가가 되면 자동 해제
    if (!ok && cb.checked) cb.checked = false;

    // 시각적 힌트(있으면)
    const row = cb.parentElement;
    if (row) row.style.opacity = ok ? "1" : "0.45";
  }
}

// -------------------------------
// Character CRUD
// -------------------------------
function readCharForm() {
  const name = (elName?.value || "").trim();
  const gender = elGender?.value || "남성";
  const age = Number(elAge?.value);

  if (!name) return { error: "이름이 비어있습니다." };
  if (!Number.isFinite(age) || age < 0) return { error: "식별연령을 0 이상 숫자로 넣어주세요." };

  const stats = getCurrentStatsFromForm();
  const personality = getCurrentPersonalityFromForm();

  const enabledCommands = [];
  for (const [cmdId, cb] of cmdCheckboxById.entries()) {
    if (cb.checked && !cb.disabled) enabledCommands.push(cmdId);
  }

  return {
    value: {
      id: editingId || crypto.randomUUID?.() || String(Date.now() + Math.random()),
      name,
      gender,
      age,
      stats,
      personality,
      enabledCommands,
      alive: true,
    },
  };
}

function resetForm() {
  if (elName) elName.value = "";
  if (elAge) elAge.value = "";

  for (const f of STAT_FIELDS) {
    const el = statInputByKey.get(f.key);
    if (el) el.value = "0";
  }
  for (const f of PERS_FIELDS) {
    const el = persInputByKey.get(f.key);
    if (el) el.value = "0.00";
  }

  // 커맨드 체크 기본값: true로 되돌림(단, 스탯상 불가인 건 자동으로 disabled+해제됨)
  for (const cb of cmdCheckboxById.values()) cb.checked = true;

  editingId = null;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) applyEditBtn.disabled = true;
  if (cancelEditBtn) cancelEditBtn.disabled = true;

  updateCommandEligibility();
}

function renderCharList() {
  if (!charList) return;
  charList.innerHTML = "";

  for (const c of characters) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";
    row.style.padding = "6px 0";
    row.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

    const left = document.createElement("div");
    left.textContent = `${c.name} (${c.gender}, ${c.age})`;

    const btns = document.createElement("div");
    btns.style.display = "flex";
    btns.style.gap = "6px";

    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "수정";
    edit.addEventListener("click", () => startEdit(c.id));

    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "삭제";
    del.addEventListener("click", () => {
      characters = characters.filter((x) => x.id !== c.id);
      renderCharList();
      updateRunButtonState();
    });

    btns.appendChild(edit);
    btns.appendChild(del);

    row.appendChild(left);
    row.appendChild(btns);
    charList.appendChild(row);
  }
}

function startEdit(id) {
  const c = characters.find((x) => x.id === id);
  if (!c) return;

  editingId = c.id;
  if (editBanner) editBanner.style.display = "";
  if (applyEditBtn) applyEditBtn.disabled = false;
  if (cancelEditBtn) cancelEditBtn.disabled = false;

  if (elName) elName.value = c.name || "";
  if (elGender) elGender.value = c.gender || "남성";
  if (elAge) elAge.value = String(c.age ?? 0);

  for (const f of STAT_FIELDS) {
    const el = statInputByKey.get(f.key);
    if (el) el.value = String(c.stats?.[f.key] ?? 0);
  }
  for (const f of PERS_FIELDS) {
    const el = persInputByKey.get(f.key);
    if (el) el.value = String(c.personality?.[f.key] ?? 0);
  }

  // 커맨드 체크 상태 복원
  const enabled = new Set(c.enabledCommands || []);
  for (const [cmdId, cb] of cmdCheckboxById.entries()) {
    cb.checked = enabled.has(cmdId);
  }

  updateCommandEligibility();
}

function updateRunButtonState() {
  if (!runBtn) return;
  runBtn.disabled = characters.length < 5;
}

// -------------------------------
// Save / Load (캐릭터만)
// -------------------------------
function saveCharacters() {
  const blob = new Blob([JSON.stringify(characters, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gnosia_characters.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function loadCharacters() {
  const file = loadFile?.files?.[0];
  if (!file) return log("로드할 파일을 선택하세요.");

  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return log("JSON 파싱 실패: 파일이 깨졌거나 형식이 다릅니다.");
  }
  if (!Array.isArray(data)) return log("로드 실패: 배열 형식이 아닙니다.");

  characters = data.map((c) => ({
    id: c.id || (crypto.randomUUID?.() || String(Date.now() + Math.random())),
    name: c.name || "이름없음",
    gender: c.gender || "남성",
    age: Number.isFinite(Number(c.age)) ? Number(c.age) : 0,
    stats: c.stats || {},
    personality: c.personality || {},
    enabledCommands: Array.isArray(c.enabledCommands) ? c.enabledCommands : [],
    alive: true,
  }));

  renderCharList();
  updateRunButtonState();
  log(`캐릭터 ${characters.length}명 로드 완료.`);
}

// -------------------------------
// Game start / step (엔진 API가 달라도 최대한 동작)
// -------------------------------
function getGameConfigFromUI() {
  const rolesEnabled = {
    엔지니어: !!setEngineerEl?.checked,
    닥터: !!setDoctorEl?.checked,
    수호천사: !!setGuardianEl?.checked,
    선내대기인: !!setGuardDutyEl?.checked,
    AC주의자: !!setACEl?.checked,
    버그: !!setBugEl?.checked,
  };
  const gnosiaCount = Math.max(1, Math.min(6, Number(gnosiaCountEl?.value || 1)));
  return { rolesEnabled, gnosiaCount };
}

function startOrStepGame() {
  clearLog();

  if (!engine) {
    // 엔진 생성
    const cfg = getGameConfigFromUI();

    try {
      engine = new GameEngine(characters, cfg);
    } catch (e1) {
      try {
        engine = new GameEngine({ characters, config: cfg });
      } catch (e2) {
        console.error(e1, e2);
        log("❌ 엔진 생성 실패: game.js의 GameEngine 생성자 시그니처가 다릅니다.");
        log("콘솔 에러를 보여주면 그에 맞춰 game.js/main.js를 맞춰줄게.");
        return;
      }
    }

    log("✅ 게임이 시작되었습니다.");
  }

  // 1스텝 실행 (메서드 이름이 다를 수 있으니 방어적으로 호출)
  try {
    if (typeof engine.step === "function") engine.step();
    else if (typeof engine.runStep === "function") engine.runStep();
    else if (typeof engine.tick === "function") engine.tick();
    else log("⚠️ engine.step() 같은 1스텝 메서드를 찾지 못했습니다. (game.js 확인 필요)");
  } catch (e) {
    console.error(e);
    log("❌ 스텝 실행 중 오류. 콘솔의 빨간 에러를 보여주세요.");
  }
}

// -------------------------------
// Init
// -------------------------------
function init() {
  // (중요) 렌더가 아예 안 뜨는 문제를 잡기 위해, 여기까지 오면 로그 찍음
  console.log("[main.js] init() called");

  renderStatsAndPersonality();
  renderCommandChecklist();
  resetForm();
  renderCharList();
  updateRunButtonState();

  addBtn?.addEventListener("click", () => {
    const r = readCharForm();
    if (r.error) return log(`❌ ${r.error}`);

    const c = r.value;

    if (editingId) {
      characters = characters.map((x) => (x.id === editingId ? c : x));
      log(`✅ "${c.name}" 수정 완료.`);
    } else {
      characters.push(c);
      log(`✅ "${c.name}" 추가 완료.`);
    }

    renderCharList();
    updateRunButtonState();
    resetForm();
  });

  applyEditBtn?.addEventListener("click", () => {
    const r = readCharForm();
    if (r.error) return log(`❌ ${r.error}`);
    const c = r.value;
    characters = characters.map((x) => (x.id === editingId ? c : x));
    renderCharList();
    updateRunButtonState();
    log(`✅ "${c.name}" 수정 적용.`);
    resetForm();
  });

  cancelEditBtn?.addEventListener("click", () => {
    resetForm();
    log("수정 취소.");
  });

  runBtn?.addEventListener("click", () => {
    if (characters.length < 5) return log("캐릭터를 5명 이상 추가해야 실행할 수 있습니다.");
    startOrStepGame();
  });

  saveBtn?.addEventListener("click", saveCharacters);
  loadBtn?.addEventListener("click", () => loadCharacters());

  // 관계도 영역은 아직 미구현이면 표시만
  if (relationsView && !relationsView.textContent?.trim()) {
    relationsView.textContent = "관계도 준비 중…";
  }
}

// DOMContentLoaded 보장
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
