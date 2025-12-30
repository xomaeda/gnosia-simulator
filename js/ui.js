// js/ui.js
// UI 전담: 캐릭터 생성/목록, 게임 설정, 실행 버튼, 관계도 시각화

import {
  createCharacter,
  addLog,
} from "./dataStructures.js";

import { getAllCommands } from "./commands.js";
import { saveRosterToFile, loadRosterFromFile, saveLogToFile } from "./storage.js";
import { renderRelationshipGraph } from "./relationship.js";

// ======================
// DOM 헬퍼
// ======================
const $ = (id) => document.getElementById(id);

function labeledInput(label, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  wrap.appendChild(l);
  wrap.appendChild(inputEl);
  return wrap;
}

// ======================
// 캐릭터 생성 UI
// ======================
export function initCharacterUI(state) {
  const form = $("char-form");
  const list = $("char-list");

  form.onsubmit = (e) => {
    e.preventDefault();

    const char = createCharacter({
      name: $("name").value.trim(),
      gender: $("gender").value,
      age: Number($("age").value),

      stats: {
        charisma: Number($("charisma").value),
        logic: Number($("logic").value),
        acting: Number($("acting").value),
        charm: Number($("charm").value),
        stealth: Number($("stealth").value),
        intuition: Number($("intuition").value),
      },

      pers: {
        cheer: Number($("cheer").value),
        social: Number($("social").value),
        logical: Number($("logical").value),
        kind: Number($("kindness").value),
        desire: Number($("desire").value),
        courage: Number($("courage").value),
      },

      allowedCommands: getCheckedCommands(),
    });

    state.chars.push(char);
    addLog(state, `캐릭터 추가: ${char.name}`);
    renderCharacterList(state);
    updateRunButton(state);
    form.reset();
  };

  $("save-roster").onclick = () => saveRosterToFile(state);
  $("load-roster").onchange = async (e) => {
    await loadRosterFromFile(state, e.target.files[0]);
    renderCharacterList(state);
    updateRunButton(state);
  };

  $("save-log").onclick = () => saveLogToFile(state);
}

function getCheckedCommands() {
  const checked = new Set();
  document
    .querySelectorAll(".command-check input:checked")
    .forEach((c) => checked.add(c.value));
  return checked;
}

// ======================
// 캐릭터 목록
// ======================
export function renderCharacterList(state) {
  const ul = $("char-list");
  ul.innerHTML = "";

  state.chars.forEach((c, idx) => {
    const li = document.createElement("li");
    li.textContent = `${idx + 1}. ${c.name} (${c.gender}, ${c.age})`;
    ul.appendChild(li);
  });
}

// ======================
// 커맨드 선택 UI
// ======================
export function renderCommandChecklist() {
  const box = $("command-box");
  box.innerHTML = "";

  getAllCommands().forEach((cmd) => {
    const wrap = document.createElement("div");
    wrap.className = "command-check";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = cmd.id;

    const label = document.createElement("span");
    label.textContent = cmd.name;

    wrap.append(cb, label);
    box.appendChild(wrap);
  });
}

// ======================
// 게임 설정 UI
// ======================
export function initGameSettingUI(state) {
  const roles = [
    "engineer",
    "doctor",
    "guardian",
    "standby",
    "ac",
    "bug",
  ];

  roles.forEach((r) => {
    const cb = $(`role-${r}`);
    cb.onchange = () => (state.settings.roles[r] = cb.checked);
  });

  $("gnosia-count").oninput = (e) => {
    state.settings.gnosiaCount = Number(e.target.value);
  };
}

// ======================
// 실행 버튼 제어
// ======================
export function updateRunButton(state) {
  const btn = $("run-btn");
  btn.disabled = state.chars.length < 5;
}

// ======================
// 관계도 UI
// ======================
export function renderRelationUI(state) {
  const canvas = $("relation-canvas");
  renderRelationshipGraph(state, canvas);
}

