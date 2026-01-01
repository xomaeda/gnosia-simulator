// main.js (루트)
// index.html: <script type="module" src="./main.js"></script>

const $ = (id) => document.getElementById(id);
const pick = (...ids) => ids.map($).find(Boolean) || null;

// ---- DOM ----
const elName = $("name");
const elGender = $("gender");
const elAge = $("age");

const statsGrid = pick("statsGrid", "statusGrid");
const persGrid = pick("persGrid", "personalityGrid");
const commandGrid = pick("commandList", "commandsGrid");

const addBtn = $("addChar");
const runBtn = $("runBtn");
const logSaveBtn = $("logSaveBtn");

const saveBtn = $("saveBtn");
const loadBtn = $("loadBtn");
const loadFile = $("loadFile");

const applyEditBtn = $("applyEditBtn");
const cancelEditBtn = $("cancelEditBtn");
const editBanner = $("editBanner");

const charList = $("charList");
const logBox = $("log");

// 게임 설정(체크박스 id는 네 index.html 기준)
const setEngineer = $("setEngineer");
const setDoctor = $("setDoctor");
const setGuardian = $("setGuardian");
const setGuardDuty = $("setGuardDuty");
const setAC = $("setAC");
const setBug = $("setBug");
const gnosiaCountEl = $("gnosiaCount");

// 관계도
const relationsView = $("relationsView");

// ---- 로그 ----
function logLine(msg) {
  if (!logBox) return;
  const div = document.createElement("div");
  div.textContent = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}
function logError(msg) {
  logLine(`❌ ${msg}`);
}
function logOk(msg) {
  logLine(`✅ ${msg}`);
}

// ---- 필드 정의 ----
const STAT_FIELDS = [
  ["charisma", "카리스마", { min: 0, max: 50, step: 0.1 }],
  ["logic", "논리력", { min: 0, max: 50, step: 0.1 }],
  ["acting", "연기력", { min: 0, max: 50, step: 0.1 }],
  ["charm", "귀염성", { min: 0, max: 50, step: 0.1 }],
  ["stealth", "스텔스", { min: 0, max: 50, step: 0.1 }],
  ["intuition", "직감", { min: 0, max: 50, step: 0.1 }],
];

const PERS_FIELDS = [
  ["cheer", "쾌활함", { min: 0, max: 1, step: 0.01 }],
  ["social", "사회성", { min: 0, max: 1, step: 0.01 }],
  ["logical", "논리성향", { min: 0, max: 1, step: 0.01 }],
  ["kindness", "상냥함", { min: 0, max: 1, step: 0.01 }],
  ["desire", "욕망", { min: 0, max: 1, step: 0.01 }],
  ["courage", "용기", { min: 0, max: 1, step: 0.01 }],
];

// ---- 상태 ----
let COMMAND_DEFS = null;
let cmdStatEligible = null;
let GameEngine = null;

let engine = null;
let chars = []; // { id, name, gender, age, stats, personality, enabledCommands:Set, alive:true ... }
let editingId = null;

// ---- URL 기반 import (GitHub Pages 경로 꼬임 방지 핵심) ----
const urlCommands = new URL("./engine/commands.js", import.meta.url).href;
const urlGame = new URL("./engine/game.js", import.meta.url).href;
// roles/relation은 옵션
const urlRoles = new URL("./engine/roles.js", import.meta.url).href;
const urlRelation = new URL("./engine/relation.js", import.meta.url).href;

async function loadModules() {
  // commands.js 먼저 (UI 렌더에 필수)
  try {
    const modCmd = await import(urlCommands);
    COMMAND_DEFS = modCmd.COMMAND_DEFS;
    cmdStatEligible = modCmd.statEligible;
    if (!Array.isArray(COMMAND_DEFS)) throw new Error("COMMAND_DEFS가 배열이 아님");
    if (typeof cmdStatEligible !== "function") throw new Error("statEligible 함수가 없음");
    logOk("commands.js 로드 성공");
  } catch (e) {
    logError(`commands.js 로드 실패: ${e?.message || e}`);
    throw e;
  }

  // game.js는 실행 버튼에 필요(없어도 캐릭터 생성 UI는 보여줘야 함)
  try {
    const modGame = await import(urlGame);
    GameEngine = modGame.GameEngine;
    if (typeof GameEngine !== "function") throw new Error("GameEngine export가 없음");
    logOk("game.js 로드 성공");
  } catch (e) {
    logError(
      `엔진(game.js)을 불러오지 못했습니다. (GitHub Pages 경로/대소문자 확인)\n` +
      `- ${e?.message || e}`
    );
    // 엔진이 없어도 캐릭터 생성은 가능하게 둠
    GameEngine = null;
  }

  // roles / relation은 있으면만
  try { await import(urlRoles); } catch {}
  try { await import(urlRelation); } catch {}
}

