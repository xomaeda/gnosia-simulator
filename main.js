// main.js (루트) — HTML: <script type="module" src="./main.js"></script>

import { GameEngine } from "./engine/game.js";
import { COMMAND_DEFS, statEligible as cmdStatEligible } from "./engine/commands.js";

let rolesApi = null;
try { rolesApi = await import("./engine/roles.js"); } catch (_) { rolesApi = null; }

let relationApi = null;
try { relationApi = await import("./engine/relation.js"); } catch (_) { relationApi = null; }

// -------------------------------
// DOM helpers
// -------------------------------
const $ = (id) => document.getElementById(id);
const pick = (...ids) => ids.map($).find(Boolean) || null;

const elName = $("name");
const elGender = $("gender");
const elAge = $("age");

// 호환 컨테이너: 둘 중 하나만 있어도 동작
const statsGrid = pick("statsGrid", "statusGrid");
const persGrid = pick("persGrid", "personalityGrid");
const commandList = pick("commandList", "commandsGrid");

const addBtn = $("addChar");
const runBtn = $("runBtn");

const saveBtn = $("saveBtn");
const loadBtn = $("loadBtn");
const loadFile = $("loadFile");

const applyEditBtn = $("applyEditBtn");
const cancelEditBtn = $("cancelEditBtn");
const editBanner = $("editBanner");

const charList = $("charList");
const logBox = $("log");
const logSaveBtn = $("logSaveBtn");

// 게임 설정(HTML id 기준)
const setEngineer = $("setEngineer");
const setDoctor = $("setDoctor");
const setGuardian = $("setGuardian");
const setGuardDuty = $("setGuardDuty");
const setAC = $("setAC");
const setBug = $("setBug");
const gnosiaCountEl = $("gnosiaCount");

// 관계도 표시(있으면)
const relationsView = pick("relationsView", "relationBox");

// -------------------------------
// Model
// -------------------------------
const STAT_FIELDS = [
  ["charisma", "카리스마"],
  ["logic", "논리력"],
  ["acting", "연기력"],
  ["charm", "귀염성"],
  ["stealth", "스텔스"],
  ["intuition", "직감"],
];

const PERS_FIELDS = [
  ["cheer", "쾌활함"],
  ["social", "사회성"],
  ["logical", "논리성향"],
  ["kindness", "상냥함"],
  ["desire", "욕망"],
  ["courage", "용기"],
];

let characters = [];              // 생성된 캐릭터 목록
let editingId = null;             // 수정 중 캐릭터 id
let engine = null;                // GameEngine 인스턴스
let lastLogLen = 0;               // 렌더 최적화용

// -------------------------------
// Utilities
// -------------------------------
function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}
function round1(n) { return Math.round(Number(n) * 10) / 10; }
function round2(n) { return Math.round(Number(n) * 100) / 100; }

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function log(line) {
  // 화면 로그
  const div = document.createElement("div");
  div.textContent = line;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logBox.innerHTML = "";
}

// -------------------------------
// UI builders (stats/personality/commands)
// -------------------------------
function buildStatInputs() {
  if (!statsGrid) return;
  statsGrid.innerHTML = "";

  for (const [key, label] of STAT_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "kv";

    const span = document.createElement("span");
    span.className = "k";
    span.textContent = label;

    const input = document.createElement("input");
    input.className = "input";
    input.type = "number";
    input.step = "0.1";
    input.min = "0";
    input.max = "50";
    input.id = `stat_${key}`;
    input.value = "0";

    input.addEventListener("input", () => {
      // 0~50, 소수 1자리
      input.value = String(round1(clamp(input.value, 0, 50)));
      refreshCommandCheckboxDisabling();
    });

    wrap.appendChild(span);
    wrap.appendChild(input);
    statsGrid.appendChild(wrap);
  }
}

