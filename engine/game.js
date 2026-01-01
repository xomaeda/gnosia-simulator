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

const applyEditBtn = $("applyEditBtn");
const cancelEditBtn = $("cancelEditBtn");
const editBanner = $("editBanner");

const charList = $("charList");
const logBox = $("log");

// 게임 설정(HTML id가 setEngineer / enableEngineer 둘 중 뭐든 대응)
const enableEngineerEl  = pick("setEngineer",  "enableEngineer");
const enableDoctorEl    = pick("setDoctor",    "enableDoctor");
const enableGuardianEl  = pick("setGuardian",  "enableGuardian");
const enableGuardDutyEl = pick("setGuardDuty", "enableGuardDuty");
const enableACEl        = pick("setAC",        "enableAC");
const enableBugEl       = pick("setBug",       "enableBug");
const gnosiaCountEl     = pick("gnosiaCount");

// 관계도 컨테이너(있으면)
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
// Input field definitions
// -------------------------------
const STAT_FIELDS = [
  { key: "charisma",  label: "카리스마", min: 0, max: 50, step: 0.1 },
  { key: "logic",     label: "논리력",   min: 0, max: 50, step: 0.1 },
  { key: "acting",    label: "연기력",   min: 0, max: 50, step: 0.1 },
  { key: "charm",     label: "귀염성",   min: 0, max: 50, step: 0.1 },
  { key: "stealth",   label: "스텔스",   min: 0, max: 50, step: 0.1 },
  { key: "intuition", label: "직감",     min: 0, max: 50, step: 0.1 },
];

const PERS_FIELDS = [
  { key: "cheer",    label: "쾌활함",   min: 0.0, max: 1.0, step: 0.01 },
  { key: "social",   label: "사회성",   min: 0.0, max: 1.0, step: 0.01 },
  { key: "logical",  label: "논리성향", min: 0.0, max: 1.0, step: 0.01 },
  { key: "kindness", label: "상냥함",   min: 0.0, max: 1.0, step: 0.01 },
  { key: "desire",   label: "욕망",     min: 0.0, max: 1.0, step: 0.01 },
  { key: "courage",  label: "용기",     min: 0.0, max: 1.0, step: 0.01 },
];

function makeKVInput({ key, label, min, max, step }, defaultValue) {
  const wrap = document.createElement("label");
  wrap.className = "kv";

  const t = document.createElement("div");
  t.className = "k";
  t.textContent = label;

  const input = document.createElement("input");
  input.className = "input";
  input.type = "number";
  input.id = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step ?? 1);
  input.value = String(defaultValue);

  wrap.appendChild(t);
  wrap.appendChild(input);
  return wrap;
}

function renderStatsInputs() {
  statsGrid.innerHTML = "";
  for (const f of STAT_FIELDS) {
    const node = makeKVInput(f, 0);
    statsGrid.appendChild(node);
  }
}

function renderPersonalityInputs() {
  persGrid.innerHTML = "";
  for (const f of PERS_FIELDS) {
    const node = makeKVInput(f, 0.5);
    persGrid.appendChild(node);
  }
}

function readNumber(id, min, max, digits = 2) {
  const el = $(id);
  const v = toFloat(el?.value, min);
  const cl = clamp(v, min, max);
  const d = digits;
  return roundTo(cl, d);
}

function currentStatsFromForm() {
  const stats = {};
  for (const f of STAT_FIELDS) {
    // 스테이터스는 0~50, 소수 1자리
    stats[f.key] = readNumber(f.key, f.min, f.max, 1);
  }
  return stats;
}

function currentPersFromForm() {
  const pers = {};
  for (const f of PERS_FIELDS) {
    // 성격은 0.00~1.00, 소수 2자리
    pers[f.key] = readNumber(f.key, f.min, f.max, 2);
  }
  return pers;
}

// -------------------------------
// Command checklist
//  - ✅ 핵심: "스탯 조건 미달 커맨드"는 체크박스 disabled
//  - 성향(유저 판단)으로 막지 않음
// -------------------------------
function buildReqText(def) {
  const req = def.req || {};
  const pairs = Object.entries(req);
  if (!pairs.length) return "조건 없음";
  const map = {
    charisma: "카리스마",
    logic: "논리력",
    acting: "연기력",
    charm: "귀염성",
    stealth: "스텔스",
    intuition: "직감",
  };
  return pairs.map(([k, v]) => `${map[k] ?? k} ${v}+`).join(", ");
}

