// main.js (module)
// UI(탭 4개) + 캐릭터 생성/수정/삭제 + 커맨드 체크 + 게임설정 + 실행/로그 + 관계도 시각화 + save/load/log save

import {
  makeInitialState,
  clamp,
  addLog,
  computeMaxGnosiaCount,
  getChar,
  aliveChars,
} from "./js/dataStructures.js";

import { renderRelationsCanvas } from "./js/relationship.js";
import { startNewGame, runOneStep } from "./js/gameLoop.js";
import { saveRosterToFile, loadRosterFromFile, saveLogToFile } from "./js/storage.js";
import { COMMANDS, canUseCommand, CMD_CONTEXT } from "./js/commands.js";

// =========================
// 상태
// =========================
const state = makeInitialState();

// =========================
// DOM 헬퍼
// =========================
const $ = (id) => document.getElementById(id);

function setTab(tabId) {
  const tabs = ["tabRoster", "tabSettings", "tabRun", "tabGraph"];
  const pages = ["pageRoster", "pageSettings", "pageRun", "pageGraph"];
  for (const t of tabs) $(t).classList.toggle("active", t === tabId);
  for (const p of pages) $(p).classList.toggle("active", p === tabId.replace("tab", "page"));
}

// =========================
// 로그 렌더
// =========================
function renderLog() {
  const el = $("log");
  el.textContent = state.log.join("\n");
  el.scrollTop = el.scrollHeight;
}

// =========================
// 캐릭터 리스트 렌더
// =========================
function renderRosterList() {
  const ul = $("charList");
  ul.innerHTML = "";

  for (const c of state.chars) {
    const li = document.createElement("li");
    li.className = "charRow";

    const left = document.createElement("div");
    left.className = "charLeft";
    left.innerHTML = `
      <div class="charName">${escapeHtml(c.name)}</div>
      <div class="charMeta">${escapeHtml(c.gender)} · ${c.age}세</div>
      <div class="charTiny">스탯: C${c.stats.charisma} L${c.stats.logic} A${c.stats.acting} K${c.stats.charm} S${c.stats.stealth} I${c.stats.intuition}</div>
      <div class="charTiny">성격: 쾌${c.pers.cheer} 사${c.pers.social} 논${c.pers.logical} 상${c.pers.kind} 욕${c.pers.desire} 용${c.pers.courage}</div>
    `;

    const right = document.createElement("div");
    right.className = "charRight";

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "수정";
    btnEdit.onclick = () => openEditModal(c.id);

    const btnDel = document.createElement("button");
    btnDel.textContent = "삭제";
    btnDel.className = "danger";
    btnDel.onclick = () => deleteCharacter(c.id);

    right.append(btnEdit, btnDel);

    li.append(left, right);
    ul.appendChild(li);
  }

  updateRunButtonEnabled();
}

function updateRunButtonEnabled() {
  const runStart = $("btnStart");
  runStart.disabled = state.chars.length < 5 || state.chars.length > 15;
  $("rosterCount").textContent = `${state.chars.length}/15`;
}

// =========================
// 커맨드 체크박스 렌더(캐릭터 생성/수정에서 공통)
// =========================
function buildCommandCheckboxes(containerEl, tempCharLike) {
  containerEl.innerHTML = "";

  // 스탯 조건 충족 여부로 “선택 가능/불가”를 나누되,
  // “성향상 안 쓴다”는 유저가 체크로 판단 → 선택 가능한 것만 체크 제공
  const list = Object.values(COMMANDS);

  for (const cmd of list) {
    // 컨텍스트는 대다수 명단관리 판단용으로 ROUND_START 기준
    const can = canUseCommand(state, "__temp__", cmd.id, CMD_CONTEXT.ROUND_START, tempCharLike);

    const row = document.createElement("label");
    row.className = "cmdCheck";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = cmd.id;
    cb.disabled = !can.ok; // 스탯 조건 미달이면 유저가 체크 불가
    cb.checked = tempCharLike.allowedCommands?.has(cmd.id) && can.ok;

    const text = document.createElement("span");
    text.innerHTML = `<b>${escapeHtml(cmd.label)}</b><span class="cmdReq">(${escapeHtml(cmd.reqText || "조건 없음")})</span>`;

    row.append(cb, text);
    containerEl.appendChild(row);
  }
}

