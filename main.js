// main.js (root) — index.html: <script type="module" src="main.js"></script>

import { GameEngine } from "./engine/game.js";
import { COMMAND_DEFS, statEligible as cmdStatEligible } from "./engine/commands.js";

// optional modules
let rolesApi = null;
try { rolesApi = await import("./engine/roles.js"); } catch { rolesApi = null; }

let relationApi = null;
try { relationApi = await import("./engine/relation.js"); } catch { relationApi = null; }

// -------------------------------
// DOM helpers
// -------------------------------
const $ = (id) => document.getElementById(id);
const pick = (...ids) => ids.map($).find(Boolean) || null;

function logToUI(msg, type = "info") {
  const logBox = pick("log");
  if (!logBox) return;
  const line = document.createElement("div");
  line.textContent = msg;
  line.style.whiteSpace = "pre-wrap";
  if (type === "error") line.style.color = "#ff6b6b";
  if (type === "ok") line.style.color = "#7CFC9A";
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function assertEl(el, name) {
  if (!el) {
    console.error(`[main.js] Missing element: ${name}`);
    logToUI(`❌ UI 요소를 찾지 못했습니다: ${name}`, "error");
  }
  return !!el;
}

// -------------------------------
// Grab elements (tolerant)
// -------------------------------
const elName = pick("name");
const elGender = pick("gender");
const elAge = pick("age");

const statsGrid = pick("statsGrid", "statusGrid");
const persGrid = pick("persGrid", "personalityGrid");
const commandList = pick("commandList", "commandsGrid");

const addBtn = pick("addChar");
const runBtn = pick("runBtn");

const saveBtn = pick("saveBtn");
const loadBtn = pick("loadBtn");
const loadFile = pick("loadFile");

const applyEditBtn = pick("applyEditBtn");
const cancelEditBtn = pick("cancelEditBtn");
const editBanner = pick("editBanner");

const charList = pick("charList");
const logBox = pick("log");

// settings (support both id styles)
const setEngineerEl = pick("setEngineer", "enableEngineer");
const setDoctorEl = pick("setDoctor", "enableDoctor");
const setGuardianEl = pick("setGuardian", "enableGuardian");
const setGuardDutyEl = pick("setGuardDuty", "enableGuardDuty");
const setACEl = pick("setAC", "enableAC");
const setBugEl = pick("setBug", "enableBug");
const gnosiaCountEl = pick("gnosiaCount");

const logSaveBtn = pick("logSaveBtn");

// relations view
const relationsView = pick("relationsView", "relationBox");

// basic sanity logs
(() => {
  const ok =
    assertEl(elName, "#name") &
    assertEl(elGender, "#gender") &
    assertEl(elAge, "#age") &
    assertEl(statsGrid, "#statsGrid/#statusGrid") &
    assertEl(persGrid, "#persGrid/#personalityGrid") &
    assertEl(commandList, "#commandList/#commandsGrid") &
    assertEl(addBtn, "#addChar") &
    assertEl(runBtn, "#runBtn") &
    assertEl(charList, "#charList") &
    assertEl(logBox, "#log");

  if (ok) logToUI("✅ UI 로드 완료", "ok");
})();

// -------------------------------
// Data model
// -------------------------------
let characters = []; // {id,name,gender,age,stats,pers,enabledCommands(Set)}
let editingId = null;
let engine = null;

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

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

// -------------------------------
// Render: stats / personality inputs
// -------------------------------
function renderKVGrid(container, fields, getVal, setVal) {
  if (!container) return;

  container.innerHTML = "";
  for (const f of fields) {
    const wrap = document.createElement("label");
    wrap.className = "kv";

    const name = document.createElement("span");
    name.className = "k";
    name.textContent = f.label;

    const input = document.createElement("input");
    input.className = "input";
    input.type = "number";
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.step);
    input.value = String(getVal(f.key));

    input.addEventListener("input", () => {
      setVal(f.key, input.value);
      // 커맨드 체크박스는 스탯에 따라 disabled가 달라지므로 갱신
      renderCommandChecklist();
    });

    wrap.appendChild(name);
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

// form state (not yet a character)
let formStats = Object.fromEntries(STAT_FIELDS.map(f => [f.key, 0]));
let formPers = Object.fromEntries(PERS_FIELDS.map(f => [f.key, 0]));
let formEnabled = new Set(); // checked commands (by id)

// -------------------------------
// Render: command checklist
// - 요구사항: 스탯 미달 커맨드는 체크 자체가 불가능(비활성)
// -------------------------------
function renderCommandChecklist() {
  if (!commandList) return;

  commandList.innerHTML = "";

  // COMMAND_DEFS must be iterable array
  if (!Array.isArray(COMMAND_DEFS)) {
    console.error("COMMAND_DEFS is not an array:", COMMAND_DEFS);
    logToUI("❌ COMMAND_DEFS가 배열이 아닙니다. commands.js export를 확인하세요.", "error");
    return;
  }

  for (const def of COMMAND_DEFS) {
    if (!def || def.public === false) continue; // hide non-public
    const id = def.id;

    const row = document.createElement("label");
    row.className = "cmd";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = formEnabled.has(id);

    // 스탯 조건 미달이면 disabled
    const tempChar = { stats: formStats };
    const eligible = cmdStatEligible(tempChar, id);
    cb.disabled = !eligible;

    cb.addEventListener("change", () => {
      if (cb.checked) formEnabled.add(id);
      else formEnabled.delete(id);
    });

    const text = document.createElement("span");
    text.textContent = def.label ?? String(id);

    // 조건 표시(회색)
    const cond = document.createElement("span");
    cond.className = "mini";
    cond.style.marginLeft = "8px";
    cond.style.opacity = "0.75";
    cond.textContent = eligible ? "조건없음" : "스탯 부족";

    row.appendChild(cb);
    row.appendChild(text);
    row.appendChild(cond);
    commandList.appendChild(row);
  }
}

// -------------------------------
// Render: character list
// -------------------------------
function renderCharList() {
  if (!charList) return;
  charList.innerHTML = "";

  for (const c of characters) {
    const item = document.createElement("div");
    item.className = "list-item";

    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = `${c.name} (${c.gender}, ${c.age})`;

    const meta = document.createElement("div");
    meta.className = "mini";
    meta.textContent = `커맨드 ${c.enabledCommands.size}개 선택`;

    const row = document.createElement("div");
    row.className = "row-inline";

    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.textContent = "수정";
    editBtn.addEventListener("click", () => startEdit(c.id));

    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => removeChar(c.id));

    row.appendChild(editBtn);
    row.appendChild(delBtn);

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(row);
    charList.appendChild(item);
  }

  // enable run when 5~15
  if (runBtn) runBtn.disabled = !(characters.length >= 5 && characters.length <= 15);
}

// -------------------------------
// Edit / add / remove
// -------------------------------
function resetForm() {
  if (elName) elName.value = "";
  if (elGender) elGender.value = "남성";
  if (elAge) elAge.value = "0";

  formStats = Object.fromEntries(STAT_FIELDS.map(f => [f.key, 0]));
  formPers = Object.fromEntries(PERS_FIELDS.map(f => [f.key, 0]));
  formEnabled = new Set();

  renderKVGrid(statsGrid, STAT_FIELDS, (k) => formStats[k], (k, v) => (formStats[k] = num(v, 0)));
  renderKVGrid(persGrid, PERS_FIELDS, (k) => formPers[k], (k, v) => (formPers[k] = num(v, 0)));
  renderCommandChecklist();

  editingId = null;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) applyEditBtn.disabled = true;
  if (cancelEditBtn) cancelEditBtn.disabled = true;
}

