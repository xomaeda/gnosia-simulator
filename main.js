// main.js (type="module")
// =======================================================
// UI 동작 완전 고정판
// - 스탯(0~50) / 성격(0~1) 입력 UI 생성
// - 커맨드 체크리스트 생성 + 스탯 미달이면 체크 불가(회색)
// - 캐릭터 추가/수정/삭제
// - 캐릭터 세이브/로드(JSON)
// - 실행 버튼: 캐릭터 5명 이상부터 활성화 + 1회 클릭 = 1스텝 로그 출력
// - 로그 저장(.txt 다운로드)
// =======================================================

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

const logSaveBtn = $("logSaveBtn");
const charList = $("charList");
const logBox = $("log");

const editBanner = $("editBanner");
const applyEditBtn = $("applyEditBtn");
const cancelEditBtn = $("cancelEditBtn");

// 게임 설정 UI (현재 단계에서는 값만 보관해둠)
const setEngineer = $("setEngineer");
const setDoctor = $("setDoctor");
const setGuardian = $("setGuardian");
const setGuardDuty = $("setGuardDuty");
const setAC = $("setAC");
const setBug = $("setBug");
const gnosiaCount = $("gnosiaCount");

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

// 성격: 0.00 ~ 1.00
const PERS_FIELDS = [
  { key: "cheer", label: "쾌활함" },
  { key: "social", label: "사회성" },
  { key: "logical", label: "논리성향" },
  { key: "kindness", label: "상냥함" },
  { key: "desire", label: "욕망" },
  { key: "courage", label: "용기" },
];

// -------------------------------
// 커맨드 목록 + 요구 스테이터스 (기획서 기준)
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

  // 네가 추가한 밤 행동 커맨드 (조건 없음)
  { name: "밤:협력요청", req: [] },
];

// -------------------------------
// 상태
// -------------------------------
let characters = [];      // 캐릭터 목록
let editingIndex = null;  // 수정 중 캐릭터 index

// 진행 스텝(현재는 UI 테스트용 로그만)
let stepCounter = 0;

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

function buildReqText(req) {
  if (!req || req.length === 0) return "조건 없음";
  return req
    .map(([k, v]) => {
      const label = STAT_FIELDS.find((s) => s.key === k)?.label ?? k;
      return `${label} ${v}+`;
    })
    .join(", ");
}

function statusMeetsReq(status, req) {
  return (req ?? []).every(([k, min]) => (status[k] ?? 0) >= min);
}

// -------------------------------
// 입력 UI 생성
// -------------------------------
function renderStatsInputs() {
  statsGrid.innerHTML = "";
  for (const f of STAT_FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "kv";

    const k = document.createElement("div");
    k.className = "k";
    k.textContent = f.label;

    const input = document.createElement("input");
    input.id = `stat_${f.key}`;
    input.type = "number";
    input.min = "0";
    input.max = "50";
    input.step = "0.1";
    input.value = "0";

    input.addEventListener("input", () => {
      // 즉시 보정: 음수/50초과 금지
      input.value = String(clamp(toFloat(input.value, 0), 0, 50));
      renderCommandChecklist();
    });

    wrap.appendChild(k);
    wrap.appendChild(input);
    statsGrid.appendChild(wrap);
  }
}