// =========================
// 입력값 파싱/검증
// =========================
function readNumber(id, { min, max, decimals = null }) {
  const v = Number($(id).value);
  let x = Number.isFinite(v) ? v : 0;
  x = clamp(x, min, max);
  if (decimals === 1) x = Math.round(x * 10) / 10;
  if (decimals === 2) x = Math.round(x * 100) / 100;
  return x;
}

function validateName(name) {
  const s = String(name || "").trim();
  if (!s) return { ok: false, msg: "이름을 입력해 주세요." };
  if (s.length > 20) return { ok: false, msg: "이름은 20자 이하로 해주세요." };
  return { ok: true, value: s };
}

// =========================
// 캐릭터 생성
// =========================
function makeCharFromForm(prefix = "") {
  // prefix: ""(생성) or "edit_"(수정 모달)
  const nameId = prefix + "name";
  const genderId = prefix + "gender";
  const ageId = prefix + "age";

  const nameCheck = validateName($(nameId).value);
  if (!nameCheck.ok) return { ok: false, msg: nameCheck.msg };

  const gender = $(genderId).value;
  const age = readNumber(ageId, { min: 0, max: 200, decimals: null }); // 음수 금지

  const stats = {
    charisma: readNumber(prefix + "charisma", { min: 0, max: 50, decimals: 1 }),
    logic: readNumber(prefix + "logic", { min: 0, max: 50, decimals: 1 }),
    acting: readNumber(prefix + "acting", { min: 0, max: 50, decimals: 1 }),
    charm: readNumber(prefix + "charm", { min: 0, max: 50, decimals: 1 }),
    stealth: readNumber(prefix + "stealth", { min: 0, max: 50, decimals: 1 }),
    intuition: readNumber(prefix + "intuition", { min: 0, max: 50, decimals: 1 }),
  };

  const pers = {
    cheer: readNumber(prefix + "cheer", { min: 0, max: 1, decimals: 2 }),
    social: readNumber(prefix + "social", { min: 0, max: 1, decimals: 2 }),
    logical: readNumber(prefix + "logical", { min: 0, max: 1, decimals: 2 }),
    kind: readNumber(prefix + "kindness", { min: 0, max: 1, decimals: 2 }),
    desire: readNumber(prefix + "desire", { min: 0, max: 1, decimals: 2 }),
    courage: readNumber(prefix + "courage", { min: 0, max: 1, decimals: 2 }),
  };

  return { ok: true, value: { name: nameCheck.value, gender, age, stats, pers } };
}

function addCharacter() {
  if (state.chars.length >= 15) {
    addLog(state, "캐릭터 최대 인원은 15명입니다.");
    renderLog();
    return;
  }

  const parsed = makeCharFromForm("");
  if (!parsed.ok) {
    alert(parsed.msg);
    return;
  }

  // 임시 캐릭터 객체(커맨드 체크 반영)
  const temp = {
    ...parsed.value,
    allowedCommands: new Set(),
    alive: true,
    role: null,
    claimedRole: null,
    hate: 0,
    coop: null,
    dailyFlags: {},
  };

  // 커맨드 체크 읽기(스탯 조건 충족된 것만 체크 가능)
  const cmdWrap = $("cmdChoices");
  const checked = cmdWrap.querySelectorAll("input[type=checkbox]:checked");
  for (const cb of checked) temp.allowedCommands.add(cb.value);

  // state에 추가
  state.chars.push({
    id: cryptoId(),
    ...temp,
  });

  // 관계도/로그 초기화는 “게임 시작”에서 하므로 여기선 명단만 갱신
  renderRosterList();
  addLog(state, `${temp.name} 캐릭터를 추가했습니다.`);
  renderLog();
}

// =========================
// 캐릭터 삭제/수정
// =========================
function deleteCharacter(id) {
  const c = getChar(state, id);
  if (!c) return;
  if (!confirm(`정말 '${c.name}'을(를) 삭제할까요?`)) return;

  state.chars = state.chars.filter(x => x.id !== id);
  addLog(state, `${c.name} 캐릭터를 삭제했습니다.`);
  renderRosterList();
  renderLog();
}

