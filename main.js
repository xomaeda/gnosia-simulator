// main.js (루트) — UI 렌더링을 엔진 로딩과 분리한 안정 버전
// HTML: <script type="module" src="./main.js"></script>

import { COMMAND_DEFS, statEligible as cmdStatEligible } from "./engine/commands.js";

// -------------------------------
// DOM helpers
// -------------------------------
const $ = (id) => document.getElementById(id);
const pick = (...ids) => ids.map($).find(Boolean) || null;

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

function addLogLine(msg) {
  const logBox = $("log");
  if (!logBox) return;
  const div = document.createElement("div");
  div.textContent = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}
function clearLog() {
  const logBox = $("log");
  if (logBox) logBox.innerHTML = "";
}

// -------------------------------
// Input field definitions
// -------------------------------
const STAT_FIELDS = [
  { key: "charisma",  label: "카리스마", min: 0, max: 50, step: 0.1, digits: 1 },
  { key: "logic",     label: "논리력",   min: 0, max: 50, step: 0.1, digits: 1 },
  { key: "acting",    label: "연기력",   min: 0, max: 50, step: 0.1, digits: 1 },
  { key: "charm",     label: "귀염성",   min: 0, max: 50, step: 0.1, digits: 1 },
  { key: "stealth",   label: "스텔스",   min: 0, max: 50, step: 0.1, digits: 1 },
  { key: "intuition", label: "직감",     min: 0, max: 50, step: 0.1, digits: 1 },
];

const PERS_FIELDS = [
  { key: "cheer",    label: "쾌활함",   min: 0.0, max: 1.0, step: 0.01, digits: 2 },
  { key: "social",   label: "사회성",   min: 0.0, max: 1.0, step: 0.01, digits: 2 },
  { key: "logical",  label: "논리성향", min: 0.0, max: 1.0, step: 0.01, digits: 2 },
  { key: "kindness", label: "상냥함",   min: 0.0, max: 1.0, step: 0.01, digits: 2 },
  { key: "desire",   label: "욕망",     min: 0.0, max: 1.0, step: 0.01, digits: 2 },
  { key: "courage",  label: "용기",     min: 0.0, max: 1.0, step: 0.01, digits: 2 },
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
  const statsGrid = $("statsGrid");
  if (!statsGrid) return;
  statsGrid.innerHTML = "";
  for (const f of STAT_FIELDS) {
    statsGrid.appendChild(makeKVInput(f, 0));
  }
}

function renderPersonalityInputs() {
  const persGrid = $("persGrid");
  if (!persGrid) return;
  persGrid.innerHTML = "";
  for (const f of PERS_FIELDS) {
    persGrid.appendChild(makeKVInput(f, 0.5));
  }
}

function readNumber(id, min, max, digits) {
  const el = $(id);
  const v = toFloat(el?.value, min);
  const cl = clamp(v, min, max);
  return roundTo(cl, digits);
}

function currentStatsFromForm() {
  const stats = {};
  for (const f of STAT_FIELDS) {
    stats[f.key] = readNumber(f.key, f.min, f.max, f.digits);
  }
  return stats;
}

function currentPersFromForm() {
  const pers = {};
  for (const f of PERS_FIELDS) {
    pers[f.key] = readNumber(f.key, f.min, f.max, f.digits);
  }
  return pers;
}

// -------------------------------
// Command checklist (스탯 부족이면 disabled)
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
  const commandList = $("commandList");
  if (!commandList) return;

  commandList.innerHTML = "";
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
  const commandList = $("commandList");
  if (!commandList) return;

  const stats = currentStatsFromForm();

  commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    const cmdId = chk.dataset.cmd;
    const ok = cmdStatEligible({ stats }, cmdId);

    if (!ok) chk.checked = false;
    chk.disabled = !ok;

    const label = chk.closest(".cmd");
    const reqEl = label?.querySelector(".cmd-req");
    if (reqEl) {
      const def = (Array.isArray(COMMAND_DEFS) ? COMMAND_DEFS : []).find((d) => d?.id === cmdId);
      const base = def ? `요구: ${buildReqText(def)}` : "요구: ?";
      reqEl.textContent = ok ? base : `${base} (스탯 부족)`;
    }
  });
}

function bindLiveEligibilityRefresh() {
  for (const f of STAT_FIELDS) {
    const el = $(f.key);
    if (!el) continue;
    el.addEventListener("input", refreshCommandAvailability);
  }
}

// -------------------------------
// Characters state
// -------------------------------
let characters = [];
let engine = null;

function uid() {
  return "c_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function renderCharacters() {
  const charList = $("charList");
  const runBtn = $("runBtn");
  if (!charList) return;

  charList.innerHTML = "";
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i];
    const div = document.createElement("div");
    div.className = "char-entry";
    const cmdCount = (c.allowedCommands || []).length;
    div.innerHTML = `
      <div class="top">
        <b>#${i + 1} ${c.name}</b>
      </div>
      <div class="mini">${c.gender} · ${c.age}세</div>
      <div class="mini">커맨드(${cmdCount}): ${cmdCount ? c.allowedCommands.join(", ") : "없음"}</div>
    `;
    charList.appendChild(div);
  }

  if (runBtn) runBtn.disabled = characters.length < 5;
}

function collectFormCharacter() {
  const elName = $("name");
  const elGender = $("gender");
  const elAge = $("age");

  const name = String(elName?.value || "").trim();
  if (!name) throw new Error("이름을 입력하세요.");

  const gender = String(elGender?.value || "남성");
  const age = clamp(toIntNonNeg(elAge?.value, 0), 0, 999);

  const stats = currentStatsFromForm();
  const pers = currentPersFromForm();

  const commandList = $("commandList");
  const allowedCommands = [];
  if (commandList) {
    commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => {
      if (chk.checked && !chk.disabled) allowedCommands.push(chk.dataset.cmd);
    });
  }

  return { id: uid(), name, gender, age, stats, pers, allowedCommands };
}