function buildPersInputs() {
  if (!persGrid) return;
  persGrid.innerHTML = "";

  for (const [key, label] of PERS_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "kv";

    const span = document.createElement("span");
    span.className = "k";
    span.textContent = label;

    const input = document.createElement("input");
    input.className = "input";
    input.type = "number";
    input.step = "0.01";
    input.min = "0";
    input.max = "1";
    input.id = `pers_${key}`;
    input.value = "0";

    input.addEventListener("input", () => {
      // 0.00~1.00, 소수 2자리
      input.value = String(round2(clamp(input.value, 0, 1)));
    });

    wrap.appendChild(span);
    wrap.appendChild(input);
    persGrid.appendChild(wrap);
  }
}

function buildCommandChecklist() {
  if (!commandList) return;
  commandList.innerHTML = "";

  // COMMAND_DEFS는 배열
  for (const def of COMMAND_DEFS) {
    // UI에 공개되는 커맨드만(네가 public 플래그 쓰면 그것도 반영)
    if (def.public === false) continue;

    const id = `cmd_${def.id}`;

    const label = document.createElement("label");
    label.className = "cmd-item";
    label.htmlFor = id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.dataset.cmd = def.id;

    const text = document.createElement("span");
    text.className = "cmd-label";
    text.textContent = def.label || def.id;

    // 기본은 체크 ON (원하면 기본 OFF로 바꿔도 됨)
    cb.checked = true;

    // 체크 바뀌면 nothing special
    cb.addEventListener("change", () => { /* no-op */ });

    label.appendChild(cb);
    label.appendChild(text);
    commandList.appendChild(label);
  }

  refreshCommandCheckboxDisabling();
}

// 스테이터스 조건 미달 커맨드는 체크 자체를 못하게(disabled)
function refreshCommandCheckboxDisabling() {
  const tempChar = {
    stats: collectStats(),
    enabledCommands: new Set(getCheckedCommandIds(true /* ignore disabled */)),
  };

  const inputs = commandList?.querySelectorAll("input[type=checkbox][data-cmd]") || [];
  inputs.forEach((cb) => {
    const cmdId = cb.dataset.cmd;
    const ok = cmdStatEligible(tempChar, cmdId);

    cb.disabled = !ok;
    // disabled 될 때 체크가 남아있으면 꺼버리기(정책상 “선택 불가”)
    if (!ok) cb.checked = false;
  });
}

// -------------------------------
// Collect form values
// -------------------------------
function collectStats() {
  const out = {};
  for (const [key] of STAT_FIELDS) {
    const el = $(`stat_${key}`);
    out[key] = round1(clamp(el?.value ?? 0, 0, 50));
  }
  return out;
}
function collectPers() {
  const out = {};
  for (const [key] of PERS_FIELDS) {
    const el = $(`pers_${key}`);
    out[key] = round2(clamp(el?.value ?? 0, 0, 1));
  }
  return out;
}

function getCheckedCommandIds(ignoreDisabled = false) {
  const ids = [];
  const inputs = commandList?.querySelectorAll("input[type=checkbox][data-cmd]") || [];
  inputs.forEach((cb) => {
    if (cb.checked) {
      if (!ignoreDisabled && cb.disabled) return;
      ids.push(cb.dataset.cmd);
    }
  });
  return ids;
}

function fillFormFromChar(c) {
  elName.value = c.name || "";
  elGender.value = c.gender || "범성";
  elAge.value = String(c.age ?? 0);

  for (const [key] of STAT_FIELDS) {
    const el = $(`stat_${key}`);
    if (el) el.value = String(round1(clamp(c.stats?.[key] ?? 0, 0, 50)));
  }

  for (const [key] of PERS_FIELDS) {
    const el = $(`pers_${key}`);
    if (el) el.value = String(round2(clamp(c.personality?.[key] ?? 0, 0, 1)));
  }

  // 커맨드 체크 반영
  const enabled = c.enabledCommands instanceof Set ? c.enabledCommands : new Set(c.enabledCommands || []);
  const inputs = commandList?.querySelectorAll("input[type=checkbox][data-cmd]") || [];
  inputs.forEach((cb) => {
    cb.checked = enabled.has(cb.dataset.cmd);
  });

  refreshCommandCheckboxDisabling();
}

