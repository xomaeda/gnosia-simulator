// main.js (root)  — HTML: <script type="module" src="./main.js"></script>

import { GameEngine } from "./engine/game.js";
import { COMMAND_DEFS } from "./engine/commands.js";

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

const applyEditBtn = $("applyEditBtn");
const cancelEditBtn = $("cancelEditBtn");
const editBanner = $("editBanner");

const charList = $("charList");
const logBox = $("log");

const enableEngineerEl  = pick("setEngineer",  "enableEngineer");
const enableDoctorEl    = pick("setDoctor",    "enableDoctor");
const enableGuardianEl  = pick("setGuardian",  "enableGuardian");
const enableGuardDutyEl = pick("setGuardDuty", "enableGuardDuty");
const enableACEl        = pick("setAC",        "enableAC");
const enableBugEl       = pick("setBug",       "enableBug");
const gnosiaCountEl     = pick("gnosiaCount");

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

// -------------------------------
// Fields (기획서 기준)
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
  { key: "cheer", label: "쾌활함", min: 0.0, max: 1.0, step: 0.01 },
  { key: "social", label: "사회성", min: 0.0, max: 1.0, step: 0.01 },
  { key: "logical", label: "논리성향", min: 0.0, max: 1.0, step: 0.01 },
  { key: "kindness", label: "상냥함", min: 0.0, max: 1.0, step: 0.01 },
  { key: "desire", label: "욕망", min: 0.0, max: 1.0, step: 0.01 },
  { key: "courage", label: "용기", min: 0.0, max: 1.0, step: 0.01 },
];

// COMMAND_DEFS는 프로젝트에 따라 "객체"일 수 있어 방어적으로 배열화
function getCommandDefArray() {
  if (!COMMAND_DEFS) return [];
  if (Array.isArray(COMMAND_DEFS)) return COMMAND_DEFS;
  if (typeof COMMAND_DEFS === "object") return Object.values(COMMAND_DEFS);
  return [];
}

// -------------------------------
// State
// -------------------------------
let characters = [];
let engine = null;

let editIndex = -1; // -1이면 추가 모드

// -------------------------------
// UI builders
// -------------------------------
function buildNumberGrid(container, fields, defaults) {
  container.innerHTML = "";
  for (const f of fields) {
    const wrap = document.createElement("label");
    wrap.className = "kv";

    const lab = document.createElement("span");
    lab.className = "k";
    lab.textContent = f.label;

    const input = document.createElement("input");
    input.className = "input";
    input.type = "number";
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.step);
    input.dataset.key = f.key;
    input.value = String(defaults?.[f.key] ?? (f.min === 0 ? 0 : 0.5));

    wrap.appendChild(lab);
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

function readGridValues(container, fields, digits) {
  const out = {};
  for (const f of fields) {
    const input = container.querySelector(`input[data-key="${f.key}"]`);
    const raw = input ? input.value : "";
    let v = toFloat(raw, f.min);
    v = clamp(v, f.min, f.max);
    v = roundTo(v, digits);
    out[f.key] = v;
  }
  return out;
}

// 커맨드 체크박스 렌더 (카테고리 있으면 분류, 없으면 한 그룹)
function renderCommandChecklist(charDraft) {
  commandList.innerHTML = "";

  const defs = getCommandDefArray();

  // defs가 비어있으면 여기서 끝(하지만 이제 commands.js export가 정상이라면 비지 않아야 함)
  if (!defs.length) {
    const warn = document.createElement("div");
    warn.style.opacity = "0.8";
    warn.textContent = "커맨드 정의를 불러오지 못했습니다. (engine/commands.js의 export를 확인)";
    commandList.appendChild(warn);
    return;
  }

  // 간단 그룹핑
  const groups = new Map();
  for (const d of defs) {
    const cat = d.category || "기타";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(d);
  }

  // 체크 상태(편집/추가 폼에서 보여줄 임시 상태)
  const allowed = new Set(Array.isArray(charDraft?.allowedCommands) ? charDraft.allowedCommands : []);

  for (const [cat, list] of groups.entries()) {
    const sec = document.createElement("div");
    sec.className = "cmd-group";

    const title = document.createElement("div");
    title.className = "cmd-group-title";
    title.textContent = cat;

    const grid = document.createElement("div");
    grid.className = "cmd-group-grid";

    // 보기 좋게 정렬
    list.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "ko"));

    for (const d of list) {
      const item = document.createElement("label");
      item.className = "cmd-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.cmd = d.id;

      // ✅ “성향상 사용 안 함”을 유저가 고르는 체크박스
      // 단, 스탯 조건 미달이어도 "체크는 가능"해야 한다고 했으니 여기서 막지 않음.
      cb.checked = allowed.has(d.id);

      cb.addEventListener("change", () => {
        if (cb.checked) allowed.add(d.id);
        else allowed.delete(d.id);
      });

      const name = document.createElement("span");
      name.className = "cmd-name";
      name.textContent = d.name || d.id;

      const desc = document.createElement("span");
      desc.className = "cmd-desc";
      desc.textContent = d.desc || "";

      // 툴팁
      item.title = [
        d.name || d.id,
        d.desc ? `- ${d.desc}` : "",
        d.requireText ? `조건: ${d.requireText}` : "",
      ].filter(Boolean).join("\n");

      item.appendChild(cb);
      item.appendChild(name);
      item.appendChild(desc);

      grid.appendChild(item);
    }

    sec.appendChild(title);
    sec.appendChild(grid);
    commandList.appendChild(sec);
  }

  // 폼 상태에 반영할 수 있도록 임시 저장
  charDraft._allowedSet = allowed;
}

