// main.js (루트) — HTML: <script type="module" src="./main.js"></script>

const $ = (id) => document.getElementById(id);
const pick = (...ids) => ids.map((x) => $(x)).find(Boolean) || null;

// -------------------------------
// DOM refs (id 호환 포함)
// -------------------------------
const elName = $("name");
const elGender = $("gender");
const elAge = $("age");

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

// 설정 UI (네 HTML 기준: setEngineer 등)
const setEngineerEl = pick("setEngineer", "enableEngineer");
const setDoctorEl = pick("setDoctor", "enableDoctor");
const setGuardianEl = pick("setGuardian", "enableGuardian");
const setGuardDutyEl = pick("setGuardDuty", "enableGuardDuty");
const setACEl = pick("setAC", "enableAC");
const setBugEl = pick("setBug", "enableBug");
const gnosiaCountEl = $("gnosiaCount");

// 관계도
const relationsView = pick("relationsView", "relationBox");

// 로그 저장 버튼 (있으면)
const logSaveBtn = $("logSaveBtn");

// -------------------------------
// Constants (UI labels / keys)
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

// -------------------------------
// State
// -------------------------------
let COMMAND_DEFS = [];
let cmdStatEligible = null;
let GameEngine = null;

let engine = null;
let gameStarted = false;

let chars = [];              // character list
let editId = null;           // currently editing char id

// -------------------------------
// Utilities
// -------------------------------
function log(line) {
  if (!logBox) return;
  const div = document.createElement("div");
  div.textContent = line;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  if (!logBox) return;
  logBox.innerHTML = "";
}