function renderCommandChecklist(statsForEligibility) {
  commandList.innerHTML = "";

  // COMMAND_DEFS는 commands.js에서 Object.values(COMMAND_META)로 넘어옴(배열)
  const defs = Array.isArray(COMMAND_DEFS) ? COMMAND_DEFS : [];

  for (const def of defs) {
    if (!def) continue;
    if (def.public === false) continue;
    if (def.needsCheck === false) continue;

    const cmdId = def.id;

    const row = document.createElement("label");
    row.className = "cmd";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.dataset.cmd = cmdId;

    // ✅ 스탯 조건으로만 disabled
    const pseudoChar = { stats: statsForEligibility || {} };
    const ok = cmdStatEligible(pseudoChar, cmdId);
    chk.disabled = !ok;

    const txt = document.createElement("div");
    txt.className = "cmd-text";

    const name = document.createElement("div");
    name.className = "cmd-name";
    name.textContent = def.label ?? cmdId;

    const sub = document.createElement("div");
    sub.className = "cmd-req";
    sub.textContent = `요구: ${buildReqText(def)}${ok ? "" : " (스탯 부족)"}`;

    txt.appendChild(name);
    txt.appendChild(sub);

    row.appendChild(chk);
    row.appendChild(txt);
    commandList.appendChild(row);
  }
}

function refreshCommandAvailability() {
  const stats = currentStatsFromForm();

  // 이미 만들어진 체크박스들만 갱신
  commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    const cmdId = chk.dataset.cmd;
    const pseudoChar = { stats };
    const ok = cmdStatEligible(pseudoChar, cmdId);

    // ✅ 스탯 부족이면 즉시 체크 해제 + disabled
    if (!ok) chk.checked = false;
    chk.disabled = !ok;

    // 라벨 텍스트도 (스탯 부족) 표시 토글
    const label = chk.closest(".cmd");
    if (label) {
      const reqEl = label.querySelector(".cmd-req");
      if (reqEl) {
        const def = (Array.isArray(COMMAND_DEFS) ? COMMAND_DEFS : []).find((d) => d?.id === cmdId);
        const base = def ? `요구: ${buildReqText(def)}` : "요구: ?";
        reqEl.textContent = ok ? base : `${base} (스탯 부족)`;
      }
    }
  });
}

// -------------------------------
// Character list state
// -------------------------------
let characters = [];
let editingIndex = null;
let engine = null;

function uid() {
  return "c_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function resetForm() {
  elName.value = "";
  elGender.value = "남성";
  elAge.value = "0";

  for (const f of STAT_FIELDS) $(f.key).value = "0";
  for (const f of PERS_FIELDS) $(f.key).value = "0.5";

  // 체크 해제 + 스탯 조건으로 다시 disabled 반영
  commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => { chk.checked = false; });
  refreshCommandAvailability();

  editingIndex = null;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) applyEditBtn.disabled = true;
  if (cancelEditBtn) cancelEditBtn.disabled = true;
  if (addBtn) addBtn.disabled = false;
}

function collectFormCharacter() {
  const name = String(elName.value || "").trim();
  if (!name) throw new Error("이름을 입력하세요.");

  const gender = String(elGender.value || "남성");
  const age = clamp(toIntNonNeg(elAge.value, 0), 0, 999);

  const stats = currentStatsFromForm();
  const pers = currentPersFromForm();

  // ✅ 스탯 조건 통과 + 유저가 체크한 커맨드만 저장
  const allowedCommands = [];
  commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    if (chk.checked && !chk.disabled) allowedCommands.push(chk.dataset.cmd);
  });

  return {
    id: uid(),
    name,
    gender,
    age,
    stats,
    pers,
    allowedCommands,
  };
}

function enterEditMode(idx) {
  const c = characters[idx];
  if (!c) return;

  editingIndex = idx;
  if (editBanner) editBanner.style.display = "";
  if (applyEditBtn) applyEditBtn.disabled = false;
  if (cancelEditBtn) cancelEditBtn.disabled = false;
  if (addBtn) addBtn.disabled = true;

  elName.value = c.name;
  elGender.value = c.gender;
  elAge.value = String(c.age);

  for (const f of STAT_FIELDS) $(f.key).value = String(c.stats?.[f.key] ?? 0);
  for (const f of PERS_FIELDS) $(f.key).value = String(c.pers?.[f.key] ?? 0.5);

  refreshCommandAvailability();

  // 체크 초기화 후, 저장된 allowedCommands를 다시 체크(단, disabled는 체크 불가)
  commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => { chk.checked = false; });
  const set = new Set(c.allowedCommands || []);
  commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    if (!chk.disabled && set.has(chk.dataset.cmd)) chk.checked = true;
  });

  addLogLine(`[수정 모드] ${c.name} 편집 중…`);
}