function resetForm() {
  const elName = $("name");
  const elGender = $("gender");
  const elAge = $("age");
  if (elName) elName.value = "";
  if (elGender) elGender.value = "남성";
  if (elAge) elAge.value = "0";

  for (const f of STAT_FIELDS) {
    const el = $(f.key);
    if (el) el.value = "0";
  }
  for (const f of PERS_FIELDS) {
    const el = $(f.key);
    if (el) el.value = "0.5";
  }

  const commandList = $("commandList");
  if (commandList) {
    commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => (chk.checked = false));
  }
  refreshCommandAvailability();
}

// -------------------------------
// Engine loading (✅ 동적 import)
// -------------------------------
async function getGameEngineClass() {
  const mod = await import("./engine/game.js"); // 여기서 에러 나도 UI는 이미 렌더됨
  if (!mod?.GameEngine) throw new Error("engine/game.js에서 GameEngine export를 찾지 못했습니다.");
  return mod.GameEngine;
}

function getGameSettings() {
  const enableEngineerEl  = pick("setEngineer",  "enableEngineer");
  const enableDoctorEl    = pick("setDoctor",    "enableDoctor");
  const enableGuardianEl  = pick("setGuardian",  "enableGuardian");
  const enableGuardDutyEl = pick("setGuardDuty", "enableGuardDuty");
  const enableACEl        = pick("setAC",        "enableAC");
  const enableBugEl       = pick("setBug",       "enableBug");
  const gnosiaCountEl     = pick("gnosiaCount");

  return {
    rolesEnabled: {
      엔지니어: enableEngineerEl ? !!enableEngineerEl.checked : true,
      닥터: enableDoctorEl ? !!enableDoctorEl.checked : true,
      수호천사: enableGuardianEl ? !!enableGuardianEl.checked : true,
      선내대기인: enableGuardDutyEl ? !!enableGuardDutyEl.checked : true,
      AC주의자: enableACEl ? !!enableACEl.checked : true,
      버그: enableBugEl ? !!enableBugEl.checked : true,
    },
    gnosiaCount: gnosiaCountEl ? clamp(toIntNonNeg(gnosiaCountEl.value, 1), 1, 6) : 1,
  };
}

function flushEngineLogs() {
  if (!engine) return;
  if (!Array.isArray(engine.logs)) return;
  while (engine.logs.length > 0) addLogLine(engine.logs.shift());
}

async function stepGame() {
  if (characters.length < 5) {
    alert("캐릭터가 최소 5명 이상이어야 실행할 수 있습니다.");
    return;
  }

  // 엔진 생성(최초 1회)
  if (!engine) {
    const GameEngine = await getGameEngineClass();
    engine = new GameEngine(characters, getGameSettings(), null);
    flushEngineLogs();
    addLogLine("게임이 시작되었습니다.");
  }

  // 1스텝 진행
  engine.step();
  flushEngineLogs();
}

// -------------------------------
// Init
// -------------------------------
function initUI() {
  // UI는 엔진 없이도 반드시 뜨게!
  renderStatsInputs();
  renderPersonalityInputs();
  renderCommandChecklist(currentStatsFromForm());
  bindLiveEligibilityRefresh();
  refreshCommandAvailability();

  renderCharacters();
  resetForm();
  clearLog();
  addLogLine("준비 완료. 캐릭터를 추가/로드 후 실행(1스텝) 버튼으로 진행하세요.");
}

function bindEvents() {
  const addBtn = $("addChar");
  const runBtn = $("runBtn");

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      try {
        const c = collectFormCharacter();
        characters.push(c);
        engine = null;
        addLogLine(`[추가] ${c.name} 추가됨`);
        renderCharacters();
        resetForm();
      } catch (e) {
        alert(e?.message ?? String(e));
      }
    });
  }

  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      try {
        await stepGame();
      } catch (e) {
        // ✅ 엔진 쪽 오류가 떠도 UI는 유지
        addLogLine(`❌ 엔진 오류: ${e?.message ?? String(e)}`);
        console.error(e);
      }
    });
  }

  // Save/Load (있으면)
  const saveBtn = $("saveBtn");
  const loadBtn = $("loadBtn");
  const loadFile = $("loadFile");

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const payload = JSON.stringify({ characters }, null, 2);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      a.download = "gnosia_characters.json";
      a.click();
      URL.revokeObjectURL(a.href);
      addLogLine("[세이브] gnosia_characters.json 저장됨");
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      try {
        if (!loadFile?.files?.length) {
          alert("로드할 파일을 선택하세요.");
          return;
        }
        const text = await loadFile.files[0].text();
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.characters)) throw new Error("잘못된 파일 형식입니다.");

        // 보정 로드
        characters = data.characters
          .map((c) => ({
            id: String(c.id || uid()),
            name: String(c.name ?? "").trim(),
            gender: c.gender ?? "남성",
            age: clamp(toIntNonNeg(c.age ?? 0, 0), 0, 999),
            stats: Object.fromEntries(STAT_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.stats?.[f.key], 0), f.min, f.max), f.digits)])),
            pers: Object.fromEntries(PERS_FIELDS.map((f) => [f.key, roundTo(clamp(toFloat(c.pers?.[f.key], 0.5), f.min, f.max), f.digits)])),
            allowedCommands: Array.isArray(c.allowedCommands) ? c.allowedCommands.slice() : [],
          }))
          .filter((x) => x.name);

        engine = null;
        addLogLine("[로드] 완료");
        renderCharacters();
        resetForm();
      } catch (e) {
        alert(e?.message ?? String(e));
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  bindEvents();
});
