// js/ui.js
import { createCharacter, addLog } from "./dataStructures.js";
import { getAllCommands } from "./commands.js";
import { saveRosterToFile, loadRosterFromFile, saveLogToFile } from "./storage.js";
import { renderRelationshipGraph } from "./relationship.js";

const $ = (id) => document.getElementById(id);

function safeEl(id, state) {
  const el = $(id);
  if (!el) {
    if (state) addLog(state, `UI 오류: #${id} 요소를 찾지 못했습니다. (index.html id 확인 필요)`);
  }
  return el;
}

// ======================
// 커맨드 체크 UI (가장 중요)
// ======================
export function renderCommandChecklist(state) {
  const box = safeEl("command-box", state);
  if (!box) return;

  let cmds = [];
  try {
    cmds = getAllCommands();
  } catch (e) {
    box.innerHTML =
      "<div style='color:#a8b0c0;font-size:12px;line-height:1.4'>커맨드 목록을 불러오지 못했습니다.<br/>원인: commands.js 로드/경로 오류 가능</div>";
    if (state) addLog(state, `commands.js 오류: ${e?.message || e}`);
    return;
  }

  if (!Array.isArray(cmds) || cmds.length === 0) {
    box.innerHTML =
      "<div style='color:#a8b0c0;font-size:12px;line-height:1.4'>커맨드가 0개입니다.<br/>commands.js에서 getAllCommands()가 목록을 반환하는지 확인하세요.</div>";
    if (state) addLog(state, "커맨드 로딩 실패: getAllCommands()가 빈 배열을 반환했습니다.");
    return;
  }

  box.innerHTML = "";
  for (const cmd of cmds) {
    const wrap = document.createElement("label");
    wrap.className = "command-check";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = cmd.id;

    const label = document.createElement("span");
    label.textContent = cmd.name;

    wrap.append(cb, label);
    box.appendChild(wrap);
  }
}

// ======================
// 캐릭터 생성/목록
// ======================
export function initCharacterUI(state) {
  const form = safeEl("char-form", state);
  if (!form) return;

  form.onsubmit = (e) => {
    e.preventDefault();

    const char = createCharacter({
      name: safeEl("name", state)?.value?.trim(),
      gender: safeEl("gender", state)?.value,
      age: Number(safeEl("age", state)?.value),

      stats: {
        charisma: Number(safeEl("charisma", state)?.value),
        logic: Number(safeEl("logic", state)?.value),
        acting: Number(safeEl("acting", state)?.value),
        charm: Number(safeEl("charm", state)?.value),
        stealth: Number(safeEl("stealth", state)?.value),
        intuition: Number(safeEl("intuition", state)?.value),
      },

      pers: {
        cheer: Number(safeEl("cheer", state)?.value),
        social: Number(safeEl("social", state)?.value),
        logical: Number(safeEl("logical", state)?.value),
        kind: Number(safeEl("kindness", state)?.value),
        desire: Number(safeEl("desire", state)?.value),
        courage: Number(safeEl("courage", state)?.value),
      },

      allowedCommands: getCheckedCommands(),
    });

    state.chars.push(char);
    addLog(state, `캐릭터 추가: ${char.name}`);
    renderCharacterList(state);
    updateRunButton(state);
    form.reset();
  };

  // 저장/로드/로그 저장 버튼 연결
  safeEl("save-roster", state).onclick = () => saveRosterToFile(state);

  const loadInput = safeEl("load-roster", state);
  if (loadInput) {
    loadInput.onchange = async (e) => {
      await loadRosterFromFile(state, e.target.files[0]);
      renderCharacterList(state);
      updateRunButton(state);
    };
  }

  safeEl("save-log", state).onclick = () => saveLogToFile(state);
}

function getCheckedCommands() {
  const checked = new Set();
  document
    .querySelectorAll(".command-check input:checked")
    .forEach((c) => checked.add(c.value));
  return checked;
}

export function renderCharacterList(state) {
  const ul = safeEl("char-list", state);
  if (!ul) return;
  ul.innerHTML = "";

  state.chars.forEach((c, idx) => {
    const li = document.createElement("li");
    li.textContent = `${idx + 1}. ${c.name} (${c.gender}, ${c.age})`;
    ul.appendChild(li);
  });
}

// ======================
// 게임 설정
// ======================
export function initGameSettingUI(state) {
  const roles = ["engineer", "doctor", "guardian", "standby", "ac", "bug"];
  for (const r of roles) {
    const cb = safeEl(`role-${r}`, state);
    if (cb) cb.onchange = () => (state.settings.roles[r] = cb.checked);
  }
  const g = safeEl("gnosia-count", state);
  if (g) g.oninput = (e) => (state.settings.gnosiaCount = Number(e.target.value));
}

// ======================
// 실행 버튼 상태
// ======================
export function updateRunButton(state) {
  const btn = safeEl("run-btn", state);
  if (!btn) return;
  btn.disabled = state.chars.length < 5;
}

// ======================
// 관계도 렌더 호출(필요 시 사용)
// ======================
export function renderRelationUI(state) {
  const canvas = safeEl("relation-canvas", state);
  if (!canvas) return;
  renderRelationshipGraph(state, canvas);
}