function getFormDraftCharacter() {
  const name = String(elName.value || "").trim();
  const gender = elGender.value || "남성";
  const age = toIntNonNeg(elAge.value, 0);

  const status = readGridValues(statsGrid, STAT_FIELDS, 1);
  const personality = readGridValues(persGrid, PERS_FIELDS, 2);

  // 커맨드 체크는 renderCommandChecklist가 만든 _allowedSet을 사용
  let allowedCommands = [];
  const tmp = window.__draftChar;
  if (tmp && tmp._allowedSet) allowedCommands = Array.from(tmp._allowedSet);

  return { name, gender, age, status, personality, allowedCommands };
}

function validateCharacterOrThrow(c) {
  if (!c.name) throw new Error("이름을 입력하세요.");
  if (c.age < 0) throw new Error("나이는 0 이상이어야 합니다.");
  // status/personality는 readGridValues에서 clamp됨
}

// -------------------------------
// Render list
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
// Form mode
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
  window.__draftChar = { allowedCommands: [] };

  buildNumberGrid(statsGrid, STAT_FIELDS, null);
  buildNumberGrid(persGrid, PERS_FIELDS, {
    cheer: 0.5, social: 0.5, logical: 0.5, kindness: 0.5, desire: 0.5, courage: 0.5,
  });

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

  window.__draftChar = {
    allowedCommands: Array.isArray(c.allowedCommands) ? c.allowedCommands.slice() : [],
  };

  buildNumberGrid(statsGrid, STAT_FIELDS, c.status);
  buildNumberGrid(persGrid, PERS_FIELDS, c.personality);

  renderCommandChecklist(window.__draftChar);
}

// -------------------------------
// Save / Load
// -------------------------------
function download(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

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
    .map((c) => ({
      name: String(c.name ?? "").trim(),
      gender: c.gender ?? "남성",
      age: clamp(parseInt(c.age ?? 0, 10), 0, 999),
      status: Object.fromEntries(
        STAT_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.status?.[f.key] ?? 0), f.min, f.max), 1)])
      ),
      personality: Object.fromEntries(
        PERS_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.personality?.[f.key] ?? 0.5), f.min, f.max), 2)])
      ),
      allowedCommands: Array.isArray(c.allowedCommands) ? c.allowedCommands.slice() : [],
    }))
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
// Game settings
// -------------------------------
function computeMaxGnosia(n) {
  if (rolesApi?.computeMaxGnosia) return rolesApi.computeMaxGnosia(n);
  // fallback
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

  // roles.js가 normalizeGameConfig 형태를 기대하면 맞춰줌
  if (rolesApi?.normalizeGameConfig) {
    return rolesApi.normalizeGameConfig({ rolesEnabled, gnosiaCount: gCount }, n);
  }

  return { rolesEnabled, gnosiaCount: gCount };
}

// -------------------------------
// Relation view
// -------------------------------
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
    const c = getFormDraftCharacter();
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
      const c = getFormDraftCharacter();
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
addLogLine("준비 완료. 캐릭터 5명 이상 추가 후 실행 버튼을 눌러줘.");