function startEdit(id) {
  const c = characters.find(x => x.id === id);
  if (!c) return;

  editingId = id;
  if (editBanner) editBanner.style.display = "block";
  if (applyEditBtn) applyEditBtn.disabled = false;
  if (cancelEditBtn) cancelEditBtn.disabled = false;

  if (elName) elName.value = c.name;
  if (elGender) elGender.value = c.gender;
  if (elAge) elAge.value = String(c.age);

  formStats = { ...c.stats };
  formPers = { ...c.pers };
  formEnabled = new Set([...c.enabledCommands]);

  renderKVGrid(statsGrid, STAT_FIELDS, (k) => formStats[k], (k, v) => (formStats[k] = num(v, 0)));
  renderKVGrid(persGrid, PERS_FIELDS, (k) => formPers[k], (k, v) => (formPers[k] = num(v, 0)));
  renderCommandChecklist();
}

function applyEdit() {
  if (!editingId) return;
  const idx = characters.findIndex(x => x.id === editingId);
  if (idx < 0) return;

  characters[idx] = {
    ...characters[idx],
    name: (elName?.value ?? "").trim() || characters[idx].name,
    gender: elGender?.value ?? characters[idx].gender,
    age: num(elAge?.value, characters[idx].age),
    stats: { ...formStats },
    pers: { ...formPers },
    enabledCommands: new Set([...formEnabled]),
  };

  logToUI(`✅ 수정 적용: ${characters[idx].name}`, "ok");
  renderCharList();
  resetForm();
}

