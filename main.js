// main.js (type="module")
// =======================================================
// UI <-> GameEngine 연결
// - 캐릭터 추가/수정/삭제
// - 커맨드 체크(스테이터스 미달 시 체크 불가)
// - 세이브/로드(JSON)
// - 실행 버튼(클릭 1회 = game.step() 1회)
// =======================================================

import { GameEngine } from "./engine/game.js";

// -------------------------------
// DOM
// -------------------------------
const $ = (id) => document.getElementById(id);

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

const charList = $("charList");
const logBox = $("log");

const editBanner = $("editBanner");
const applyEditBtn = $("applyEditBtn");
const cancelEditBtn = $("cancelEditBtn");

// -------------------------------
// 입력 필드 정의
// -------------------------------
const STAT_FIELDS = [
  { key: "charisma", label: "카리스마" },
  { key: "logic", label: "논리력" },
  { key: "acting", label: "연기력" },
  { key: "charm", label: "귀염성" },
  { key: "stealth", label: "스텔스" },
  { key: "intuition", label: "직감" },
];

const PERS_FIELDS = [
  { key: "cheer", label: "쾌활함" },
  { key: "social", label: "사회성" },
  { key: "logical", label: "논리성향" },
  { key: "kindness", label: "상냥함" },
  { key: "desire", label: "욕망" },
  { key: "courage", label: "용기" },
];

// -------------------------------
// 커맨드 목록 + 요구 스테이터스(기획서 기준)
// ※ 여기 목록은 "유저가 체크 가능한 것"만.
// ※ 잡담 참여/찬성/반대 같은 내부용은 UI에 안 보임.
// -------------------------------
const COMMAND_DEFS = [
  { name: "의심한다", req: [] },
  { name: "의심에 동의한다", req: [] },
  { name: "부정한다", req: [] },
  { name: "변호한다", req: [] },
  { name: "변호에 가담한다", req: [] },
  { name: "감싼다", req: [] },
  { name: "함께 감싼다", req: [] },
  { name: "감사한다", req: [] },
  { name: "반론한다", req: [] },
  { name: "반론에 가담한다", req: [] },
  { name: "시끄러워", req: [] },
  { name: "역할을 밝힌다", req: [] },
  { name: "자신도 밝힌다", req: [] },
  { name: "역할을 밝혀라", req: [["charisma", 10]] },
  { name: "과장해서 말한다", req: [["acting", 15]] },
  { name: "동의를 구한다", req: [["charisma", 25]] },
  { name: "반론을 막는다", req: [["charisma", 40]] },
  { name: "얼버무린다", req: [["stealth", 25]] },
  { name: "반격한다", req: [["logic", 25], ["acting", 25]] },
  { name: "도움을 요청한다", req: [["acting", 30]] },
  { name: "슬퍼한다", req: [["charm", 25]] },
  { name: "속지마라", req: [["intuition", 30]] },
  { name: "투표해라", req: [["logic", 10]] },
  { name: "투표하지 마라", req: [["logic", 15]] },
  { name: "반드시 인간이다", req: [["logic", 20]] },
  { name: "반드시 적이다", req: [["logic", 20]] },
  { name: "전원 배제해라", req: [["logic", 30]] },
  { name: "잡담한다", req: [["stealth", 10]] },
  { name: "협력하자", req: [["charm", 15]] },
  { name: "인간이라고 말해", req: [["intuition", 20]] },
  { name: "도게자한다", req: [["stealth", 35]] },

  // 너가 추가한 "밤 시간 협력 요청" (스테이터스 조건 없음)
  { name: "밤:협력요청", req: [] },
];

// -------------------------------
// 상태
// -------------------------------
let characters = [];
let editingIndex = null;

let engine = null;