function uid() {
  return "c_" + Math.random().toString(36).slice(2, 10);
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function num(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

// age: 0 이상 정수
function normalizeAge(v) {
  const x = Math.floor(num(v, 0));
  return Math.max(0, x);
}

// status: 0~50, 소수 1자리
function normalizeStat(v) {
  const x = clamp(v, 0, 50);
  return Math.round(x * 10) / 10;
}

// personality: 0.00~1.00, 소수 2자리
function normalizePers(v) {
  const x = clamp(v, 0, 1);
  return Math.round(x * 100) / 100;
}

function downloadText(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function downloadJSON(filename, obj) {
  downloadText(filename, JSON.stringify(obj, null, 2));
}

// -------------------------------
// Dynamic import engine modules (중요)
// -------------------------------
async function loadEngineModules() {
  // ✅ 여기서 "엔진이 HTML로 응답"하는지까지 검사해서 로그로 알려줌
  async function checkJS(url) {
    const res = await fetch(url, { cache: "no-store" });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // GitHub Pages에서 파일이 없으면 종종 HTML(리다이렉트/404페이지)을 200으로 주기도 함
    if (ct.includes("text/html")) {
      throw new Error(`JS가 아닌 HTML로 응답 중: ${url} (content-type=${ct})`);
    }
    return true;
  }

  try {
    // 실제로 배포된 URL 기준으로 검사
    const base = new URL(".", location.href).toString();
    await checkJS(base + "engine/commands.js");
    await checkJS(base + "engine/game.js");

    const cmdMod = await import("./engine/commands.js");
    const gameMod = await import("./engine/game.js");

    COMMAND_DEFS = cmdMod.COMMAND_DEFS || [];
    cmdStatEligible = cmdMod.statEligible || null;
    GameEngine = gameMod.GameEngine || null;

    if (!Array.isArray(COMMAND_DEFS) || COMMAND_DEFS.length === 0) {
      throw new Error("commands.js에서 COMMAND_DEFS를 읽지 못했음");
    }
    if (typeof cmdStatEligible !== "function") {
      throw new Error("commands.js에서 statEligible 함수를 읽지 못했음");
    }
    if (typeof GameEngine !== "function") {
      throw new Error("game.js에서 GameEngine 클래스를 읽지 못했음");
    }

    log("✅ 엔진 로딩 성공: commands.js / game.js");
    return true;
  } catch (e) {
    log("❌ 엔진(game.js)을 불러오지 못했습니다.");
    log("   - 가장 흔한 원인: GitHub Pages가 engine/game.js를 JS가 아니라 HTML로 제공함(경로/배포 설정 문제)");
    log("   - 확인: 브라우저에서 /engine/game.js 를 열었을 때 코드가 아니라 HTML이 보이면 그 상태가 맞음");
    log(`   - 상세: ${String(e?.message || e)}`);
    return false;
  }
}

// -------------------------------
// UI builders
// -------------------------------
function makeKVInput(container, key, label, opts = {}) {
  const wrap = document.createElement("label");
  wrap.className = "kv";

  const t = document.createElement("div");
  t.className = "k";
  t.textContent = label;

  const input = document.createElement("input");
  input.className = "input";
  input.type = "number";
  input.id = opts.id || key;
  if (opts.min != null) input.min = String(opts.min);
  if (opts.max != null) input.max = String(opts.max);
  if (opts.step != null) input.step = String(opts.step);
  input.placeholder = opts.placeholder || "";

  wrap.appendChild(t);
  wrap.appendChild(input);
  container.appendChild(wrap);

  return input;
}

let statInputs = {}; // key -> input
let persInputs = {}; // key -> input

function buildStatPersUI() {
  if (statsGrid) statsGrid.innerHTML = "";
  if (persGrid) persGrid.innerHTML = "";

  statInputs = {};
  persInputs = {};

  if (statsGrid) {
    for (const [k, label] of STAT_FIELDS) {
      statInputs[k] = makeKVInput(statsGrid, k, label, {
        min: 0, max: 50, step: 0.1, placeholder: "0~50",
        id: "stat_" + k,
      });
      statInputs[k].addEventListener("input", () => refreshCommandCheckboxDisable());
    }
  }

  if (persGrid) {
    for (const [k, label] of PERS_FIELDS) {
      persInputs[k] = makeKVInput(persGrid, k, label, {
        min: 0, max: 1, step: 0.01, placeholder: "0.00~1.00",
        id: "pers_" + k,
      });
    }
  }
}

let cmdCheckboxes = new Map(); // cmdId -> checkbox

function buildCommandUI() {
  if (!commandList) return;
  commandList.innerHTML = "";
  cmdCheckboxes.clear();

  // COMMAND_DEFS: [{id,label,category,public,...}] 형태를 기대
  // category별 그룹
  const groups = new Map();
  for (const def of COMMAND_DEFS) {
    if (!def?.id) continue;
    if (def.public === false) continue; // 숨김 커맨드 제외
    const cat = def.category || "ETC";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(def);
  }

  for (const [cat, defs] of groups.entries()) {
    const box = document.createElement("div");
    box.className = "cmd-group";

    const head = document.createElement("div");
    head.className = "cmd-group-head";
    head.textContent = cat;
    box.appendChild(head);

    for (const def of defs) {
      const item = document.createElement("label");
      item.className = "cmd-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.cmdId = def.id;
      cb.checked = true; // 기본 체크(원하는대로 바꿔도 됨)

      const name = document.createElement("span");
      name.className = "cmd-name";
      name.textContent = def.label || def.id;

      item.appendChild(cb);
      item.appendChild(name);

      box.appendChild(item);
      cmdCheckboxes.set(def.id, cb);
    }

    commandList.appendChild(box);
  }

  refreshCommandCheckboxDisable();
}

// 현재 입력된 스탯 기준으로 “스탯 미달 커맨드 체크 불가(비활성)” 적용
function refreshCommandCheckboxDisable() {
  if (!cmdStatEligible) return; // 엔진/commands 미로드면 건너뜀

  const tmpChar = {
    stats: {},
  };
  for (const [k] of STAT_FIELDS) {
    tmpChar.stats[k] = normalizeStat(statInputs?.[k]?.value ?? 0);
  }

  for (const [cmdId, cb] of cmdCheckboxes.entries()) {
    const ok = cmdStatEligible(tmpChar, cmdId);
    cb.disabled = !ok;
    if (!ok) cb.checked = false;
  }
}

// -------------------------------
// Character CRUD
// -------------------------------
function readFormToChar() {
  const name = (elName?.value || "").trim();
  const gender = elGender?.value || "남성";
  const age = normalizeAge(elAge?.value);

  if (!name) {
    alert("이름을 입력해줘!");
    return null;
  }

  const stats = {};
  for (const [k] of STAT_FIELDS) {
    stats[k] = normalizeStat(statInputs?.[k]?.value ?? 0);
  }

  const personality = {};
  for (const [k] of PERS_FIELDS) {
    personality[k] = normalizePers(persInputs?.[k]?.value ?? 0);
  }

  // enabledCommands: 체크된 것만 (단, 스탯 미달은 체크 자체가 불가라 자연히 제외됨)
  const enabledCommands = [];
  for (const [cmdId, cb] of cmdCheckboxes.entries()) {
    if (cb.checked && !cb.disabled) enabledCommands.push(cmdId);
  }

  return { name, gender, age, stats, personality, enabledCommands };
}

function fillFormFromChar(c) {
  elName.value = c.name;
  elGender.value = c.gender;
  elAge.value = c.age;

  for (const [k] of STAT_FIELDS) {
    statInputs[k].value = c.stats?.[k] ?? 0;
  }
  for (const [k] of PERS_FIELDS) {
    persInputs[k].value = c.personality?.[k] ?? 0;
  }

  // 체크 반영
  refreshCommandCheckboxDisable();
  const set = new Set(c.enabledCommands || []);
  for (const [cmdId, cb] of cmdCheckboxes.entries()) {
    if (cb.disabled) {
      cb.checked = false;
    } else {
      cb.checked = set.has(cmdId);
    }
  }
}

function clearForm() {
  elName.value = "";
  elGender.value = "남성";
  elAge.value = "0";

  for (const [k] of STAT_FIELDS) statInputs[k].value = "0";
  for (const [k] of PERS_FIELDS) persInputs[k].value = "0";

  refreshCommandCheckboxDisable();
  for (const cb of cmdCheckboxes.values()) cb.checked = !cb.disabled;
}

function renderCharList() {
  if (!charList) return;
  charList.innerHTML = "";

  for (const c of chars) {
    const row = document.createElement("div");
    row.className = "list-row";

    const left = document.createElement("div");
    left.className = "list-main";
    left.innerHTML = `<b>${c.name}</b> <span class="mini">(${c.gender}, ${c.age})</span>`;

    const right = document.createElement("div");
    right.className = "list-actions";

    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "수정";
    edit.onclick = () => {
      editId = c.id;
      fillFormFromChar(c);
      if (editBanner) editBanner.style.display = "block";
      if (applyEditBtn) applyEditBtn.disabled = false;
      if (cancelEditBtn) cancelEditBtn.disabled = false;
      if (addBtn) addBtn.disabled = true;
    };

    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "삭제";
    del.onclick = () => {
      if (!confirm(`${c.name}를 삭제할까요?`)) return;
      chars = chars.filter((x) => x.id !== c.id);
      if (editId === c.id) {
        cancelEdit();
      }
      renderCharList();
      refreshRunButton();
    };

    right.appendChild(edit);
    right.appendChild(del);

    row.appendChild(left);
    row.appendChild(right);
    charList.appendChild(row);
  }
}

function cancelEdit() {
  editId = null;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) applyEditBtn.disabled = true;
  if (cancelEditBtn) cancelEditBtn.disabled = true;
  if (addBtn) addBtn.disabled = false;
  clearForm();
}

function refreshRunButton() {
  const ok = chars.length >= 5 && chars.length <= 15;
  if (runBtn) runBtn.disabled = !ok;
}

// -------------------------------
// Save / Load (캐릭터만)
// -------------------------------
function doSave() {
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    characters: chars.map((c) => ({
      id: c.id,
      name: c.name,
      gender: c.gender,
      age: c.age,
      stats: c.stats,
      personality: c.personality,
      enabledCommands: c.enabledCommands || [],
    })),
  };
  downloadJSON("gnosia_chars.json", data);
}

async function doLoad() {
  const file = loadFile?.files?.[0];
  if (!file) {
    alert("로드할 json 파일을 선택해주세요.");
    return;
  }
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data?.characters || !Array.isArray(data.characters)) {
    alert("올바른 세이브 파일이 아닙니다.");
    return;
  }

  chars = data.characters.map((c) => ({
    id: c.id || uid(),
    name: String(c.name || ""),
    gender: c.gender || "남성",
    age: normalizeAge(c.age),
    stats: c.stats || {},
    personality: c.personality || {},
    enabledCommands: Array.isArray(c.enabledCommands) ? c.enabledCommands : [],
  }));

  cancelEdit();
  renderCharList();
  refreshRunButton();
  log("✅ 캐릭터 로드 완료");
}