function clearForm() {
  elName.value = "";
  elGender.value = "범성";
  elAge.value = "0";
  for (const [key] of STAT_FIELDS) {
    const el = $(`stat_${key}`);
    if (el) el.value = "0";
  }
  for (const [key] of PERS_FIELDS) {
    const el = $(`pers_${key}`);
    if (el) el.value = "0";
  }
  const inputs = commandList?.querySelectorAll("input[type=checkbox][data-cmd]") || [];
  inputs.forEach((cb) => (cb.checked = true));
  refreshCommandCheckboxDisabling();
}

// -------------------------------
// Render list + buttons state
// -------------------------------
function renderCharList() {
  charList.innerHTML = "";

  characters.forEach((c) => {
    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.className = "row-main";
    left.textContent = `${c.name} (${c.gender}, ${c.age})`;

    const btns = document.createElement("div");
    btns.className = "row-actions";

    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "수정";
    edit.addEventListener("click", () => enterEdit(c.id));

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "삭제";
    del.addEventListener("click", () => {
      characters = characters.filter((x) => x.id !== c.id);
      if (editingId === c.id) exitEdit();
      renderCharList();
      refreshRunBtn();
    });

    btns.appendChild(edit);
    btns.appendChild(del);

    row.appendChild(left);
    row.appendChild(btns);
    charList.appendChild(row);
  });
}

function refreshRunBtn() {
  // 최소 5명, 최대 15명
  const ok = characters.length >= 5 && characters.length <= 15;
  runBtn.disabled = !ok;
}

function enterEdit(id) {
  const c = characters.find((x) => x.id === id);
  if (!c) return;
  editingId = id;
  fillFormFromChar(c);

  if (editBanner) editBanner.style.display = "block";
  applyEditBtn.disabled = false;
  cancelEditBtn.disabled = false;
  addBtn.disabled = true;
}

function exitEdit() {
  editingId = null;
  if (editBanner) editBanner.style.display = "none";
  applyEditBtn.disabled = true;
  cancelEditBtn.disabled = true;
  addBtn.disabled = false;
  clearForm();
}

// -------------------------------
// Save / Load (캐릭터만)
// -------------------------------
function saveCharacters() {
  const payload = characters.map((c) => ({
    id: c.id,
    name: c.name,
    gender: c.gender,
    age: c.age,
    stats: c.stats,
    personality: c.personality,
    enabledCommands: [...(c.enabledCommands || [])],
  }));

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "gnosia_characters.json";
  a.click();

  URL.revokeObjectURL(url);
}

async function loadCharactersFromFile() {
  const f = loadFile.files?.[0];
  if (!f) return;

  const text = await f.text();
  const arr = JSON.parse(text);

  if (!Array.isArray(arr)) throw new Error("파일 형식이 올바르지 않습니다.");

  characters = arr.map((c) => ({
    id: c.id ?? uid(),
    name: String(c.name ?? ""),
    gender: c.gender ?? "범성",
    age: clamp(c.age ?? 0, 0, 999),
    stats: c.stats ?? {},
    personality: c.personality ?? {},
    enabledCommands: new Set(Array.isArray(c.enabledCommands) ? c.enabledCommands : []),
  }));

  exitEdit();
  renderCharList();
  refreshRunBtn();
  log("✅ 캐릭터 로드 완료");
}

// -------------------------------
// Game settings -> engine settings
// -------------------------------
function collectSettings() {
  return {
    rolesEnabled: {
      "엔지니어": !!setEngineer?.checked,
      "닥터": !!setDoctor?.checked,
      "수호천사": !!setGuardian?.checked,
      "선내대기인": !!setGuardDuty?.checked,
      "AC주의자": !!setAC?.checked,
      "버그": !!setBug?.checked,
    },
    gnosiaCount: clamp(gnosiaCountEl?.value ?? 1, 1, 6),
  };
}