// ----- 수정 모달 -----
let editingId = null;

function openEditModal(id) {
  const c = getChar(state, id);
  if (!c) return;
  editingId = id;

  $("editModal").classList.add("open");
  $("edit_name").value = c.name;
  $("edit_gender").value = c.gender;
  $("edit_age").value = c.age;

  $("edit_charisma").value = c.stats.charisma;
  $("edit_logic").value = c.stats.logic;
  $("edit_acting").value = c.stats.acting;
  $("edit_charm").value = c.stats.charm;
  $("edit_stealth").value = c.stats.stealth;
  $("edit_intuition").value = c.stats.intuition;

  $("edit_cheer").value = c.pers.cheer;
  $("edit_social").value = c.pers.social;
  $("edit_logical").value = c.pers.logical;
  $("edit_kindness").value = c.pers.kind;
  $("edit_desire").value = c.pers.desire;
  $("edit_courage").value = c.pers.courage;

  // 스탯/성격 기반으로 체크박스 재구성 + 기존 체크 반영
  const tempCharLike = {
    stats: { ...c.stats },
    pers: { ...c.pers },
    allowedCommands: new Set(c.allowedCommands || []),
  };
  buildCommandCheckboxes($("edit_cmdChoices"), tempCharLike);
}

function closeEditModal() {
  $("editModal").classList.remove("open");
  editingId = null;
}

function applyEditModal() {
  if (!editingId) return;
  const c = getChar(state, editingId);
  if (!c) return;

  const parsed = makeCharFromForm("edit_");
  if (!parsed.ok) {
    alert(parsed.msg);
    return;
  }

  c.name = parsed.value.name;
  c.gender = parsed.value.gender;
  c.age = parsed.value.age;
  c.stats = parsed.value.stats;
  c.pers = parsed.value.pers;

  // 커맨드 체크
  const set = new Set();
  const checked = $("edit_cmdChoices").querySelectorAll("input[type=checkbox]:checked");
  for (const cb of checked) set.add(cb.value);
  c.allowedCommands = set;

  addLog(state, `${c.name} 캐릭터를 수정했습니다.`);
  renderRosterList();
  renderLog();
  closeEditModal();
}

// =========================
// 게임 설정 UI
// =========================
function bindSettingsUI() {
  const updateGmax = () => {
    const n = state.chars.length;
    const maxG = computeMaxGnosiaCount(n || 5);
    $("gnosiaMax").textContent = String(maxG);
    $("gnosiaCount").max = String(maxG);
    if (Number($("gnosiaCount").value) > maxG) $("gnosiaCount").value = String(maxG);
    state.settings.gnosiaCount = clamp(Number($("gnosiaCount").value) || 1, 1, maxG);
  };

  $("gnosiaCount").addEventListener("input", () => {
    updateGmax();
  });

  const map = [
    ["roleEngineer", "engineer"],
    ["roleDoctor", "doctor"],
    ["roleGuardian", "guardian"],
    ["roleCrew", "crew"],
    ["roleAC", "ac"],
    ["roleBug", "bug"],
  ];

  for (const [id, key] of map) {
    $(id).addEventListener("change", () => {
      state.settings.rolesEnabled[key] = $(id).checked;
    });
  }

  updateGmax();
}

function refreshGnosiaMaxNow() {
  const n = state.chars.length;
  const maxG = computeMaxGnosiaCount(n || 5);
  $("gnosiaMax").textContent = String(maxG);
  $("gnosiaCount").max = String(maxG);
  state.settings.gnosiaCount = clamp(Number($("gnosiaCount").value) || 1, 1, maxG);
}

// =========================
// 실행/관계도 렌더
// =========================
function renderGraph() {
  const canvas = $("relCanvas");
  renderRelationsCanvas(state, canvas);
}

// =========================
// 세이브/로드/로그 저장
// =========================
function bindStorageUI() {
  $("btnSaveRoster").onclick = () => saveRosterToFile(state);

  $("fileLoadRoster").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadRosterFromFile(state, file);
    // 로드 후 UI/설정 갱신
    renderRosterList();
    refreshGnosiaMaxNow();
    renderGraph();
    renderLog();
    e.target.value = "";
  });

  $("btnSaveLog").onclick = () => {
    saveLogToFile(state);
    renderLog();
  };
}

