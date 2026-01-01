// main.js  (루트)  ✅ type="module" 로 로드해야 함
// -------------------------------------------------------
// 역할/커맨드/게임 엔진은 engine 폴더 파일을 사용한다고 가정:
//  - ./engine/game.js        : GameEngine
//  - ./engine/commands.js    : COMMAND_DEFS (커맨드 정의/요구 스탯 등)
//  - ./engine/roles.js       : getMaxGnosiaCount, defaultRoleSettings 등(있으면 사용)
//  - ./engine/relation.js    : (다음 단계에서 전달할 파일) 관계도 렌더
// -------------------------------------------------------

import { GameEngine } from "./engine/game.js";
import { COMMAND_DEFS } from "./engine/commands.js";

// roles.js가 존재한다면 활용 (없어도 main.js는 돌아가게 try/catch)
let rolesApi = null;
try {
  rolesApi = await import("./engine/roles.js");
} catch (e) {
  rolesApi = null;
}

let relationApi = null;
try {
  relationApi = await import("./engine/relation.js");
} catch (e) {
  relationApi = null;
}

// -------------------------------
// DOM helpers
// -------------------------------
const $ = (id) => document.getElementById(id);

const elName = $("name");
const elGender = $("gender");
const elAge = $("age");

const statsGrid = $("statsGrid");     // div.kv-grid
const persGrid = $("persGrid");       // div.kv-grid
const commandList = $("commandList"); // div.cmd-grid

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

// (있으면) 게임 설정 UI
const enableEngineerEl = $("enableEngineer");
const enableDoctorEl = $("enableDoctor");
const enableGuardianEl = $("enableGuardian");
const enableGuardDutyEl = $("enableGuardDuty");
const enableACEl = $("enableAC");
const enableBugEl = $("enableBug");
const gnosiaCountEl = $("gnosiaCount");

// (있으면) 관계도 컨테이너
const relationBox = $("relationBox");

// -------------------------------
// 입력 필드 정의 (기획서 기준)
// -------------------------------
const STAT_FIELDS = [
  { key: "charisma", label: "카리스마", min: 0, max: 50, step: 0.1 },
  { key: "logic", label: "논리력", min: 0, max: 50, step: 0.1 },
  { key: "acting", label: "연기력", min: 0, max: 50, step: 0.1 },
  { key: "charm", label: "귀염성", min: 0, max: 50, step: 0.1 },
  { key: "stealth", label: "스텔스", min: 0, max: 50, step: 0.1 },
  { key: "intuition", label: "직감", min: 0, max: 50, step: 0.1 },
];

// ✅ 성격: 0.00 ~ 1.00
const PERS_FIELDS = [
  { key: "cheer", label: "쾌활함", min: 0.0, max: 1.0, step: 0.01 },
  { key: "social", label: "사회성", min: 0.0, max: 1.0, step: 0.01 },
  { key: "logical", label: "논리성향", min: 0.0, max: 1.0, step: 0.01 },
  { key: "kindness", label: "상냥함", min: 0.0, max: 1.0, step: 0.01 },
  { key: "desire", label: "욕망", min: 0.0, max: 1.0, step: 0.01 },
  { key: "courage", label: "용기", min: 0.0, max: 1.0, step: 0.01 },
];

// -------------------------------
// 상태
// -------------------------------
let characters = [];      // 캐릭터 목록(유저 생성)
let editingIndex = null;  // 수정 모드 인덱스
let engine = null;        // 게임 엔진(실행 후 생성)

