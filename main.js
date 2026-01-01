// main.js (루트)
// HTML: <script type="module" src="./main.js"></script>

import { COMMAND_DEFS, statEligible as cmdStatEligible } from "./engine/commands.js";

// 엔진은 있으면 사용, 없어도 UI는 무조건 뜨게 한다.
let GameEngine = null;
try {
  const mod = await import("./engine/game.js");
  GameEngine = mod.GameEngine ?? null;
} catch (e) {
  GameEngine = null;
}

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

const applyEditBtn = $("applyEditBtn");
const cancelEditBtn = $("cancelEditBtn");
const editBanner = $("editBanner");

const charList = $("charList");
const logBox = $("log");

const logSaveBtn = $("logSaveBtn");

// 게임 설정(있으면 사용)
const setEngineer = $("setEngineer");
const setDoctor = $("setDoctor");
const setGuardian = $("setGuardian");
const setGuardDuty = $("setGuardDuty");
const setAC = $("setAC");
const setBug = $("setBug");
const gnosiaCountEl = $("gnosiaCount");

const relationsView = $("relationsView");

// -------------------------------
// 기본 상수 (UI 생성용)
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
// 상태
// -------------------------------
let characters = [];
let editId = null; // 수정 중인 캐릭터 id
let engine = null;

function uuid() {
  return "c_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function log(msg) {
  if (!logBox) return;
  const line = document.createElement("div");
  line.textContent = msg;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  if (!logBox) return;
  logBox.innerHTML = "";
}

// -------------------------------
// UI 생성: 스탯/성격/커맨드
// -------------------------------
function makeNumberInput({ id, min, max, step, placeholder }) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "input";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.placeholder = placeholder ?? "";
  return input;
}

function renderStatsInputs() {
  if (!statsGrid) return;
  statsGrid.innerHTML = "";

  for (const f of STAT_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "kv";

    const lbl = document.createElement("span");
    lbl.className = "k";
    lbl.textContent = f.label;

    const input = makeNumberInput({
      id: `stat_${f.key}`,
      min: f.min,
      max: f.max,
      step: f.step,
      placeholder: `${f.min}~${f.max}`,
    });

    input.addEventListener("input", () => {
      clampNumberInput(input, f.min, f.max);
      refreshCommandDisableByCurrentStats();
    });

    wrap.appendChild(lbl);
    wrap.appendChild(input);
    statsGrid.appendChild(wrap);
  }
}

function renderPersInputs() {
  if (!persGrid) return;
  persGrid.innerHTML = "";

  for (const f of PERS_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "kv";

    const lbl = document.createElement("span");
    lbl.className = "k";
    lbl.textContent = f.label;

    const input = makeNumberInput({
      id: `pers_${f.key}`,
      min: f.min,
      max: f.max,
      step: f.step,
      placeholder: `${f.min.toFixed(2)}~${f.max.toFixed(2)}`,
    });

    input.addEventListener("input", () => {
      clampNumberInput(input, f.min, f.max);
    });

    wrap.appendChild(lbl);
    wrap.appendChild(input);
    persGrid.appendChild(wrap);
  }
}

function renderCommandChecklist() {
  if (!commandList) return;
  commandList.innerHTML = "";

  // COMMAND_DEFS는 배열 (commands.js에서 Object.values(COMMAND_META))
  for (const def of COMMAND_DEFS) {
    // public=false면 UI에 안 보이게 하고 싶으면 여기서 제외 가능
    // 지금은 전부 보여주되, 필요하면 필터링 가능.
    const item = document.createElement("label");
    item.className = "cmd-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "cmd-check";
    cb.dataset.cmd = def.id;

    const text = document.createElement("span");
    text.className = "cmd-text";
    text.textContent = def.label ?? def.id;

    item.appendChild(cb);
    item.appendChild(text);
    commandList.appendChild(item);
  }

  refreshCommandDisableByCurrentStats();
}

function clampNumberInput(input, min, max) {
  const v = Number(input.value);
  if (!Number.isFinite(v)) return;
  if (v < min) input.value = String(min);
  if (v > max) input.value = String(max);
}

