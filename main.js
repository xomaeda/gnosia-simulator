// main.js (루트) — HTML: <script type="module" src="./main.js"></script>

import { GameEngine } from "./engine/game.js";
import { COMMAND_DEFS, statEligible as cmdStatEligible } from "./engine/commands.js";

// (선택) roles / relation 모듈은 있으면 쓰고 없으면 무시
let rolesApi = null;
try { rolesApi = await import("./engine/roles.js"); } catch (e) { rolesApi = null; }

let relationApi = null;
try { relationApi = await import("./engine/relation.js"); } catch (e) { relationApi = null; }

// -------------------------------
// DOM helpers
// -------------------------------
const $ = (id) => document.getElementById(id);
const pick = (...ids) => ids.map($).find((el) => !!el) || null;

const elName = $("name");
const elGender = $("gender");
const elAge = $("age");

const statsGrid = $("statsGrid");
const persGrid = $("persGrid");
const commandList = $("commandList");

const addBtn = $("addChar");
const runBtn = $("runBtn");

const saveBtn = $("saveBtn");
const loadBtn = $("loadBtn");
const loadFile = $("loadFile");

const applyEditBtn = pick("applyEditBtn");
const cancelEditBtn = pick("cancelEditBtn");
const editBanner = pick("editBanner");

const charList = $("charList");
const logBox = $("log");

// 설정 체크박스 id가 버전마다 달라서 둘 다 대응
const enableEngineerEl  = pick("setEngineer",  "enableEngineer");
const enableDoctorEl    = pick("setDoctor",    "enableDoctor");
const enableGuardianEl  = pick("setGuardian",  "enableGuardian");
const enableGuardDutyEl = pick("setGuardDuty", "enableGuardDuty");
const enableACEl        = pick("setAC",        "enableAC");
const enableBugEl       = pick("setBug",       "enableBug");
const gnosiaCountEl     = pick("gnosiaCount");

// 관계도 컨테이너도 id가 달라서 둘 다 대응
const relationBox       = pick("relationsView", "relationBox");

// -------------------------------
// Utils
// -------------------------------
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toFloat = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const toIntNonNeg = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
};
const roundTo = (v, digits) => {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
};