// -------------------------------
// 유틸
// -------------------------------
function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function roundTo(v, digits = 2) {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
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

function statusMeetsReq(status, reqPairs) {
  // reqPairs: [ [key, min], ... ]
  if (!reqPairs || reqPairs.length === 0) return true;
  return reqPairs.every(([k, min]) => (status[k] ?? 0) >= min);
}

function currentStatusFromInputs() {
  const obj = {};
  for (const f of STAT_FIELDS) {
    const el = $(`stat_${f.key}`);
    obj[f.key] = clamp(el?.value ?? 0, f.min, f.max);
  }
  return obj;
}

function currentPersFromInputs() {
  const obj = {};
  for (const f of PERS_FIELDS) {
    const el = $(`per_${f.key}`);
    obj[f.key] = clamp(el?.value ?? 0, f.min, f.max);
  }
  return obj;
}

// -------------------------------
// UI 생성: 스탯/성격 입력칸(라벨+인풋)
// -------------------------------
function renderStatsInputs() {
  statsGrid.innerHTML = "";
  for (const f of STAT_FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "kv";

    wrap.innerHTML = `
      <div class="k">
        <span>${f.label}</span>
        <span class="hint">${f.min}~${f.max}</span>
      </div>
      <input id="stat_${f.key}" type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="0">
    `;
    statsGrid.appendChild(wrap);
  }
}

function renderPersInputs() {
  persGrid.innerHTML = "";
  for (const f of PERS_FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "kv";

    wrap.innerHTML = `
      <div class="k">
        <span>${f.label}</span>
        <span class="hint">${f.min.toFixed(2)}~${f.max.toFixed(2)}</span>
      </div>
      <input id="per_${f.key}" type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="0.50">
    `;
    persGrid.appendChild(wrap);
  }
}

// -------------------------------
// 커맨드 체크리스트 렌더 (스탯 미달이면 비활성)
// - 유저가 "성향상 안 쓸 커맨드"를 체크 해제 가능
// -------------------------------
function renderCommandChecklist(selectedNames = []) {
  commandList.innerHTML = "";

  const status = currentStatusFromInputs();

  for (const def of COMMAND_DEFS) {
    // UI에 노출할 커맨드만: def.ui === false 면 숨김 처리(내부용)
    if (def.ui === false) continue;

    const ok = statusMeetsReq(status, def.req ?? []);
    const id = `cmd_${hashName(def.name)}`;

    const item = document.createElement("label");
    item.className = "cmd" + (ok ? "" : " disabled");

    const reqText =
      def.req && def.req.length
        ? def.req.map(([k, m]) => `${statLabel(k)}≥${m}`).join(", ")
        : "조건 없음";

    item.innerHTML = `
      <input type="checkbox" id="${id}" ${ok ? "" : "disabled"} ${selectedNames.includes(def.name) ? "checked" : ""}>
      <span class="name">${def.name}</span>
      <span class="req">${reqText}</span>
    `;

    commandList.appendChild(item);
  }
}

function refreshCommandAvailabilityKeepChecks() {
  // 현재 체크 상태를 기억했다가, 다시 렌더링 후 유지
  const chosen = new Set(getCheckedCommandNames());
  renderCommandChecklist(Array.from(chosen));
}

// -------------------------------
// 커맨드 체크 읽기
// -------------------------------
function getCheckedCommandNames() {
  const names = [];
  for (const def of COMMAND_DEFS) {
    if (def.ui === false) continue;
    const id = `cmd_${hashName(def.name)}`;
    const el = $(id);
    if (el && !el.disabled && el.checked) names.push(def.name);
  }
  return names;
}

// -------------------------------
// 캐릭터 폼 읽기 + 검증/보정
// -------------------------------
function readFormCharacterOrThrow() {
  const name = (elName.value ?? "").trim();
  const gender = elGender.value ?? "남성";

  const ageRaw = elAge.value ?? "";
  const age = clamp(parseInt(ageRaw, 10), 0, 999);
  if (!name) throw new Error("이름을 입력해줘.");
  if (!Number.isFinite(age)) throw new Error("나이를 올바르게 입력해줘(0 이상).");

  // 스탯 0~50 / 소수 1자리
  const status = {};
  for (const f of STAT_FIELDS) {
    const v = clamp($(`stat_${f.key}`)?.value ?? 0, f.min, f.max);
    status[f.key] = roundTo(v, 1);
  }

  // 성격 0.00~1.00 / 소수 2자리
  const personality = {};
  for (const f of PERS_FIELDS) {
    const v = clamp($(`per_${f.key}`)?.value ?? 0.5, f.min, f.max);
    personality[f.key] = roundTo(v, 2);
  }

  // 커맨드: 스탯 미달은 체크 자체가 disabled라 들어오지 않음
  const allowedCommands = getCheckedCommandNames();

  return { name, gender, age, status, personality, allowedCommands };
}

function resetForm() {
  elName.value = "";
  elGender.value = "남성";
  elAge.value = "0";

  // 기본값 리셋
  for (const f of STAT_FIELDS) $(`stat_${f.key}`).value = "0";
  for (const f of PERS_FIELDS) $(`per_${f.key}`).value = "0.50";

  renderCommandChecklist([]);

  // 수정 모드 종료 UI
  editingIndex = null;
  if (editBanner) editBanner.style.display = "none";
  if (applyEditBtn) {
    applyEditBtn.disabled = true;
    applyEditBtn.style.display = "none";
  }
  if (cancelEditBtn) {
    cancelEditBtn.disabled = true;
    cancelEditBtn.style.display = "none";
  }
}

// -------------------------------
// 캐릭터 목록 렌더(수정/삭제 버튼 포함)
// -------------------------------
function renderCharacters() {
  charList.innerHTML = "";

  characters.forEach((c, idx) => {
    const box = document.createElement("div");
    box.className = "char-entry";

    const cmds = (c.allowedCommands ?? []).length
      ? c.allowedCommands.join(", ")
      : "없음";

    box.innerHTML = `
      <div class="top">
        <b>#${idx + 1} ${escapeHtml(c.name)}</b>
        <div class="char-actions">
          <button class="btn-mini" data-edit="${idx}">수정</button>
          <button class="btn-mini btn-warn" data-del="${idx}">삭제</button>
        </div>
      </div>
      <div class="mini">${escapeHtml(c.gender)} · ${c.age}세</div>
      <div class="mini">스테이터스: 카 ${c.status.charisma} / 논 ${c.status.logic} / 연 ${c.status.acting} / 귀 ${c.status.charm} / 스 ${c.status.stealth} / 직 ${c.status.intuition}</div>
      <div class="mini">성격: 쾌 ${c.personality.cheer} / 사 ${c.personality.social} / 논 ${c.personality.logical} / 상 ${c.personality.kindness} / 욕 ${c.personality.desire} / 용 ${c.personality.courage}</div>
      <div class="mini">사용 커맨드(${(c.allowedCommands ?? []).length}): ${escapeHtml(cmds)}</div>
    `;

    charList.appendChild(box);
  });

  // 삭제
  charList.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.del);
      const nm = characters[idx]?.name ?? "해당 캐릭터";
      if (!confirm(`${nm} 을(를) 삭제할까?`)) return;

      if (editingIndex === idx) resetForm();
      characters.splice(idx, 1);

      addLogLine(`[삭제] ${nm}`);
      engine = null; // 캐릭터 바뀌면 게임 초기화
      updateRunButtonState();
      updateGnosiaMaxUI();
      renderCharacters();
      renderRelationIfPossible();
    });
  });

  // 수정 시작
  charList.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.edit);
      beginEdit(idx);
    });
  });

  updateRunButtonState();
  updateGnosiaMaxUI();
}