// =========================
// 실행 버튼 연결
// =========================
function bindRunUI() {
  $("btnStart").onclick = () => {
    // 새 게임 시작
    state.log = [];
    addLog(state, "게임을 시작합니다.");
    const ok = startNewGame(state);
    renderLog();
    if (ok) {
      $("btnStep").disabled = false;
      renderGraph();
    }
  };

  $("btnStep").onclick = () => {
    runOneStep(state);
    renderLog();
    renderGraph();
  };
}

// =========================
// 캐릭터 생성 UI(커맨드 체크 자동 리프레시)
// =========================
function bindRosterUI() {
  // 입력 변화 시 “스탯 조건 충족 커맨드만 체크 가능”을 즉시 갱신
  const refresh = () => {
    const parsed = makeCharFromForm("");
    const tempCharLike = parsed.ok
      ? { stats: parsed.value.stats, pers: parsed.value.pers, allowedCommands: new Set(getCheckedCmds("cmdChoices")) }
      : { stats: safeStatsFromInputs(""), pers: safePersFromInputs(""), allowedCommands: new Set(getCheckedCmds("cmdChoices")) };

    buildCommandCheckboxes($("cmdChoices"), tempCharLike);
  };

  // 생성 영역 입력들 바인드
  const ids = [
    "name", "gender", "age",
    "charisma", "logic", "acting", "charm", "stealth", "intuition",
    "cheer", "social", "logical", "kindness", "desire", "courage",
  ];

  for (const id of ids) {
    $(id).addEventListener("input", refresh);
    $(id).addEventListener("change", refresh);
  }

  $("btnAdd").onclick = addCharacter;

  // 초기 커맨드 체크 렌더
  refresh();
}

function getCheckedCmds(containerId) {
  const wrap = $(containerId);
  const checked = wrap.querySelectorAll("input[type=checkbox]:checked");
  return [...checked].map(x => x.value);
}

function safeStatsFromInputs(prefix) {
  return {
    charisma: readNumber(prefix + "charisma", { min: 0, max: 50, decimals: 1 }),
    logic: readNumber(prefix + "logic", { min: 0, max: 50, decimals: 1 }),
    acting: readNumber(prefix + "acting", { min: 0, max: 50, decimals: 1 }),
    charm: readNumber(prefix + "charm", { min: 0, max: 50, decimals: 1 }),
    stealth: readNumber(prefix + "stealth", { min: 0, max: 50, decimals: 1 }),
    intuition: readNumber(prefix + "intuition", { min: 0, max: 50, decimals: 1 }),
  };
}

function safePersFromInputs(prefix) {
  return {
    cheer: readNumber(prefix + "cheer", { min: 0, max: 1, decimals: 2 }),
    social: readNumber(prefix + "social", { min: 0, max: 1, decimals: 2 }),
    logical: readNumber(prefix + "logical", { min: 0, max: 1, decimals: 2 }),
    kind: readNumber(prefix + "kindness", { min: 0, max: 1, decimals: 2 }),
    desire: readNumber(prefix + "desire", { min: 0, max: 1, decimals: 2 }),
    courage: readNumber(prefix + "courage", { min: 0, max: 1, decimals: 2 }),
  };
}

// =========================
// 탭/모달 연결
// =========================
function bindTabs() {
  $("tabRoster").onclick = () => setTab("tabRoster");
  $("tabSettings").onclick = () => setTab("tabSettings");
  $("tabRun").onclick = () => setTab("tabRun");
  $("tabGraph").onclick = () => setTab("tabGraph");
}

// =========================
// 초기화
// =========================
function init() {
  bindTabs();

  bindRosterUI();
  bindSettingsUI();
  bindStorageUI();
  bindRunUI();

  // 수정 모달
  $("btnEditClose").onclick = closeEditModal;
  $("btnEditCancel").onclick = closeEditModal;
  $("btnEditApply").onclick = applyEditModal;

  // 초기 화면
  setTab("tabRoster");
  renderRosterList();
  renderLog();
  renderGraph();

  // 실행 버튼 초기 비활성
  $("btnStep").disabled = true;
}

init();

// =========================
// 작은 유틸
// =========================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

function cryptoId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