// 현재 입력 폼의 스테이터스로 커맨드 체크박스 “선택 불가” 처리
function refreshCommandDisableByCurrentStats() {
  if (!commandList) return;

  const tmpChar = {
    stats: readStatsFromForm(),
  };

  const checks = commandList.querySelectorAll("input[type=checkbox][data-cmd]");
  for (const cb of checks) {
    const cmdId = cb.dataset.cmd;
    const ok = cmdStatEligible(tmpChar, cmdId);

    // 스탯 조건 불충족이면 아예 선택 불가 + 체크 해제
    cb.disabled = !ok;
    if (!ok) cb.checked = false;
  }
}

// -------------------------------
// 폼 읽기/검증
// -------------------------------
function readStatsFromForm() {
  const stats = {};
  for (const f of STAT_FIELDS) {
    const el = $(`stat_${f.key}`);
    let v = Number(el?.value ?? 0);
    if (!Number.isFinite(v)) v = 0;
    if (v < f.min) v = f.min;
    if (v > f.max) v = f.max;
    stats[f.key] = v;
  }
  return stats;
}

function readPersonalityFromForm() {
  const p = {};
  for (const f of PERS_FIELDS) {
    const el = $(`pers_${f.key}`);
    let v = Number(el?.value ?? 0);
    if (!Number.isFinite(v)) v = 0;
    if (v < f.min) v = f.min;
    if (v > f.max) v = f.max;
    p[f.key] = v;
  }
  return p;
}

function readEnabledCommandsFromForm() {
  const enabled = [];
  if (!commandList) return enabled;
  const checks = commandList.querySelectorAll("input[type=checkbox][data-cmd]");
  for (const cb of checks) {
    if (cb.checked) enabled.push(cb.dataset.cmd);
  }
  return enabled;
}

function validateBasicFields() {
  const name = (elName?.value ?? "").trim();
  if (!name) return { ok: false, msg: "이름을 입력해줘." };

  const age = Number(elAge?.value ?? 0);
  if (!Number.isFinite(age) || age < 0) return { ok: false, msg: "나이는 0 이상 숫자여야 해." };

  return { ok: true };
}

function resetForm() {
  if (elName) elName.value = "";
  if (elGender) elGender.value = "남성";
  if (elAge) elAge.value = "";

  for (const f of STAT_FIELDS) {
    const el = $(`stat_${f.key}`);
    if (el) el.value = "";
  }
  for (const f of PERS_FIELDS) {
    const el = $(`pers_${f.key}`);
    if (el) el.value = "";
  }

  // 체크 해제 + 비활성 업데이트
  if (commandList) {
    const checks = commandList.querySelectorAll("input[type=checkbox][data-cmd]");
    for (const cb of checks) cb.checked = false;
  }
  refreshCommandDisableByCurrentStats();
}

// -------------------------------
// 캐릭터 목록 렌더
// -------------------------------
function renderCharList() {
  if (!charList) return;
  charList.innerHTML = "";

  for (const c of characters) {
    const row = document.createElement("div");
    row.className = "char-row";

    const left = document.createElement("div");
    left.className = "char-main";
    left.innerHTML = `<b>${escapeHtml(c.name)}</b> <span class="mini">(${escapeHtml(c.gender)}, ${c.age})</span>`;

    const right = document.createElement("div");
    right.className = "char-actions";

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn";
    btnEdit.textContent = "수정";
    btnEdit.onclick = () => startEdit(c.id);

    const btnDel = document.createElement("button");
    btnDel.className = "btn";
    btnDel.textContent = "삭제";
    btnDel.onclick = () => {
      characters = characters.filter((x) => x.id !== c.id);
      if (editId === c.id) stopEdit();
      renderCharList();
      refreshRunEnabled();
    };

    right.appendChild(btnEdit);
    right.appendChild(btnDel);

    row.appendChild(left);
    row.appendChild(right);

    charList.appendChild(row);
  }
}

function refreshRunEnabled() {
  const ok = characters.length >= 5 && characters.length <= 15;
  if (runBtn) runBtn.disabled = !ok;
}