// -------------------------------
// 수정 모드
// -------------------------------
function beginEdit(index) {
  const c = characters[index];
  if (!c) return;

  editingIndex = index;

  elName.value = c.name ?? "";
  elGender.value = c.gender ?? "남성";
  elAge.value = String(c.age ?? 0);

  for (const f of STAT_FIELDS) {
    $(`stat_${f.key}`).value = String(clamp(c.status?.[f.key] ?? 0, f.min, f.max));
  }
  for (const f of PERS_FIELDS) {
    $(`per_${f.key}`).value = String(clamp(c.personality?.[f.key] ?? 0.5, f.min, f.max));
  }

  renderCommandChecklist(c.allowedCommands ?? []);

  // 수정 UI 표시
  if (editBanner) editBanner.style.display = "";
  if (applyEditBtn) {
    applyEditBtn.disabled = false;
    applyEditBtn.style.display = "";
  }
  if (cancelEditBtn) {
    cancelEditBtn.disabled = false;
    cancelEditBtn.style.display = "";
  }
}

function applyEdit() {
  if (editingIndex == null) return;
  const updated = readFormCharacterOrThrow();
  characters[editingIndex] = updated;

  addLogLine(`[수정] ${updated.name}`);
  engine = null; // 캐릭터 변경 시 게임 초기화
  renderCharacters();
  renderRelationIfPossible();
  resetForm();
}