function clearLog() { logBox.innerHTML = ""; }
function addLogLine(msg) {
  const div = document.createElement("div");
  div.textContent = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function download(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// -------------------------------
// Field definitions (UI)
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
let engine = null;
let editIndex = -1;

// draft: 폼에서 체크한 커맨드/스탯 입력 중간상태 저장
window.__draftChar = { _allowedSet: new Set() };

// -------------------------------
// Grid builders
// -------------------------------
function buildNumberGrid(container, fields, initial = null, digits = 1) {
  container.innerHTML = "";
  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "kv-row";

    const label = document.createElement("div");
    label.className = "kv-k";
    label.textContent = f.label;

    const input = document.createElement("input");
    input.className = "input";
    input.type = "number";
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.step);
    const initVal = initial?.[f.key];
    input.value = String(
      roundTo(clamp(toFloat(initVal, (f.min + f.max) / 2), f.min, f.max), digits)
    );
    input.dataset.key = f.key;

    // 스탯/성격 값 바뀌면 커맨드 체크 가능 여부 즉시 갱신
    input.addEventListener("input", () => {
      // draft만 갱신하고 체크리스트 다시 그리기
      const d = getFormDraftCharacter(false); // validate X
      window.__draftChar = {
        ...window.__draftChar,
        ...d,
        _allowedSet: window.__draftChar._allowedSet || new Set(),
      };
      renderCommandChecklist(window.__draftChar);
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  }
}

function readGridValues(container, fields, digits) {
  const out = {};
  const inputs = Array.from(container.querySelectorAll("input[data-key]"));
  const byKey = new Map(inputs.map((i) => [i.dataset.key, i]));
  for (const f of fields) {
    const el = byKey.get(f.key);
    const v = el ? toFloat(el.value, 0) : 0;
    out[f.key] = roundTo(clamp(v, f.min, f.max), digits);
  }
  return out;
}

// -------------------------------
// Command checklist (핵심)
// - 스탯 미달 커맨드는 disabled
// - disabled이면 체크도 못 함
// -------------------------------
function renderCommandChecklist(draftChar) {
  if (!commandList) return;
  commandList.innerHTML = "";

  // ✅ commands.js의 statEligible가 char.stats를 보므로
  // draftChar에 stats를 반드시 맞춰줌(안 그러면 항상 false가 나올 수 있음)
  const stats = draftChar?.stats || draftChar?.status || readGridValues(statsGrid, STAT_FIELDS, 1);
  const normalizedDraft = {
    ...draftChar,
    stats,
    status: stats, // 엔진이 status를 쓰는 경우도 대비
  };

  const allowedSet = normalizedDraft._allowedSet instanceof Set
    ? normalizedDraft._allowedSet
    : new Set(Array.isArray(normalizedDraft.allowedCommands) ? normalizedDraft.allowedCommands : []);

  normalizedDraft._allowedSet = allowedSet;

  // COMMAND_DEFS는 "배열"이어야 함 (네 commands.js 최신본 기준)
  for (const def of COMMAND_DEFS) {
    const id = def.id ?? def.name ?? def.cmd ?? def;
    const label = def.label ?? def.name ?? String(id);

    const okByStat = cmdStatEligible(normalizedDraft, id);

    const wrap = document.createElement("label");
    wrap.className = "cmd-item";
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";
    wrap.style.userSelect = "none";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = allowedSet.has(id);

    // ✅ 스탯 미달이면 체크 자체 불가
    cb.disabled = !okByStat;

    const text = document.createElement("span");
    text.textContent = label;

    if (!okByStat) {
      text.style.opacity = "0.45";
      wrap.title = "스테이터스 조건을 충족하지 못해서 선택할 수 없습니다.";
      // 이미 체크돼있던 게 스탯 변경으로 미달이 됐다면 자동 해제
      if (allowedSet.has(id)) allowedSet.delete(id);
      cb.checked = false;
    }

    cb.addEventListener("change", () => {
      if (cb.checked) allowedSet.add(id);
      else allowedSet.delete(id);
    });

    wrap.appendChild(cb);
    wrap.appendChild(text);
    commandList.appendChild(wrap);
  }

  // draft에 다시 저장
  window.__draftChar = normalizedDraft;
}

// -------------------------------
// Form -> Character
// -------------------------------
function getFormDraftCharacter(includeCommands = true) {
  const name = String(elName.value || "").trim();
  const gender = elGender.value || "남성";
  const age = toIntNonNeg(elAge.value, 0);

  const stats = readGridValues(statsGrid, STAT_FIELDS, 1);
  const personality = readGridValues(persGrid, PERS_FIELDS, 2);

  let allowedCommands = [];
  if (includeCommands) {
    const tmp = window.__draftChar;
    if (tmp && tmp._allowedSet) allowedCommands = Array.from(tmp._allowedSet);
  }

  // ✅ stats/status 둘 다 넣어서 서로 다른 코드가 참조해도 안전하게
  return {
    name,
    gender,
    age,
    stats,
    status: stats,
    personality,
    allowedCommands,
  };
}

function validateCharacterOrThrow(c) {
  if (!c.name) throw new Error("이름을 입력하세요.");
  if (c.age < 0) throw new Error("나이는 0 이상이어야 합니다.");
}

// -------------------------------
// List render
// -------------------------------
function renderCharacters() {
  charList.innerHTML = "";

  characters.forEach((c, idx) => {
    const row = document.createElement("div");
    row.className = "list-row";

    const left = document.createElement("div");
    left.className = "list-main";
    left.innerHTML = `<b>${c.name}</b> <span style="opacity:.75;">(${c.gender}, ${c.age})</span>`;

    const right = document.createElement("div");
    right.className = "list-actions";

    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "수정";
    edit.onclick = () => enterEdit(idx);

    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "삭제";
    del.onclick = () => {
      characters.splice(idx, 1);
      engine = null;
      addLogLine(`[삭제] ${c.name}`);
      renderCharacters();
      renderRelationIfPossible();
      refreshRunButtonState();
      resetForm();
    };

    right.appendChild(edit);
    right.appendChild(del);

    row.appendChild(left);
    row.appendChild(right);
    charList.appendChild(row);
  });

  refreshRunButtonState();
}

function refreshRunButtonState() {
  runBtn.disabled = characters.length < 5;
}

// -------------------------------
// Edit mode
// -------------------------------
function resetForm() {
  editIndex = -1;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) applyEditBtn.disabled = true;
  if (cancelEditBtn) cancelEditBtn.disabled = true;

  elName.value = "";
  elGender.value = "남성";
  elAge.value = "0";

  // draft
  window.__draftChar = { _allowedSet: new Set() };

  buildNumberGrid(statsGrid, STAT_FIELDS, null, 1);
  buildNumberGrid(
    persGrid,
    PERS_FIELDS,
    { cheer: 0.5, social: 0.5, logical: 0.5, kindness: 0.5, desire: 0.5, courage: 0.5 },
    2
  );

  renderCommandChecklist(window.__draftChar);
}

function enterEdit(idx) {
  editIndex = idx;
  const c = characters[idx];

  if (editBanner) editBanner.style.display = "block";
  if (applyEditBtn) applyEditBtn.disabled = false;
  if (cancelEditBtn) cancelEditBtn.disabled = false;

  elName.value = c.name;
  elGender.value = c.gender;
  elAge.value = String(c.age);

  buildNumberGrid(statsGrid, STAT_FIELDS, c.stats || c.status || null, 1);
  buildNumberGrid(persGrid, PERS_FIELDS, c.personality || null, 2);

  const set = new Set(Array.isArray(c.allowedCommands) ? c.allowedCommands : []);
  window.__draftChar = { _allowedSet: set, stats: c.stats || c.status, status: c.stats || c.status };
  renderCommandChecklist(window.__draftChar);
}

// -------------------------------
// Save / Load
// -------------------------------
function saveCharacters() {
  download("gnosia_characters.json", JSON.stringify({ characters }, null, 2));
  addLogLine("[세이브] gnosia_characters.json 저장됨");
}

async function loadCharactersFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || !Array.isArray(data.characters)) {
    throw new Error("잘못된 파일 형식입니다. (characters 배열이 없음)");
  }

  const loaded = data.characters
    .map((c) => {
      const stats = Object.fromEntries(
        STAT_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.stats?.[f.key] ?? c.status?.[f.key] ?? 0), f.min, f.max), 1)])
      );
      const personality = Object.fromEntries(
        PERS_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.personality?.[f.key] ?? 0.5), f.min, f.max), 2)])
      );

      return {
        name: String(c.name ?? "").trim(),
        gender: c.gender ?? "남성",
        age: clamp(parseInt(c.age ?? 0, 10), 0, 999),
        stats,
        status: stats,
        personality,
        allowedCommands: Array.isArray(c.allowedCommands) ? c.allowedCommands.slice() : [],
      };
    })
    .filter((c) => c.name);

  characters = loaded;
  engine = null;
  clearLog();
  addLogLine("[로드] 완료. 캐릭터 5명 이상이면 실행 가능.");
  renderCharacters();
  renderRelationIfPossible();
  resetForm();
}