// -------------------------------
// Game controls
// -------------------------------
function startGameIfNeeded() {
  if (engine) return;

  clearLog();

  // 엔진에게 넘길 캐릭터(또 복제)
  const payload = characters.map((c) => ({
    ...c,
    enabledCommands: new Set(c.enabledCommands || []),
  }));

  engine = new GameEngine(payload, collectSettings(), null);
  lastLogLen = 0;

  // 시작 시 역할 공개 옵션(네 기획 변경)
  // roles.js가 엔진에서 배정했다면 엔진.getPublicRoleLines()가 있을 수 있음
  const lines = (typeof engine.getPublicRoleLines === "function") ? engine.getPublicRoleLines() : [];
  if (Array.isArray(lines) && lines.length) {
    lines.forEach((l) => log(l));
  }

  renderEngineLogs();
  refreshRelations();
}

function renderEngineLogs() {
  if (!engine) return;
  // engine.logs 배열을 화면에 반영 (중복 출력 방지)
  const logs = engine.logs || [];
  for (let i = lastLogLen; i < logs.length; i++) {
    log(logs[i]);
  }
  lastLogLen = logs.length;
}

function refreshRelations() {
  if (!relationsView) return;
  if (!engine) {
    relationsView.textContent = "관계도 준비 중…";
    return;
  }
  if (typeof engine.getRelationsText === "function") {
    relationsView.textContent = engine.getRelationsText() || "관계도 준비 중…";
  } else {
    relationsView.textContent = "관계도 준비 중…";
  }
}

function stepGame() {
  startGameIfNeeded();
  try {
    engine.step();
    renderEngineLogs();
    refreshRelations();
  } catch (e) {
    log("❌ 엔진 오류: " + (e?.message ?? String(e)));
    console.error(e);
  }
}

// -------------------------------
// Events
// -------------------------------
addBtn.addEventListener("click", () => {
  // 기본 검증
  const name = (elName.value || "").trim();
  if (!name) {
    alert("이름을 입력하세요.");
    return;
  }
  if (characters.length >= 15 && !editingId) {
    alert("캐릭터는 최대 15명까지 허용됩니다.");
    return;
  }

  const gender = elGender.value;
  const age = clamp(elAge.value, 0, 999);

  const stats = collectStats();
  const personality = collectPers();

  const enabledCommands = new Set(getCheckedCommandIds());

  const c = {
    id: uid(),
    name,
    gender,
    age,
    stats,
    personality,
    enabledCommands,
  };

  characters.push(c);
  renderCharList();
  refreshRunBtn();
  clearForm();
});

applyEditBtn.addEventListener("click", () => {
  if (!editingId) return;
  const idx = characters.findIndex((x) => x.id === editingId);
  if (idx < 0) return;

  const name = (elName.value || "").trim();
  if (!name) { alert("이름을 입력하세요."); return; }

  characters[idx] = {
    ...characters[idx],
    name,
    gender: elGender.value,
    age: clamp(elAge.value, 0, 999),
    stats: collectStats(),
    personality: collectPers(),
    enabledCommands: new Set(getCheckedCommandIds()),
  };

  exitEdit();
  renderCharList();
  refreshRunBtn();
});

cancelEditBtn.addEventListener("click", () => exitEdit());

runBtn.addEventListener("click", () => {
  // ✅ 여기서 "진짜로 step이 돈다"
  stepGame();
});

saveBtn?.addEventListener("click", () => saveCharacters());
loadBtn?.addEventListener("click", async () => {
  try {
    await loadCharactersFromFile();
  } catch (e) {
    alert("로드 실패: " + (e?.message ?? String(e)));
  }
});

logSaveBtn?.addEventListener("click", () => {
  // 현재 화면 로그 저장
  const lines = [...logBox.querySelectorAll("div")].map((d) => d.textContent ?? "");
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gnosia_log.txt";
  a.click();
  URL.revokeObjectURL(url);
});

// 폼 입력 바뀌면 커맨드 disabled 갱신
elAge?.addEventListener("input", () => { elAge.value = String(clamp(elAge.value, 0, 999)); });

// -------------------------------
// Init
// -------------------------------
buildStatInputs();
buildPersInputs();
buildCommandChecklist();
renderCharList();
refreshRunBtn();

// 첫 화면 안내
log("✅ commands.js 로딩 성공 (커맨드 UI 준비)");
log("ℹ️ 캐릭터를 5명 이상 만든 뒤 ‘실행(1스텝)’을 누르면 진행됩니다.");