function startEdit(id) {
  const c = characters.find((x) => x.id === id);
  if (!c) return;

  editId = id;
  if (editBanner) editBanner.style.display = "block";
  if (applyEditBtn) applyEditBtn.disabled = false;
  if (cancelEditBtn) cancelEditBtn.disabled = false;
  if (addBtn) addBtn.disabled = true;

  // 폼 채우기
  if (elName) elName.value = c.name;
  if (elGender) elGender.value = c.gender;
  if (elAge) elAge.value = String(c.age);

  for (const f of STAT_FIELDS) {
    const el = $(`stat_${f.key}`);
    if (el) el.value = String(c.stats?.[f.key] ?? 0);
  }
  for (const f of PERS_FIELDS) {
    const el = $(`pers_${f.key}`);
    if (el) el.value = String(c.personality?.[f.key] ?? 0);
  }

  // 체크박스: 스탯 기준 비활성 업데이트 후, 가능한 것만 체크 반영
  refreshCommandDisableByCurrentStats();
  const enabled = new Set(c.enabledCommands ?? []);
  const checks = commandList?.querySelectorAll("input[type=checkbox][data-cmd]") ?? [];
  for (const cb of checks) {
    if (cb.disabled) {
      cb.checked = false;
    } else {
      cb.checked = enabled.has(cb.dataset.cmd);
    }
  }
}

function stopEdit() {
  editId = null;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) applyEditBtn.disabled = true;
  if (cancelEditBtn) cancelEditBtn.disabled = true;
  if (addBtn) addBtn.disabled = false;
  resetForm();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// -------------------------------
