// js/storage.js
// 캐릭터 목록 Save/Load(JSON) + 로그 Save(TXT)

import { addLog } from "./dataStructures.js";

// ===== 파일 다운로드 유틸 =====
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

function downloadJSON(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// ===== 캐릭터 세이브/로드 스키마 =====
// state.chars: [ { id, name, gender, age, stats, pers, allowedCommands:Set, alive, ... } ]
// 저장은 "명단 관리" 정보만: alive/role/관계도/어그로 등은 저장하지 않음.

export function saveRosterToFile(state) {
  const roster = state.chars.map(c => ({
    name: c.name,
    gender: c.gender,
    age: c.age,
    stats: { ...c.stats }, // charisma, logic, acting, charm, stealth, intuition
    pers: { ...c.pers },   // cheer, social, logical, kind, desire, courage (0~1)
    allowedCommands: Array.from(c.allowedCommands || []),
  }));

  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    roster,
  };

  downloadJSON("gnosia_roster.json", payload);
  addLog(state, "캐릭터 목록을 저장했습니다(gnosia_roster.json).");
}

export async function loadRosterFromFile(state, file) {
  if (!file) return false;

  let text;
  try {
    text = await file.text();
  } catch {
    addLog(state, "로드 실패: 파일을 읽을 수 없습니다.");
    return false;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    addLog(state, "로드 실패: JSON 형식이 아닙니다.");
    return false;
  }

  if (!data || !Array.isArray(data.roster)) {
    addLog(state, "로드 실패: roster 데이터가 없습니다.");
    return false;
  }

  // 기존 캐릭터 전부 교체(요청: 로드한 목록을 그대로 사용)
  state.chars = data.roster.map((r, idx) => ({
    id: `c_${Date.now()}_${idx}_${Math.random().toString(16).slice(2)}`,
    name: String(r.name || "").trim() || `무명${idx + 1}`,
    gender: r.gender === "남성" || r.gender === "여성" || r.gender === "범성" ? r.gender : "범성",
    age: Number.isFinite(Number(r.age)) ? Number(r.age) : 0,
    stats: normalizeStats(r.stats),
    pers: normalizePers(r.pers),
    allowedCommands: new Set(Array.isArray(r.allowedCommands) ? r.allowedCommands : []),

    // 런타임 필드(로드 시 초기화)
    alive: true,
    role: null,
    claimedRole: null,
    hate: 0,
    coop: null,
    dailyFlags: {},
  }));

  addLog(state, `캐릭터 목록을 불러왔습니다. (${state.chars.length}명)`);
  return true;
}

// ===== 로그 저장 =====
export function saveLogToFile(state) {
  const lines = (state.log || []).join("\n");
  downloadText("gnosia_log.txt", lines || "(빈 로그)");
  addLog(state, "로그를 저장했습니다(gnosia_log.txt).");
}

// ===== 정규화(유효 범위 맞추기) =====
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// 스탯: 0~50, 소수 1자리 허용
function normalizeStats(stats) {
  const s = stats || {};
  const fix = (x) => {
    let v = Number(x);
    if (!Number.isFinite(v)) v = 0;
    v = clamp(v, 0, 50);
    // 소수 1자리로 정리(기획서)
    v = Math.round(v * 10) / 10;
    return v;
  };
  return {
    charisma: fix(s.charisma),
    logic: fix(s.logic),
    acting: fix(s.acting),
    charm: fix(s.charm),
    stealth: fix(s.stealth),
    intuition: fix(s.intuition),
  };
}

// 성격: 0.00~1.00
function normalizePers(pers) {
  const p = pers || {};
  const fix = (x) => {
    let v = Number(x);
    if (!Number.isFinite(v)) v = 0;
    v = clamp(v, 0, 1);
    // 소수 2자리
    v = Math.round(v * 100) / 100;
    return v;
  };
  return {
    cheer: fix(p.cheer),
    social: fix(p.social),
    logical: fix(p.logical),
    kind: fix(p.kind),
    desire: fix(p.desire),
    courage: fix(p.courage),
  };
}