// -------------------------------
// Game settings / relation
// -------------------------------
function computeMaxGnosia(n) {
  if (rolesApi?.computeMaxGnosia) return rolesApi.computeMaxGnosia(n);
  if (n <= 6) return 1;
  if (n <= 8) return 2;
  if (n <= 10) return 3;
  if (n <= 12) return 4;
  if (n <= 14) return 5;
  return 6;
}

function getGameSettings() {
  const n = characters.length;
  const maxG = computeMaxGnosia(n);

  const rolesEnabled = {
    "엔지니어": !!(enableEngineerEl ? enableEngineerEl.checked : true),
    "닥터": !!(enableDoctorEl ? enableDoctorEl.checked : true),
    "수호천사": !!(enableGuardianEl ? enableGuardianEl.checked : true),
    "선내대기인": !!(enableGuardDutyEl ? enableGuardDutyEl.checked : true),
    "AC주의자": !!(enableACEl ? enableACEl.checked : true),
    "버그": !!(enableBugEl ? enableBugEl.checked : true),
  };

  const gCount = clamp(toIntNonNeg(gnosiaCountEl ? gnosiaCountEl.value : 1, 1), 1, maxG);

  if (rolesApi?.normalizeGameConfig) {
    return rolesApi.normalizeGameConfig({ rolesEnabled, gnosiaCount: gCount }, n);
  }
  return { rolesEnabled, gnosiaCount: gCount };
}