function cancelEdit() {
  resetForm();
}

function addCharacter() {
  const name = (elName?.value ?? "").trim();
  if (!name) {
    logToUI("❌ 이름을 입력하세요.", "error");
    return;
  }

  const c = {
    id: uid(),
    name,
    gender: elGender?.value ?? "남성",
    age: num(elAge?.value, 0),
    stats: { ...formStats },
    pers: { ...formPers },
    enabledCommands: new Set([...formEnabled]),
  };

  characters.push(c);
  logToUI(`✅ 캐릭터 추가: ${c.name}`, "ok");
  renderCharList();
  resetForm();
}

function removeChar(id) {
  characters = characters.filter(x => x.id !== id);
  logToUI("✅ 캐릭터 삭제", "ok");
  renderCharList();
  if (editingId === id) resetForm();
}

// -------------------------------
// Game settings -> engine config
// -------------------------------
function getGameConfig() {
  return {
    rolesEnabled: {
      "엔지니어": !!setEngineerEl?.checked,
      "닥터": !!setDoctorEl?.checked,
      "수호천사": !!setGuardianEl?.checked,
      "선내대기인": !!setGuardDutyEl?.checked,
      "AC주의자": !!setACEl?.checked,
      "버그": !!setBugEl?.checked,
    },
    gnosiaCount: num(gnosiaCountEl?.value, 1),
  };
}

// -------------------------------
// Run engine (1 step)
// -------------------------------
function runOneStep() {
  if (!engine) {
    // create engine first time
    try {
      engine = new GameEngine(characters, getGameConfig(), {
        rolesApi,
        relationApi,
        log: (m) => logToUI(m),
      });
      logToUI("✅ 게임이 시작되었습니다.", "ok");
    } catch (e) {
      console.error(e);
      logToUI(`❌ 엔진 생성 실패: ${e?.message ?? e}`, "error");
      return;
    }
  }

  try {
    const res = engine.step?.();
    if (res === false) {
      logToUI("ℹ️ 더 진행할 스텝이 없습니다.", "info");
    }
  } catch (e) {
    console.error(e);
    logToUI(`❌ 실행 중 오류: ${e?.message ?? e}`, "error");
  }
}

// -------------------------------
// Save / load (characters only)
// -------------------------------
function saveCharacters() {
  const payload = JSON.stringify(characters.map(c => ({
    ...c,
    enabledCommands: [...c.enabledCommands],
  })), null, 2);

  const blob = new Blob([payload], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gnosia_characters.json";
  a.click();
  URL.revokeObjectURL(a.href);
  logToUI("✅ 세이브 완료", "ok");
}

async function loadCharacters() {
  const file = loadFile?.files?.[0];
  if (!file) {
    logToUI("❌ 로드할 파일을 선택하세요.", "error");
    return;
  }
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error("JSON이 배열이 아님");

    characters = arr.map(x => ({
      ...x,
      enabledCommands: new Set(Array.isArray(x.enabledCommands) ? x.enabledCommands : []),
    }));

    logToUI("✅ 로드 완료", "ok");
    renderCharList();
    resetForm();
  } catch (e) {
    console.error(e);
    logToUI(`❌ 로드 실패: ${e?.message ?? e}`, "error");
  }
}

function saveLog() {
  const txt = (logBox?.innerText ?? "").trim();
  const blob = new Blob([txt], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gnosia_log.txt";
  a.click();
  URL.revokeObjectURL(a.href);
}

// -------------------------------
// Wire events
// -------------------------------
addBtn?.addEventListener("click", () => {
  if (editingId) applyEdit();
  else addCharacter();
});

applyEditBtn?.addEventListener("click", applyEdit);
cancelEditBtn?.addEventListener("click", cancelEdit);

runBtn?.addEventListener("click", runOneStep);

saveBtn?.addEventListener("click", saveCharacters);
loadBtn?.addEventListener("click", loadCharacters);
logSaveBtn?.addEventListener("click", saveLog);

// -------------------------------
// Boot
// -------------------------------
resetForm();
renderCharList();
logToUI("ℹ️ 캐릭터를 5~15명 추가하면 실행 버튼이 활성화됩니다.");