// Save / Load (캐릭터만)
// -------------------------------
function doSave() {
  const data = {
    version: 1,
    characters,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gnosia_characters.json";
  a.click();
  URL.revokeObjectURL(url);
  log("✅ 캐릭터 목록을 저장했어.");
}

async function doLoad() {
  const file = loadFile?.files?.[0];
  if (!file) {
    log("❌ 로드할 파일을 선택해줘.");
    return;
  }
  const text = await file.text();
  const obj = JSON.parse(text);

  if (!obj || !Array.isArray(obj.characters)) {
    log("❌ 파일 형식이 올바르지 않아.");
    return;
  }

  characters = obj.characters.map((c) => ({
    id: c.id ?? uuid(),
    name: c.name ?? "이름없음",
    gender: c.gender ?? "남성",
    age: Number(c.age ?? 0),
    stats: c.stats ?? {},
    personality: c.personality ?? {},
    enabledCommands: Array.isArray(c.enabledCommands) ? c.enabledCommands : [],
  }));

  stopEdit();
  renderCharList();
  refreshRunEnabled();
  log("✅ 캐릭터 목록을 불러왔어.");
}

// -------------------------------
// 게임 설정 읽기
// -------------------------------
function readGameConfig() {
  // roles.js가 없어도, 엔진이 normalize해서 처리할 수 있게 단순 객체로 전달
  const rolesEnabled = {};
  if (setEngineer) rolesEnabled["엔지니어"] = !!setEngineer.checked;
  if (setDoctor) rolesEnabled["닥터"] = !!setDoctor.checked;
  if (setGuardian) rolesEnabled["수호천사"] = !!setGuardian.checked;
  if (setGuardDuty) rolesEnabled["선내대기인"] = !!setGuardDuty.checked;
  if (setAC) rolesEnabled["AC주의자"] = !!setAC.checked;
  if (setBug) rolesEnabled["버그"] = !!setBug.checked;

  let gnosiaCount = Number(gnosiaCountEl?.value ?? 1);
  if (!Number.isFinite(gnosiaCount)) gnosiaCount = 1;

  return { rolesEnabled, gnosiaCount };
}

// -------------------------------
// 이벤트 바인딩
// -------------------------------
function bindEvents() {
  addBtn?.addEventListener("click", () => {
    const v = validateBasicFields();
    if (!v.ok) {
      log("❌ " + v.msg);
      return;
    }
    if (characters.length >= 15) {
      log("❌ 캐릭터는 최대 15명까지야.");
      return;
    }

    const c = {
      id: uuid(),
      name: (elName.value ?? "").trim(),
      gender: elGender?.value ?? "남성",
      age: Number(elAge?.value ?? 0),
      stats: readStatsFromForm(),
      personality: readPersonalityFromForm(),
      enabledCommands: readEnabledCommandsFromForm(),
    };

    characters.push(c);
    renderCharList();
    refreshRunEnabled();
    resetForm();
    log(`✅ 캐릭터 추가: ${c.name}`);
  });

  applyEditBtn?.addEventListener("click", () => {
    if (!editId) return;
    const v = validateBasicFields();
    if (!v.ok) {
      log("❌ " + v.msg);
      return;
    }
    const idx = characters.findIndex((x) => x.id === editId);
    if (idx < 0) return;

    characters[idx] = {
      ...characters[idx],
      name: (elName.value ?? "").trim(),
      gender: elGender?.value ?? "남성",
      age: Number(elAge?.value ?? 0),
      stats: readStatsFromForm(),
      personality: readPersonalityFromForm(),
      enabledCommands: readEnabledCommandsFromForm(),
    };

    renderCharList();
    stopEdit();
    refreshRunEnabled();
    log("✅ 수정 적용 완료");
  });

  cancelEditBtn?.addEventListener("click", () => {
    stopEdit();
    log("ℹ️ 수정 취소");
  });

  saveBtn?.addEventListener("click", doSave);
  loadBtn?.addEventListener("click", doLoad);

  logSaveBtn?.addEventListener("click", () => {
    const text = Array.from(logBox?.children ?? []).map((d) => d.textContent).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gnosia_log.txt";
    a.click();
    URL.revokeObjectURL(url);
  });

  runBtn?.addEventListener("click", async () => {
    if (characters.length < 5) {
      log("❌ 캐릭터 5명 이상이어야 실행할 수 있어.");
      return;
    }

    // 엔진이 없으면, 여기서 이유를 알려준다.
    if (!GameEngine) {
      log("❌ 엔진(game.js)을 불러오지 못했어. GitHub Pages 경로나 파일명을 확인해줘.");
      return;
    }

    // 엔진 초기화가 안 되어 있으면 시작
    if (!engine) {
      try {
        engine = new GameEngine({
          characters: characters.map((c) => ({
            ...c,
            enabledCommands: new Set(c.enabledCommands ?? []),
          })),
          config: readGameConfig(),
          onLog: (m) => log(m),
        });
        log("✅ 게임이 시작되었습니다.");
      } catch (e) {
        log("❌ 엔진 초기화 오류: " + (e?.message ?? e));
        return;
      }
    }

    // 1스텝 진행
    try {
      engine.step?.();
    } catch (e) {
      log("❌ 엔진 step 오류: " + (e?.message ?? e));
    }

    // 관계도 갱신(있으면)
    try {
      if (relationsView && typeof engine.getRelationsText === "function") {
        relationsView.textContent = engine.getRelationsText();
      }
    } catch (e) {
      // 무시
    }
  });
}

// -------------------------------
// 초기화
// -------------------------------
function init() {
  clearLog();

  // DOM이 없으면 바로 알려줌(현재 네 증상은 여기서 잡힌다)
  const missing = [];
  if (!statsGrid) missing.push("statsGrid");
  if (!persGrid) missing.push("persGrid");
  if (!commandList) missing.push("commandList");
  if (!addBtn) missing.push("addChar");
  if (!runBtn) missing.push("runBtn");
  if (!charList) missing.push("charList");
  if (!logBox) missing.push("log");

  if (missing.length) {
    console.error("Missing DOM ids:", missing);
    // 화면이 안 뜨는 원인 = HTML id 불일치
    // (하지만 너는 지금 스테이터스/성격은 보였다고 했으니, commandList만 잘못일 가능성이 큼)
  }

  renderStatsInputs();
  renderPersInputs();
  renderCommandChecklist();

  bindEvents();
  renderCharList();
  refreshRunEnabled();

  log("ℹ️ UI 초기화 완료");
}

init();