function renderRelationIfPossible() {
  if (!relationBox) return;
  if (!relationApi?.renderRelation) {
    relationBox.textContent = "관계도 모듈(relation.js)이 연결되지 않았습니다.";
    return;
  }
  if (!engine) {
    relationBox.innerHTML = `<div style="opacity:.8;">(게임 시작 후 관계도가 표시됩니다)</div>`;
    return;
  }
  relationApi.renderRelation(relationBox, engine);
}

// -------------------------------
// Game start/step
// -------------------------------
function startGameIfNeeded() {
  if (engine) return;

  const settings = getGameSettings();
  engine = new GameEngine(characters, settings);

  clearLog();
  if (engine.getPublicRoleLines) engine.getPublicRoleLines().forEach(addLogLine);
  else addLogLine("[시작] 게임이 시작되었습니다.");
}

function stepGame() {
  if (characters.length < 5) {
    alert("캐릭터가 최소 5명 이상이어야 실행할 수 있습니다.");
    return;
  }
  startGameIfNeeded();

  engine.step();

  if (Array.isArray(engine.logs)) {
    while (engine.logs.length > 0) addLogLine(engine.logs.shift());
  }

  renderRelationIfPossible();
}

// -------------------------------
// Events
// -------------------------------
addBtn.addEventListener("click", () => {
  try {
    const c = getFormDraftCharacter(true);
    validateCharacterOrThrow(c);

    characters.push(c);
    engine = null;

    addLogLine(`[추가] ${c.name}`);
    renderCharacters();
    renderRelationIfPossible();
    resetForm();
  } catch (e) {
    alert(e?.message ?? String(e));
  }
});

if (applyEditBtn) {
  applyEditBtn.addEventListener("click", () => {
    try {
      if (editIndex < 0) return;
      const c = getFormDraftCharacter(true);
      validateCharacterOrThrow(c);

      characters[editIndex] = c;
      engine = null;

      addLogLine(`[수정] ${c.name}`);
      renderCharacters();
      renderRelationIfPossible();
      resetForm();
    } catch (e) {
      alert(e?.message ?? String(e));
    }
  });
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => resetForm());
}

runBtn.addEventListener("click", () => stepGame());

saveBtn.addEventListener("click", () => {
  try { saveCharacters(); } catch (e) { alert(e?.message ?? String(e)); }
});

loadBtn.addEventListener("click", async () => {
  try {
    const f = loadFile.files?.[0];
    if (!f) return alert("로드할 파일을 선택하세요.");
    await loadCharactersFromFile(f);
  } catch (e) {
    alert(e?.message ?? String(e));
  }
});

// -------------------------------
// Init
// -------------------------------
resetForm();
renderCharacters();
renderRelationIfPossible();
addLogLine("준비 완료. 캐릭터 5명 이상 추가 후 실행 버튼을 누르세요.");