// -------------------------------
// 유틸
// -------------------------------
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function toFloat(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toIntNonNeg(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

function addLogLine(text) {
  const div = document.createElement("div");
  div.textContent = text;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logBox.innerHTML = "";
}

function currentStatus() {
  const obj = {};
  for (const f of STAT_FIELDS) {
    obj[f.key] = clamp(toFloat($(`stat_${f.key}`)?.value ?? 0), 0, 50);
  }
  return obj;
}

function currentPersonality() {
  const obj = {};
  for (const f of PERS_FIELDS) {
    obj[f.key] = clamp(toFloat($(`per_${f.key}`)?.value ?? 0), 0, 1);
  }
  return obj;
}

function statusMeetsReq(status, req) {
  return req.every(([k, min]) => (status[k] ?? 0) >= min);
}

function buildReqText(req) {
  if (!req || req.length === 0) return "조건 없음";
  return req.map(([k, v]) => `${STAT_FIELDS.find(s=>s.key===k)?.label ?? k} ${v}+`).join(", ");
}

// -------------------------------
// 폼 렌더링
// -------------------------------
function renderStatsInputs() {
  statsGrid.innerHTML = "";
  for (const f of STAT_FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "kv";

    const label = document.createElement("div");
    label.className = "k";
    label.textContent = f.label;

    const input = document.createElement("input");
    input.id = `stat_${f.key}`;
    input.type = "number";
    input.min = "0";
    input.max = "50";
    input.step = "0.1";
    input.value = "0";

    input.addEventListener("input", () => {
      // 음수/50초과 즉시 보정
      input.value = String(clamp(toFloat(input.value, 0), 0, 50));
      renderCommandChecklist(); // 스탯이 바뀌면 체크 가능 여부 갱신
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    statsGrid.appendChild(wrap);
  }
}

function renderPersonalityInputs() {
  persGrid.innerHTML = "";
  for (const f of PERS_FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "kv";

    const label = document.createElement("div");
    label.className = "k";
    label.textContent = f.label;

    const input = document.createElement("input");
    input.id = `per_${f.key}`;
    input.type = "number";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = "0.50";

    input.addEventListener("input", () => {
      input.value = String(clamp(toFloat(input.value, 0), 0, 1));
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    persGrid.appendChild(wrap);
  }
}

function renderCommandChecklist(existingChecked = null) {
  const status = currentStatus();
  commandList.innerHTML = "";

  const checkedSet = new Set(existingChecked ?? getCurrentlyCheckedCommands());

  for (const cmd of COMMAND_DEFS) {
    const ok = statusMeetsReq(status, cmd.req);

    const row = document.createElement("label");
    row.className = "cmd" + (ok ? "" : " disabled");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = cmd.name;
    cb.checked = checkedSet.has(cmd.name);
    cb.disabled = !ok; // 스테이터스 미달이면 "선택 불가" (요구사항)

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = cmd.name;

    const req = document.createElement("span");
    req.className = "req";
    req.textContent = buildReqText(cmd.req);

    row.appendChild(cb);
    row.appendChild(name);
    row.appendChild(req);
    commandList.appendChild(row);
  }
}

function getCurrentlyCheckedCommands() {
  const set = new Set();
  commandList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    if (cb.checked) set.add(cb.value);
  });
  return Array.from(set);
}

// -------------------------------
// 캐릭터 목록 렌더링
// -------------------------------
function renderCharacters() {
  charList.innerHTML = "";

  characters.forEach((c, idx) => {
    const card = document.createElement("div");
    card.className = "row";

    const left = document.createElement("div");
    left.className = "grow";
    left.innerHTML = `<b>${c.name}</b> (${c.gender}, ${c.age}세)`;

    const right = document.createElement("div");
    right.className = "actions";

    const edit = document.createElement("button");
    edit.textContent = "수정";
    edit.addEventListener("click", () => beginEdit(idx));

    const del = document.createElement("button");
    del.textContent = "삭제";
    del.addEventListener("click", () => {
      if (engine) return alert("게임 진행 중엔 삭제할 수 없습니다. (새로고침 후 다시 시작하세요)");
      characters.splice(idx, 1);
      renderCharacters();
      updateRunButton();
    });

    right.appendChild(edit);
    right.appendChild(del);

    card.appendChild(left);
    card.appendChild(right);

    charList.appendChild(card);
  });

  updateRunButton();
}

function updateRunButton() {
  runBtn.disabled = characters.length < 5;
}

// -------------------------------
// 캐릭터 추가/수정 로직
// -------------------------------
function readFormCharacter() {
  const name = (elName.value ?? "").trim();
  const gender = elGender.value;
  const age = toIntNonNeg(elAge.value, 0);

  if (!name) throw new Error("이름을 입력하세요.");

  const status = currentStatus();
  const personality = currentPersonality();

  const allowedCommands = getCurrentlyCheckedCommands();

  return { name, gender, age, status, personality, allowedCommands };
}

function resetForm() {
  elName.value = "";
  elGender.value = "남성";
  elAge.value = "20";

  STAT_FIELDS.forEach(f => { $(`stat_${f.key}`).value = "0"; });
  PERS_FIELDS.forEach(f => { $(`per_${f.key}`).value = "0.50"; });

  renderCommandChecklist([]);
  editingIndex = null;

  editBanner.style.display = "none";
  applyEditBtn.disabled = true;
  cancelEditBtn.disabled = true;
}

function beginEdit(index) {
  const c = characters[index];
  editingIndex = index;

  elName.value = c.name;
  elGender.value = c.gender;
  elAge.value = String(c.age);

  for (const f of STAT_FIELDS) {
    $(`stat_${f.key}`).value = String(clamp(c.status[f.key] ?? 0, 0, 50));
  }
  for (const f of PERS_FIELDS) {
    $(`per_${f.key}`).value = String(clamp(c.personality[f.key] ?? 0, 0, 1));
  }

  renderCommandChecklist(c.allowedCommands);

  editBanner.style.display = "";
  applyEditBtn.disabled = false;
  cancelEditBtn.disabled = false;
}

function applyEdit() {
  if (editingIndex == null) return;
  const updated = readFormCharacter();
  characters[editingIndex] = updated;
  renderCharacters();
  resetForm();
}

function addCharacter() {
  const c = readFormCharacter();
  characters.push(c);
  renderCharacters();
  resetForm();
}

// -------------------------------
// 세이브/로드 (캐릭터 목록만)
// -------------------------------
function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function saveCharacters() {
  download("gnosia_characters.json", JSON.stringify({ characters }, null, 2));
}

async function loadCharactersFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || !Array.isArray(data.characters)) {
    throw new Error("잘못된 파일 형식입니다. (characters 배열이 없음)");
  }

  // 간단 검증 + 보정
  const loaded = data.characters.map((c) => ({
    name: String(c.name ?? "").trim(),
    gender: c.gender ?? "남성",
    age: toIntNonNeg(c.age, 0),
    status: Object.fromEntries(STAT_FIELDS.map(f => [f.key, clamp(toFloat(c.status?.[f.key] ?? 0), 0, 50)])),
    personality: Object.fromEntries(PERS_FIELDS.map(f => [f.key, clamp(toFloat(c.personality?.[f.key] ?? 0.5), 0, 1)])),
    allowedCommands: Array.isArray(c.allowedCommands) ? c.allowedCommands.slice() : [],
  })).filter(c => c.name);

  characters = loaded;
  engine = null;
  clearLog();
  addLogLine("로드 완료. 캐릭터를 5명 이상 만들고 실행 버튼을 눌러주세요.");
  renderCharacters();
  resetForm();
}

// -------------------------------
// 게임 시작/진행
// -------------------------------
function getGameSettings() {
  // 지금은 UI에 역할 설정 폼이 따로 없다면 기본값으로 시작.
  // (너가 이미 역할 설정 UI를 붙여놓은 상태면, 여기만 그 id에 맞게 읽어오면 됨)
  const n = characters.length;

  // 기본: 모두 활성화, 그노시아 수는 인원 기준 최대치 내에서 1로
  return {
    enableEngineer: true,
    enableDoctor: true,
    enableGuardian: true,
    enableGuardDuty: true,
    enableAC: true,
    enableBug: true,
    gnosiaCount: Math.min(1, Math.max(1, n <= 6 ? 1 : 2)), // 안전 기본
  };
}

function startGameIfNeeded() {
  if (engine) return;

  const settings = getGameSettings();
  engine = new GameEngine(characters, settings, null);

  clearLog();
  engine.logs.forEach(addLogLine);
  engine.logs.length = 0; // main에서 출력했으니 비우기
}

function stepGame() {
  if (characters.length < 5) {
    alert("캐릭터가 최소 5명 이상이어야 실행할 수 있습니다.");
    return;
  }
  startGameIfNeeded();
  engine.step();
  // 새로 추가된 로그만 출력
  while (engine.logs.length > 0) {
    addLogLine(engine.logs.shift());
  }
}

// -------------------------------
// 이벤트 바인딩
// -------------------------------
addBtn.addEventListener("click", () => {
  try {
    addCharacter();
  } catch (e) {
    alert(e.message ?? String(e));
  }
});

applyEditBtn.addEventListener("click", () => {
  try {
    applyEdit();
  } catch (e) {
    alert(e.message ?? String(e));
  }
});

cancelEditBtn.addEventListener("click", () => {
  resetForm();
});

saveBtn.addEventListener("click", () => {
  try {
    saveCharacters();
  } catch (e) {
    alert(e.message ?? String(e));
  }
});

loadBtn.addEventListener("click", async () => {
  if (!loadFile.files || loadFile.files.length === 0) {
    alert("로드할 파일을 선택하세요.");
    return;
  }
  try {
    await loadCharactersFromFile(loadFile.files[0]);
  } catch (e) {
    alert(e.message ?? String(e));
  }
});

runBtn.addEventListener("click", () => {
  stepGame();
});

// -------------------------------
// 초기 렌더
// -------------------------------
renderStatsInputs();
renderPersonalityInputs();
renderCommandChecklist([]);
renderCharacters();

addLogLine("준비 완료. 캐릭터를 5명 이상 만들고 실행 버튼을 누르면 1턴씩 진행됩니다.");