// -------------------------------
// Game Config read
// -------------------------------
function readGameConfig() {
  const rolesEnabled = {};
  rolesEnabled["엔지니어"] = !!setEngineerEl?.checked;
  rolesEnabled["닥터"] = !!setDoctorEl?.checked;
  rolesEnabled["수호천사"] = !!setGuardianEl?.checked;
  rolesEnabled["선내대기인"] = !!setGuardDutyEl?.checked;
  rolesEnabled["AC주의자"] = !!setACEl?.checked;
  rolesEnabled["버그"] = !!setBugEl?.checked;

  const gnosiaCount = Math.max(1, Math.min(6, Math.floor(num(gnosiaCountEl?.value, 1))));

  return { rolesEnabled, gnosiaCount };
}

// -------------------------------
// Start / Step
// -------------------------------
function buildEngineChars() {
  // GameEngine이 기대하는 형태에 맞춰 최소 필드만 구성
  // (game.js에서 id/name/stats/personality/enabledCommands를 쓰는 구조를 가정)
  return chars.map((c) => ({
    id: c.id,
    name: c.name,
    gender: c.gender,
    age: c.age,
    stats: c.stats,
    personality: c.personality,
    enabledCommands: c.enabledCommands || [],
  }));
}

function startGame() {
  if (!GameEngine) {
    log("❌ 엔진이 로드되지 않아 게임을 시작할 수 없음");
    return false;
  }
  if (chars.length < 5) {
    alert("캐릭터는 최소 5명 필요합니다.");
    return false;
  }

  const config = readGameConfig();
  engine = new GameEngine(buildEngineChars(), config);

  gameStarted = true;
  log("=== 게임이 시작되었습니다 ===");
  return true;
}