function renderPersonalityInputs() {
  persGrid.innerHTML = "";
  for (const f of PERS_FIELDS) {
    const wrap = document.createElement("div");
    wrap.className = "kv";

    const k = document.createElement("div");
    k.className = "k";
    k.textContent = f.label;

    const input = document.createElement("input");
    input.id = `per_${f.key}`;
    input.type = "number";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = "0";

    input.addEventListener("input", () => {
      input.value = String(clamp(toFloat(input.value, 0), 0, 1));
    });

    wrap.appendChild(k);
    wrap.appendChild(input);
    persGrid.appendChild(wrap);
  }
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

// -------------------------------
// 커맨드 체크리스트
// - 스탯 미달이면 체크 불가(회색)
// - 유저가 성향상 안 쓰게 하고 싶은 건 체크 해제
// -------------------------------
function renderCommandChecklist(selected = null) {
  const status = currentStatus();
  commandList.innerHTML = "";

  for (const cmd of COMMAND_DEFS) {
    const ok = statusMeetsReq(status, cmd.req);
    const row = document.createElement("label");
    row.className = "cmd" + (ok ? "" : " disabled");

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.dataset.cmd = cmd.name;
    chk.disabled = !ok;

    const isChecked = selected ? !!selected.has(cmd.name) : ok; // 기본: 조건 만족하면 체크됨
    chk.checked = ok ? isChecked : false;

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = cmd.name;

    const req = document.createElement("div");
    req.className = "req";
    req.textContent = buildReqText(cmd.req);

    row.appendChild(chk);
    row.appendChild(name);
    row.appendChild(req);
    commandList.appendChild(row);
  }
}

function getSelectedCommands() {
  const arr = [];
  commandList.querySelectorAll("input[type=checkbox]").forEach((chk) => {
    if (chk.checked && !chk.disabled) arr.push(chk.dataset.cmd);
  });
  return arr;
}

// -------------------------------
// 캐릭터 생성/수정
// -------------------------------
function validateName(name) {
  if (!name || !name.trim()) return "이름을 입력하세요.";
  if (name.trim().length > 20) return "이름이 너무 깁니다. (20자 이하)";
  return null;
}

function readCharacterFromForm() {
  const name = elName.value.trim();
  const err = validateName(name);
  if (err) {
    alert(err);
    return null;
  }

  const gender = elGender.value;
  const age = toIntNonNeg(elAge.value, 0); // 음수 금지

  const stats = currentStatus();
  // 소수 1자리로 정리
  for (const k of Object.keys(stats)) stats[k] = Math.round(stats[k] * 10) / 10;

  const pers = currentPersonality();
  // 성격은 0.00~1.00, 소수 2자리 권장
  for (const k of Object.keys(pers)) pers[k] = Math.round(pers[k] * 100) / 100;

  const allowedCommands = getSelectedCommands();

  return {
    name,
    gender,
    age,
    stats,
    pers,
    allowedCommands,
  };
}

function resetForm() {
  elName.value = "";
  elGender.value = "남성";
  elAge.value = "0";

  for (const f of STAT_FIELDS) $(`stat_${f.key}`).value = "0";
  for (const f of PERS_FIELDS) $(`per_${f.key}`).value = "0";

  renderCommandChecklist(); // 기본 체크 복원
}

function enterEditMode(index) {
  editingIndex = index;
  const c = characters[index];
  if (!c) return;

  editBanner.style.display = "";
  applyEditBtn.disabled = false;
  cancelEditBtn.disabled = false;
  addBtn.disabled = true;

  elName.value = c.name;
  elGender.value = c.gender;
  elAge.value = String(c.age);

  for (const f of STAT_FIELDS) $(`stat_${f.key}`).value = String(c.stats?.[f.key] ?? 0);
  for (const f of PERS_FIELDS) $(`per_${f.key}`).value = String(c.pers?.[f.key] ?? 0);

  const set = new Set(c.allowedCommands ?? []);
  renderCommandChecklist(set);

  addLogLine(`[수정모드] ${c.name} 수정 중…`);
}

function exitEditMode(silent = false) {
  editingIndex = null;
  editBanner.style.display = "none";
  applyEditBtn.disabled = true;
  cancelEditBtn.disabled = true;
  addBtn.disabled = false;

  if (!silent) addLogLine(`[수정모드] 종료`);
  resetForm();
}

function updateRunAvailability() {
  runBtn.disabled = characters.length < 5;
}

// -------------------------------
// 캐릭터 목록 렌더
// -------------------------------
function renderCharacters() {
  charList.innerHTML = "";

  characters.forEach((c, idx) => {
    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.innerHTML = `
      <div><b>#${idx + 1} ${escapeHtml(c.name)}</b> <span style="color:#a6a6b3;">(${escapeHtml(c.gender)}, ${c.age})</span></div>
      <div style="color:#a6a6b3; font-size:12px; margin-top:4px;">
        커맨드 ${c.allowedCommands?.length ?? 0}개
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "수정";
    edit.addEventListener("click", () => enterEditMode(idx));

    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "삭제";
    del.addEventListener("click", () => {
      const ok = confirm(`${c.name} 을(를) 삭제할까?`);
      if (!ok) return;

      // 편집중 캐릭터를 지우면 편집모드 종료
      if (editingIndex === idx) exitEditMode(true);

      characters.splice(idx, 1);
      addLogLine(`[삭제] ${c.name}`);
      renderCharacters();
      updateRunAvailability();
    });

    actions.appendChild(edit);
    actions.appendChild(del);

    row.appendChild(left);
    row.appendChild(actions);
    charList.appendChild(row);
  });

  updateRunAvailability();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// -------------------------------
// 세이브 / 로드
// (요구사항: 캐릭터 목록만 저장 = 이름/성별/나이/스탯/성격/허용커맨드)
// -------------------------------
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(filename, obj) {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function saveCharacters() {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    characters,
  };
  downloadJson("gnosia_characters.json", payload);
  addLogLine("[세이브] 캐릭터 목록 저장 완료");
}

async function loadCharactersFromFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    alert("JSON 파일이 아니야.");
    return;
  }

  if (!data || !Array.isArray(data.characters)) {
    alert("형식이 올바르지 않은 세이브 파일이야.");
    return;
  }

  // 최소 검증 + 정규화
  const loaded = [];
  for (const raw of data.characters) {
    if (!raw?.name) continue;

    const c = {
      name: String(raw.name),
      gender: raw.gender === "여성" || raw.gender === "범성" ? raw.gender : "남성",
      age: toIntNonNeg(raw.age, 0),
      stats: {},
      pers: {},
      allowedCommands: Array.isArray(raw.allowedCommands) ? raw.allowedCommands.map(String) : [],
    };

    for (const f of STAT_FIELDS) {
      c.stats[f.key] = clamp(toFloat(raw.stats?.[f.key] ?? 0), 0, 50);
      c.stats[f.key] = Math.round(c.stats[f.key] * 10) / 10;
    }
    for (const f of PERS_FIELDS) {
      c.pers[f.key] = clamp(toFloat(raw.pers?.[f.key] ?? 0), 0, 1);
      c.pers[f.key] = Math.round(c.pers[f.key] * 100) / 100;
    }

    loaded.push(c);
  }

  characters = loaded;
  exitEditMode(true);
  renderCharacters();
  addLogLine(`[로드] ${characters.length}명 불러옴`);
}

// -------------------------------
// 로그 저장
// -------------------------------
function saveLogText() {
  const lines = Array.from(logBox.querySelectorAll("div")).map((d) => d.textContent);
  const text = lines.join("\n");
  downloadText("gnosia_log.txt", text || "(비어있음)");
}

// -------------------------------
// 실행(1스텝) - 지금 단계는 “빈 로그” 방지용
// 다음 단계에서 엔진(역할/커맨드/밤/낮)을 여기에 연결할 것.
// -------------------------------
function getGameSettings() {
  return {
    engineer: !!setEngineer?.checked,
    doctor: !!setDoctor?.checked,
    guardian: !!setGuardian?.checked,
    guardDuty: !!setGuardDuty?.checked,
    ac: !!setAC?.checked,
    bug: !!setBug?.checked,
    gnosiaCount: clamp(toIntNonNeg(gnosiaCount?.value ?? 1, 1), 1, 6),
  };
}

function stepGame() {
  if (characters.length < 5) {
    addLogLine("캐릭터가 5명 이상이어야 실행할 수 있어.");
    return;
  }

  stepCounter += 1;
  const s = getGameSettings();

  // 지금 단계에서는 "실행 버튼 눌러도 아무 로그도 안 뜬다" 문제만 확실히 해결
  addLogLine(
    `[실행 ${stepCounter}] (UI 테스트 스텝) 캐릭터 ${characters.length}명 / 그노시아 ${s.gnosiaCount} / 역할: 엔지 ${onoff(s.engineer)}, 닥터 ${onoff(s.doctor)}, 수호 ${onoff(s.guardian)}, 대기인 ${onoff(s.guardDuty)}, AC ${onoff(s.ac)}, 버그 ${onoff(s.bug)}`
  );
}

function onoff(v) {
  return v ? "ON" : "OFF";
}

// -------------------------------
// 이벤트 바인딩
// -------------------------------
addBtn.addEventListener("click", () => {
  const c = readCharacterFromForm();
  if (!c) return;

  // 중복 이름 방지(선택)
  if (characters.some((x) => x.name === c.name)) {
    if (!confirm("같은 이름이 이미 있어. 그래도 추가할까?")) return;
  }

  characters.push(c);
  addLogLine(`[추가] ${c.name}`);
  renderCharacters();
  resetForm();
});

applyEditBtn.addEventListener("click", () => {
  if (editingIndex === null) return;
  const c = readCharacterFromForm();
  if (!c) return;

  const oldName = characters[editingIndex]?.name ?? "(unknown)";
  characters[editingIndex] = c;
  addLogLine(`[수정] ${oldName} → ${c.name}`);
  renderCharacters();
  exitEditMode(true);
});

cancelEditBtn.addEventListener("click", () => {
  exitEditMode(false);
});

runBtn.addEventListener("click", () => {
  stepGame();
});

saveBtn.addEventListener("click", () => {
  saveCharacters();
});

loadBtn.addEventListener("click", async () => {
  const file = loadFile.files?.[0];
  if (!file) {
    alert("로드할 JSON 파일을 선택해줘.");
    return;
  }
  await loadCharactersFromFile(file);
});

logSaveBtn?.addEventListener("click", () => {
  saveLogText();
});

// 그노시아 수 입력 보정(1~6)
gnosiaCount?.addEventListener("input", () => {
  gnosiaCount.value = String(clamp(toIntNonNeg(gnosiaCount.value, 1), 1, 6));
});

// -------------------------------
// 초기 렌더
// -------------------------------
renderStatsInputs();
renderPersonalityInputs();
renderCommandChecklist(); // 기본 체크(조건 충족이면 체크)
renderCharacters();

clearLog();
addLogLine("준비 완료. 캐릭터를 5명 이상 추가하면 실행 버튼이 활성화돼.");
addLogLine("※ 현재 단계는 UI 고정 단계. 다음 단계에서 '완성 엔진(역할/커맨드/낮5턴/밤2단계/관계도)'를 연결할 거야.");