function applyEdit() {
  if (editingIndex === null) return;
  const updated = collectFormCharacter();
  const prevId = characters[editingIndex].id;
  updated.id = prevId; // id 유지
  const prevName = characters[editingIndex].name;

  characters[editingIndex] = updated;
  engine = null; // 구성 바뀌면 엔진 리셋

  addLogLine(`[수정 완료] ${prevName} → ${updated.name}`);
  renderCharacters();
  resetForm();
}

function addCharacter() {
  const c = collectFormCharacter();
  characters.push(c);
  engine = null;
  addLogLine(`[추가] ${c.name} 추가됨`);
  renderCharacters();
  resetForm();
}

function deleteCharacter(idx) {
  const name = characters[idx]?.name ?? "해당 캐릭터";
  characters.splice(idx, 1);
  engine = null;
  addLogLine(`[삭제] ${name} 삭제됨`);
  renderCharacters();
}

function renderCharacters() {
  charList.innerHTML = "";

  characters.forEach((c, idx) => {
    const div = document.createElement("div");
    div.className = "char-entry";
    const cmdCount = (c.allowedCommands || []).length;

    div.innerHTML = `
      <div class="top">
        <b>#${idx + 1} ${c.name}</b>
        <div class="char-actions">
          <button class="btn-mini" data-edit="${idx}">수정</button>
          <button class="btn-mini btn-warn" data-del="${idx}">삭제</button>
        </div>
      </div>
      <div class="mini">${c.gender} · ${c.age}세</div>
      <div class="mini">스테이터스: 카리스마 ${c.stats.charisma} / 논리력 ${c.stats.logic} / 연기력 ${c.stats.acting} / 귀염성 ${c.stats.charm} / 스텔스 ${c.stats.stealth} / 직감 ${c.stats.intuition}</div>
      <div class="mini">성격: 쾌활함 ${c.pers.cheer} / 사회성 ${c.pers.social} / 논리성향 ${c.pers.logical} / 상냥함 ${c.pers.kindness} / 욕망 ${c.pers.desire} / 용기 ${c.pers.courage}</div>
      <div class="mini">사용 커맨드(${cmdCount}): ${cmdCount ? c.allowedCommands.join(", ") : "없음"}</div>
    `;
    charList.appendChild(div);
  });

  // 버튼 이벤트
  charList.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.del, 10);
      const name = characters[idx]?.name ?? "해당 캐릭터";
      if (confirm(`${name} 을(를) 삭제할까요?`)) {
        if (editingIndex === idx) resetForm();
        deleteCharacter(idx);
      }
    });
  });

  charList.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.edit, 10);
      enterEditMode(idx);
    });
  });

  runBtn.disabled = characters.length < 5;
}

// -------------------------------
// Save / Load (characters only)
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

  // 보정 로드
  const loaded = data.characters
    .map((c) => ({
      id: String(c.id || uid()),
      name: String(c.name ?? "").trim(),
      gender: c.gender ?? "남성",
      age: clamp(toIntNonNeg(c.age ?? 0, 0), 0, 999),
      stats: Object.fromEntries(
        STAT_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.stats?.[f.key], 0), f.min, f.max), 1)])
      ),
      pers: Object.fromEntries(
        PERS_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.pers?.[f.key], 0.5), f.min, f.max), 2)])
      ),
      allowedCommands: Array.isArray(c.allowedCommands) ? c.allowedCommands.slice() : [],
    }))
    .filter((c) => c.name);

  characters = loaded;
  engine = null;

  clearLog();
  addLogLine("[로드] 완료. 캐릭터 5명 이상이면 실행 가능.");
  renderCharacters();
  resetForm();
}

// -------------------------------
// Game settings
// -------------------------------
function computeMaxGnosiaCount(n) {
  // roles.js가 제공하면 그걸 쓰고, 없으면 기획서 기준 fallback
  if (typeof rolesApi?.computeMaxGnosia === "function") return rolesApi.computeMaxGnosia(n);
  if (n <= 6) return 1;
  if (n <= 8) return 2;
  if (n <= 10) return 3;
  if (n <= 12) return 4;
  if (n <= 14) return 5;
  return 6;
}