function stepGame() {
  if (!gameStarted) {
    const ok = startGame();
    if (!ok) return;
  }

  if (!engine) return;

  // game.js가 제공하는 메서드 이름이 버전에 따라 다를 수 있어 대비
  if (typeof engine.step === "function") {
    engine.step();
    return;
  }
  if (typeof engine.runStep === "function") {
    engine.runStep();
    return;
  }
  if (typeof engine.tick === "function") {
    engine.tick();
    return;
  }

  log("❌ 엔진에 step/runStep/tick 메서드가 없어 진행할 수 없음");
}

// -------------------------------
// Init
// -------------------------------
async function init() {
  buildStatPersUI();
  // commands/game 로드되면 체크 UI도 생성
  const ok = await loadEngineModules();
  if (ok) {
    buildCommandUI();
  } else {
    // 엔진이 안 떠도 UI 자체는 보여야 하므로: “빈 커맨드 UI”라도 만들어둠
    COMMAND_DEFS = [];
    buildCommandUI();
  }

  renderCharList();
  refreshRunButton();
  clearForm();

  // ---------------- events ----------------
  addBtn?.addEventListener("click", () => {
    if (chars.length >= 15) {
      alert("캐릭터는 최대 15명까지 허용됩니다.");
      return;
    }
    const c = readFormToChar();
    if (!c) return;

    const newChar = { id: uid(), ...c };
    chars.push(newChar);

    cancelEdit();
    renderCharList();
    refreshRunButton();
    log(`✅ 캐릭터 추가: ${newChar.name}`);
  });

  applyEditBtn?.addEventListener("click", () => {
    if (!editId) return;
    const c = readFormToChar();
    if (!c) return;

    const idx = chars.findIndex((x) => x.id === editId);
    if (idx >= 0) {
      chars[idx] = { ...chars[idx], ...c };
      log(`✅ 캐릭터 수정: ${chars[idx].name}`);
    }

    cancelEdit();
    renderCharList();
    refreshRunButton();
  });

  cancelEditBtn?.addEventListener("click", () => cancelEdit());

  saveBtn?.addEventListener("click", () => doSave());
  loadBtn?.addEventListener("click", () => doLoad());

  runBtn?.addEventListener("click", () => stepGame());

  logSaveBtn?.addEventListener("click", () => {
    const text = logBox?.innerText || "";
    downloadText("gnosia_log.txt", text);
  });

  // 스탯 입력이 바뀌면 커맨드 비활성화 다시 계산
  for (const [k] of STAT_FIELDS) {
    statInputs[k]?.addEventListener("input", () => {
      refreshCommandCheckboxDisable();
    });
  }
}

init();