// ---- UI 생성 ----
function makeNumberField(id, label, opts) {
  const wrap = document.createElement("label");
  wrap.className = "kv";

  const span = document.createElement("span");
  span.className = "k";
  span.textContent = label;

  const input = document.createElement("input");
  input.className = "input";
  input.type = "number";
  input.id = id;
  input.min = opts.min;
  input.max = opts.max;
  input.step = opts.step;
  input.value = String(opts.min ?? 0);

  wrap.appendChild(span);
  wrap.appendChild(input);
  return { wrap, input };
}

const statInputs = new Map();
const persInputs = new Map();

function renderStats() {
  if (!statsGrid) return;
  statsGrid.innerHTML = "";
  statInputs.clear();

  for (const [key, label, opts] of STAT_FIELDS) {
    const { wrap, input } = makeNumberField(`st_${key}`, label, opts);
    input.addEventListener("input", () => {
      // 커맨드 체크박스 disabled 상태 갱신
      refreshCommandDisabledByStats();
    });
    statsGrid.appendChild(wrap);
    statInputs.set(key, input);
  }
}

function renderPersonality() {
  if (!persGrid) return;
  persGrid.innerHTML = "";
  persInputs.clear();

  for (const [key, label, opts] of PERS_FIELDS) {
    const { wrap, input } = makeNumberField(`ps_${key}`, label, opts);
    persGrid.appendChild(wrap);
    persInputs.set(key, input);
  }
}

function getCurrentStats() {
  const stats = {};
  for (const [k, input] of statInputs.entries()) {
    const v = Number(input.value);
    stats[k] = Number.isFinite(v) ? v : 0;
  }
  return stats;
}
function getCurrentPersonality() {
  const p = {};
  for (const [k, input] of persInputs.entries()) {
    const v = Number(input.value);
    p[k] = Number.isFinite(v) ? v : 0;
  }
  return p;
}

let commandCheckboxes = []; // {id, el}

function renderCommands() {
  if (!commandGrid) return;
  commandGrid.innerHTML = "";
  commandCheckboxes = [];

  // commands.js 못 불러오면 여기서 끝
  if (!Array.isArray(COMMAND_DEFS)) {
    const div = document.createElement("div");
    div.textContent = "커맨드 목록을 불러오지 못했습니다 (commands.js 확인)";
    commandGrid.appendChild(div);
    return;
  }

  for (const def of COMMAND_DEFS) {
    // def: {id,label,category,public,needsCheck,...} 형태를 가정(네 commands.js 기준)
    const id = def.id ?? def.label;
    const label = def.label ?? String(id);

    // public=false면 UI에 굳이 안 보여도 된다는 네 요구가 있었지만,
    // 지금은 전부 보여주는 편이 디버깅에 유리해서 그대로 표시.
    const row = document.createElement("label");
    row.className = "cmd-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.cmdId = id;

    const text = document.createElement("span");
    text.textContent = label;

    row.appendChild(cb);
    row.appendChild(text);
    commandGrid.appendChild(row);

    commandCheckboxes.push({ id, el: cb });
  }

  refreshCommandDisabledByStats();
}

// ✅ 핵심: “현재 입력 스탯” 기준으로 사용 불가 커맨드는 체크 자체를 못 하게 disabled
function refreshCommandDisabledByStats() {
  if (!cmdStatEligible) return;
  const stats = getCurrentStats();
  const fakeChar = { stats };

  for (const { id, el } of commandCheckboxes) {
    const ok = cmdStatEligible(fakeChar, id);
    el.disabled = !ok;

    // disabled로 바뀌는 순간 체크되어 있으면 해제(원하는 동작)
    if (!ok && el.checked) el.checked = false;
  }
}

// ---- 캐릭터 목록/저장 ----
function renderCharList() {
  if (!charList) return;
  charList.innerHTML = "";

  if (!chars.length) {
    const empty = document.createElement("div");
    empty.className = "mini";
    empty.textContent = "아직 캐릭터가 없습니다.";
    charList.appendChild(empty);
    return;
  }

  for (const c of chars) {
    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.className = "grow";
    left.textContent = `${c.name} (${c.gender}, ${c.age})`;

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn";
    btnEdit.textContent = "수정";
    btnEdit.onclick = () => enterEditMode(c.id);

    const btnDel = document.createElement("button");
    btnDel.className = "btn";
    btnDel.textContent = "삭제";
    btnDel.onclick = () => {
      chars = chars.filter((x) => x.id !== c.id);
      if (editingId === c.id) exitEditMode();
      renderCharList();
      updateRunButtonState();
    };

    row.appendChild(left);
    row.appendChild(btnEdit);
    row.appendChild(btnDel);
    charList.appendChild(row);
  }
}

function enterEditMode(id) {
  const c = chars.find((x) => x.id === id);
  if (!c) return;

  editingId = id;
  if (editBanner) editBanner.style.display = "";
  if (applyEditBtn) applyEditBtn.disabled = false;
  if (cancelEditBtn) cancelEditBtn.disabled = false;

  elName.value = c.name;
  elGender.value = c.gender;
  elAge.value = String(c.age ?? 0);

  for (const [k, input] of statInputs.entries()) input.value = String(c.stats?.[k] ?? 0);
  for (const [k, input] of persInputs.entries()) input.value = String(c.personality?.[k] ?? 0);

  // 체크박스 반영(스탯 기준 disabled 먼저 갱신 후)
  refreshCommandDisabledByStats();
  for (const { id: cmdId, el } of commandCheckboxes) {
    el.checked = c.enabledCommands?.has(cmdId) || false;
  }
}