function getGameSettings() {
  const n = characters.length;
  const maxG = computeMaxGnosiaCount(n);

  // ✅ GameEngine이 rolesEnabled 형태를 기대하는 경우가 많아서 그렇게 전달
  // (roles.js normalizeGameConfig가 있으면 engine 내부에서 다시 정리됨)
  return {
    rolesEnabled: {
      엔지니어: enableEngineerEl ? !!enableEngineerEl.checked : true,
      닥터: enableDoctorEl ? !!enableDoctorEl.checked : true,
      수호천사: enableGuardianEl ? !!enableGuardianEl.checked : true,
      선내대기인: enableGuardDutyEl ? !!enableGuardDutyEl.checked : true,
      AC주의자: enableACEl ? !!enableACEl.checked : true,
      버그: enableBugEl ? !!enableBugEl.checked : true,
    },
    gnosiaCount: gnosiaCountEl ? clamp(toIntNonNeg(gnosiaCountEl.value, 1), 1, maxG) : 1,
  };
}

function flushEngineLogs() {
  // engine.logs 배열을 계속 비우면서 화면에 출력
  if (!engine) return;
  if (!Array.isArray(engine.logs)) return;

  while (engine.logs.length > 0) {
    addLogLine(engine.logs.shift());
  }
}

function startGameIfNeeded() {
  if (engine) return;

  const settings = getGameSettings();
  engine = new GameEngine(characters, settings, null);

  // 시작 즉시 엔진이 만든 로그가 있으면 출력
  flushEngineLogs();

  // 엔진이 별도로 “공개 역할 라인”을 제공하면 그것도 출력(겸용)
  if (typeof engine.getPublicRoleLines === "function") {
    const lines = engine.getPublicRoleLines() || [];
    lines.forEach(addLogLine);
  }

  if (!engine) addLogLine("[시작] 게임이 시작되었습니다.");
}

function stepGame() {
  if (characters.length < 5) {
    alert("캐릭터가 최소 5명 이상이어야 실행할 수 있습니다.");
    return;
  }

  startGameIfNeeded();

  // ✅ 여기서 1스텝 진행
  engine.step();

  // ✅ 스텝 결과 로그 출력
  flushEngineLogs();

  // (선택) 관계도 갱신
  if (relationApi && relationBox && typeof relationApi.renderRelations === "function") {
    try {
      relationApi.renderRelations(relationBox, engine);
    } catch (_) {}
  }
}

// -------------------------------
// Event binding
// -------------------------------
addBtn.addEventListener("click", () => {
  try { addCharacter(); } catch (e) { alert(e?.message ?? String(e)); }
});

applyEditBtn.addEventListener("click", () => {
  try { applyEdit(); } catch (e) { alert(e?.message ?? String(e)); }
});

cancelEditBtn.addEventListener("click", () => {
  resetForm();
});

saveBtn.addEventListener("click", () => {
  try { saveCharacters(); } catch (e) { alert(e?.message ?? String(e)); }
});

loadBtn.addEventListener("click", async () => {
  if (!loadFile.files || loadFile.files.length === 0) {
    alert("로드할 파일을 선택하세요.");
    return;
  }
  try {
    await loadCharactersFromFile(loadFile.files[0]);
  } catch (e) {
    alert(e?.message ?? String(e));
  }
});

runBtn.addEventListener("click", () => {
  try { stepGame(); } catch (e) { alert(e?.message ?? String(e)); }
});

// stats 입력 바뀌면 커맨드 disabled 즉시 갱신
function bindLiveEligibilityRefresh() {
  for (const f of STAT_FIELDS) {
    const el = $(f.key);
    if (!el) continue;
    el.addEventListener("input", () => refreshCommandAvailability());
  }
}

// -------------------------------
// Initial render
// -------------------------------
renderStatsInputs();
renderPersonalityInputs();

// 커맨드 체크리스트는 “현재 폼 스탯” 기준으로 처음부터 disabled 반영
renderCommandChecklist(currentStatsFromForm());
bindLiveEligibilityRefresh();
refreshCommandAvailability();

renderCharacters();
resetForm();

addLogLine("준비 완료. 캐릭터를 5명 이상 만들고 실행 버튼을 누르면 1스텝씩 진행됩니다.");