// -------------------------------
// 실행 버튼 활성화 (5명 이상)
// -------------------------------
function updateRunButtonState() {
  runBtn.disabled = characters.length < 5;
}

// -------------------------------
// 게임 설정(그노시아 수 최대치) UI 업데이트
// -------------------------------
function computeMaxGnosia(n) {
  if (rolesApi?.getMaxGnosiaCount) return rolesApi.getMaxGnosiaCount(n);

  // 기획서 규칙(대체)
  if (n <= 6) return 1;
  if (n <= 8) return 2;
  if (n <= 10) return 3;
  if (n <= 12) return 4;
  if (n <= 14) return 5;
  return 6;
}

function updateGnosiaMaxUI() {
  if (!gnosiaCountEl) return;
  const n = characters.length;
  const mx = computeMaxGnosia(n);

  gnosiaCountEl.min = "1";
  gnosiaCountEl.max = String(mx);

  // 값이 범위 밖이면 보정
  const v = clamp(gnosiaCountEl.value ?? 1, 1, mx);
  gnosiaCountEl.value = String(Math.floor(v));
}

// -------------------------------
// 세이브/로드: "캐릭터 목록만" 저장
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
  download(
    "gnosia_characters.json",
    JSON.stringify({ characters }, null, 2)
  );
  addLogLine("[세이브] gnosia_characters.json 저장됨");
}

async function loadCharactersFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || !Array.isArray(data.characters)) {
    throw new Error("잘못된 파일 형식입니다. (characters 배열이 없음)");
  }

  // 검증 + 보정
  const loaded = data.characters
    .map((c) => ({
      name: String(c.name ?? "").trim(),
      gender: c.gender ?? "남성",
      age: clamp(parseInt(c.age ?? 0, 10), 0, 999),
      status: Object.fromEntries(
        STAT_FIELDS.map((f) => [f.key, roundTo(clamp(c.status?.[f.key] ?? 0, f.min, f.max), 1)])
      ),
      personality: Object.fromEntries(
        PERS_FIELDS.map((f) => [f.key, roundTo(clamp(c.personality?.[f.key] ?? 0.5, f.min, f.max), 2)])
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
// 게임 시작/진행
// - 클릭 1회 = 엔진 step 1회
// -------------------------------
function getGameSettings() {
  const n = characters.length;
  const maxG = computeMaxGnosia(n);

  const settings = {
    // 필수: 선원/그노시아는 항상 포함(엔진 내부에서 처리)
    enableEngineer: enableEngineerEl ? !!enableEngineerEl.checked : true,
    enableDoctor: enableDoctorEl ? !!enableDoctorEl.checked : true,
    enableGuardian: enableGuardianEl ? !!enableGuardianEl.checked : true,
    enableGuardDuty: enableGuardDutyEl ? !!enableGuardDutyEl.checked : true,
    enableAC: enableACEl ? !!enableACEl.checked : true,
    enableBug: enableBugEl ? !!enableBugEl.checked : true,
    gnosiaCount: gnosiaCountEl ? clamp(gnosiaCountEl.value ?? 1, 1, maxG) : 1,
  };

  // 혹시 roles.js가 defaultRoleSettings 같은걸 제공하면 병합
  if (rolesApi?.defaultRoleSettings) {
    return { ...rolesApi.defaultRoleSettings(n), ...settings };
  }

  return settings;
}

function startGameIfNeeded() {
  if (engine) return;

  const settings = getGameSettings();
  engine = new GameEngine(characters, settings);

  clearLog();

  // 시작 시 역할 공개(너가 원한 변경사항)
  if (engine.getPublicRoleLines) {
    engine.getPublicRoleLines().forEach(addLogLine);
  } else {
    // 엔진이 지원 안 하면 최소 안내
    addLogLine("[시작] 게임이 시작되었습니다.");
  }
}

function stepGame() {
  if (characters.length < 5) {
    alert("캐릭터가 최소 5명 이상이어야 실행할 수 있습니다.");
    return;
  }
  startGameIfNeeded();

  engine.step();

  // 엔진 로그 출력
  if (Array.isArray(engine.logs)) {
    while (engine.logs.length > 0) {
      addLogLine(engine.logs.shift());
    }
  }

  // 관계도 갱신
  renderRelationIfPossible();
}

function renderRelationIfPossible() {
  if (!relationBox) return;
  if (!relationApi?.renderRelation) return;
  if (!engine) {
    relationBox.innerHTML = `<div style="opacity:.8;">(게임 시작 후 관계도가 표시됩니다)</div>`;
    return;
  }
  relationApi.renderRelation(relationBox, engine);
}

// -------------------------------
// 이벤트 바인딩
// -------------------------------
addBtn.addEventListener("click", () => {
  try {
    const c = readFormCharacterOrThrow();
    characters.push(c);

    addLogLine(`[추가] ${c.name}`);
    engine = null; // 캐릭터 바뀌면 게임 초기화
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
      applyEdit();
    } catch (e) {
      alert(e?.message ?? String(e));
    }
  });
}
if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    resetForm();
  });
}