function exitEditMode() {
  editingId = null;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) applyEditBtn.disabled = true;
  if (cancelEditBtn) cancelEditBtn.disabled = true;
}

function getCheckedCommandsSet() {
  const set = new Set();
  for (const { id, el } of commandCheckboxes) {
    if (!el.disabled && el.checked) set.add(id);
  }
  return set;
}

function addOrUpdateChar() {
  const name = (elName?.value || "").trim();
  if (!name) {
    logError("이름을 입력해줘.");
    return;
  }
  const gender = elGender?.value || "남성";
  const age = Number(elAge?.value ?? 0) || 0;

  const stats = getCurrentStats();
  const personality = getCurrentPersonality();
  const enabledCommands = getCheckedCommandsSet();

  if (editingId) {
    const idx = chars.findIndex((x) => x.id === editingId);
    if (idx >= 0) {
      chars[idx] = { ...chars[idx], name, gender, age, stats, personality, enabledCommands };
      logOk(`캐릭터 수정: ${name}`);
    }
    exitEditMode();
  } else {
    const id = crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
    chars.push({ id, name, gender, age, stats, personality, enabledCommands, alive: true });
    logOk(`캐릭터 추가: ${name}`);
  }

  renderCharList();
  updateRunButtonState();
}

function saveChars() {
  const data = JSON.stringify(chars, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gnosia_characters.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadCharsFromFile() {
  const file = loadFile?.files?.[0];
  if (!file) {
    logError("로드할 파일을 선택해줘.");
    return;
  }
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error("형식이 올바르지 않음(배열 아님)");
    chars = arr.map((c) => ({
      ...c,
      enabledCommands: c.enabledCommands instanceof Set ? c.enabledCommands : new Set(c.enabledCommands || []),
      alive: c.alive ?? true,
    }));
    logOk("캐릭터 로드 완료");
    exitEditMode();
    renderCharList();
    updateRunButtonState();
  } catch (e) {
    logError(`로드 실패: ${e?.message || e}`);
  }
}

function updateRunButtonState() {
  // 엔진이 없어도 버튼은 켤 수 있지만, 실행은 막고 안내를 띄우는 편이 안전
  const okCount = chars.length >= 5 && chars.length <= 15;
  if (runBtn) runBtn.disabled = !okCount;
}

// ---- 게임 실행 ----
function getGameConfig() {
  return {
    rolesEnabled: {
      "엔지니어": !!setEngineer?.checked,
      "닥터": !!setDoctor?.checked,
      "수호천사": !!setGuardian?.checked,
      "선내대기인": !!setGuardDuty?.checked,
      "AC주의자": !!setAC?.checked,
      "버그": !!setBug?.checked,
    },
    gnosiaCount: Number(gnosiaCountEl?.value ?? 1) || 1,
  };
}

function runOneStep() {
  if (!chars.length) return;

  if (!GameEngine) {
    logError("엔진(game.js)이 로드되지 않아 실행할 수 없습니다. 콘솔의 404/경로를 먼저 해결해야 합니다.");
    return;
  }

  if (!engine) {
    const cfg = getGameConfig();
    engine = new GameEngine(chars, cfg);
    logOk("게임이 시작되었습니다.");
  }

  try {
    engine.step(); // game.js가 step() 제공한다고 가정
  } catch (e) {
    logError(`엔진 실행 중 오류: ${e?.message || e}`);
  }
}

// ---- 초기화 ----
async function init() {
  // UI는 엔진/모듈과 무관하게 먼저 그려준다(“비어있는 문제” 방지)
  renderStats();
  renderPersonality();

  // 모듈 로드 후 커맨드 UI 생성
  try {
    await loadModules();
  } catch {
    // commands.js가 실패하면 커맨드 UI는 못 그리지만,
    // 스탯/성격은 보여야 하므로 여기서 중단하지 않음
  }
  renderCommands();

  renderCharList();
  updateRunButtonState();

  // ---- 버튼 바인딩 ----
  addBtn?.addEventListener("click", addOrUpdateChar);

  applyEditBtn?.addEventListener("click", () => {
    if (!editingId) return;
    addOrUpdateChar();
  });
  cancelEditBtn?.addEventListener("click", () => {
    exitEditMode();
  });

  saveBtn?.addEventListener("click", saveChars);
  loadBtn?.addEventListener("click", loadCharsFromFile);

  runBtn?.addEventListener("click", runOneStep);

  logSaveBtn?.addEventListener("click", () => {
    const text = (logBox?.innerText || "").trim();
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gnosia_log.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  logOk("UI 초기화 완료");
}

init();