runBtn.addEventListener("click", () => {
  stepGame();
});

saveBtn.addEventListener("click", () => {
  try {
    saveCharacters();
  } catch (e) {
    alert(e?.message ?? String(e));
  }
});

loadBtn.addEventListener("click", async () => {
  try {
    if (!loadFile.files || loadFile.files.length === 0) {
      alert("로드할 파일(.json)을 선택해줘.");
      return;
    }
    await loadCharactersFromFile(loadFile.files[0]);
  } catch (e) {
    alert(e?.message ?? String(e));
  }
});

// 스탯 바뀌면 커맨드 가능 여부 즉시 갱신(체크 유지)
function bindLiveValidation() {
  for (const f of STAT_FIELDS) {
    const el = $(`stat_${f.key}`);
    el.addEventListener("input", () => {
      // 음수/50초과 즉시 보정
      el.value = String(clamp(el.value, f.min, f.max));
      refreshCommandAvailabilityKeepChecks();
    });
    el.addEventListener("blur", () => {
      el.value = String(roundTo(clamp(el.value, f.min, f.max), 1));
      refreshCommandAvailabilityKeepChecks();
    });
  }
  for (const f of PERS_FIELDS) {
    const el = $(`per_${f.key}`);
    el.addEventListener("input", () => {
      el.value = String(clamp(el.value, f.min, f.max));
    });
    el.addEventListener("blur", () => {
      el.value = String(roundTo(clamp(el.value, f.min, f.max), 2));
    });
  }
  if (elAge) {
    elAge.addEventListener("input", () => {
      elAge.value = String(clamp(elAge.value, 0, 999));
    });
    elAge.addEventListener("blur", () => {
      elAge.value = String(Math.floor(clamp(elAge.value, 0, 999)));
    });
  }

  if (gnosiaCountEl) {
    gnosiaCountEl.addEventListener("input", () => {
      updateGnosiaMaxUI();
    });
  }
}

// -------------------------------
// 초기 렌더
// -------------------------------
renderStatsInputs();
renderPersInputs();
renderCommandChecklist([]);
bindLiveValidation();
renderCharacters();
renderRelationIfPossible();

addLogLine("준비 완료. 캐릭터를 5명 이상 만들고 실행 버튼을 누르면 1턴씩 진행됩니다.");

// -------------------------------
// 작은 유틸들
// -------------------------------
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashName(name) {
  // DOM id 안전용
  return String(name).replace(/[^a-zA-Z0-9가-힣]/g, "_");
}

function statLabel(key) {
  const f = STAT_FIELDS.find((x) => x.key === key);
  return f ? f.label : key;
}
