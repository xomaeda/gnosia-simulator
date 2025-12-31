import { COMMANDS, getUserVisibleCommandsForCharacter } from "./engine/commands.js";
import { Game } from "./engine/game.js";

const $ = (sel) => document.querySelector(sel);

const state = {
  characters: [],
  game: null,
  relationMode: "trust", // trust | favor
};

// ----- UI helpers -----
function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function clamp01(n) { return clamp(n, 0, 1); }
function clamp50(n) { return clamp(n, 0, 50); }

function uid() { return Math.random().toString(36).slice(2, 10); }

function logLine(text) {
  const log = $("#log");
  const p = document.createElement("div");
  p.className = "logLine";
  p.textContent = text;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  $("#log").innerHTML = "";
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function injectUtilityButtons() {
  const charTab = $("#characters");
  const runTab = $("#run");
  if (!charTab.querySelector("#saveChars")) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "10px";
    row.innerHTML = `
      <button id="saveChars">캐릭터 세이브</button>
      <input id="loadCharsFile" type="file" accept="application/json" style="display:none" />
      <button id="loadChars">캐릭터 로드</button>
      <span class="notice">※ 캐릭터 목록만 저장/불러오기</span>
    `;
    charTab.appendChild(row);
  }
  if (!runTab.querySelector("#saveLog")) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "10px";
    row.innerHTML = `
      <button id="saveLog">로그 저장</button>
    `;
    runTab.insertBefore(row, $("#log"));
  }
}

function validateCharacter(c) {
  if (!c.name?.trim()) return "이름을 입력해줘.";
  if (c.age < 0) return "나이는 음수가 될 수 없어.";
  for (const k of ["charisma","logic","acting","charm","stealth","intuition"]) {
    if (c.stats[k] < 0) return "스테이터스는 음수가 될 수 없어.";
    if (c.stats[k] > 50) return "스테이터스는 50을 넘을 수 없어.";
  }
  for (const k of ["cheer","social","logical","kindness","desire","courage"]) {
    if (c.personality[k] < 0 || c.personality[k] > 1) return "성격은 0.00~1.00 범위야.";
  }
  return null;
}

function readCharacterFromForm() {
  const c = {
    id: uid(),
    name: $("#c-name").value.trim(),
    age: clamp($("#c-age").value, 0, 999),
    gender: $("#c-gender").value,
    stats: {
      charisma: clamp50($("#s-charisma").value),
      logic: clamp50($("#s-logic").value),
      acting: clamp50($("#s-acting").value),
      charm: clamp50($("#s-charm").value),
      stealth: clamp50($("#s-stealth").value),
      intuition: clamp50($("#s-intuition").value),
    },
    personality: {
      cheer: clamp01($("#p-cheer").value),
      social: clamp01($("#p-social").value),
      logical: clamp01($("#p-logical").value),
      kindness: clamp01($("#p-kindness").value),
      desire: clamp01($("#p-desire").value),
      courage: clamp01($("#p-courage").value),
    },
    // user-selected command availability (by id)
    allowedCommands: {},
    // runtime only
    alive: true,
    role: null,
  };

  // default allowed commands: all user-visible commands that pass stat requirements are enabled by default.
  const visible = getUserVisibleCommandsForCharacter(c, COMMANDS);
  for (const cmd of visible) c.allowedCommands[cmd.id] = true;

  return c;
}

function renderCharacters() {
  const ul = $("#charList");
  ul.innerHTML = "";

  state.characters.forEach((c, idx) => {
    const li = document.createElement("li");
    li.className = "charCard";

    const roleBadge = state.game?.started ? `<span class="badge role">역할: ${c.role}</span>` : "";
    const deadBadge = (state.game?.started && !c.alive) ? `<span class="badge dead">소멸</span>` : "";

    li.innerHTML = `
      <div class="charTop">
        <div>
          <b>${c.name}</b>
          <div class="small">${c.gender} · ${c.age}세</div>
        </div>
        <div class="badges">
          ${roleBadge}
          ${deadBadge}
          <span class="badge">#${idx+1}</span>
        </div>
      </div>

      <div class="kv">
        <div>카리스마 <b>${c.stats.charisma.toFixed(1)}</b></div>
        <div>논리력 <b>${c.stats.logic.toFixed(1)}</b></div>
        <div>연기력 <b>${c.stats.acting.toFixed(1)}</b></div>
        <div>귀염성 <b>${c.stats.charm.toFixed(1)}</b></div>
        <div>스텔스 <b>${c.stats.stealth.toFixed(1)}</b></div>
        <div>직감 <b>${c.stats.intuition.toFixed(1)}</b></div>
      </div>

      <div class="kv">
        <div>쾌활함 <b>${c.personality.cheer.toFixed(2)}</b></div>
        <div>사회성 <b>${c.personality.social.toFixed(2)}</b></div>
        <div>논리성향 <b>${c.personality.logical.toFixed(2)}</b></div>
        <div>상냥함 <b>${c.personality.kindness.toFixed(2)}</b></div>
        <div>욕망 <b>${c.personality.desire.toFixed(2)}</b></div>
        <div>용기 <b>${c.personality.courage.toFixed(2)}</b></div>
      </div>

      <div class="row" style="margin-top:10px">
        <button class="editBtn">수정</button>
        <button class="delBtn danger">삭제</button>
      </div>

      <details>
        <summary>사용 가능 커맨드 체크(스탯 조건 충족한 커맨드만 표시)</summary>
        <div class="cmdGrid"></div>
      </details>
    `;

    // delete
    li.querySelector(".delBtn").onclick = () => {
      if (state.game?.started) {
        alert("게임이 시작된 후에는 캐릭터를 삭제할 수 없어. 새로고침 후 다시 시작해줘.");
        return;
      }
      state.characters = state.characters.filter(x => x.id !== c.id);
      renderCharacters();
      refreshStartAvailability();
    };

    // edit -> simple: load to form and replace
    li.querySelector(".editBtn").onclick = () => {
      if (state.game?.started) {
        alert("게임이 시작된 후에는 캐릭터를 수정할 수 없어. 새로고침 후 다시 시작해줘.");
        return;
      }
      // load form
      $("#c-name").value = c.name;
      $("#c-age").value = c.age;
      $("#c-gender").value = c.gender;

      $("#s-charisma").value = c.stats.charisma;
      $("#s-logic").value = c.stats.logic;
      $("#s-acting").value = c.stats.acting;
      $("#s-charm").value = c.stats.charm;
      $("#s-stealth").value = c.stats.stealth;
      $("#s-intuition").value = c.stats.intuition;

      $("#p-cheer").value = c.personality.cheer;
      $("#p-social").value = c.personality.social;
      $("#p-logical").value = c.personality.logical;
      $("#p-kindness").value = c.personality.kindness;
      $("#p-desire").value = c.personality.desire;
      $("#p-courage").value = c.personality.courage;

      // next add replaces
      $("#addChar").textContent = "캐릭터 수정 완료";
      $("#addChar").dataset.editId = c.id;
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // command checkboxes
    const cmdGrid = li.querySelector(".cmdGrid");
    const visible = getUserVisibleCommandsForCharacter(c, COMMANDS);

    visible.forEach(cmd => {
      const on = c.allowedCommands[cmd.id] !== false;
      const item = document.createElement("div");
      item.className = "cmdItem";
      item.innerHTML = `
        <input type="checkbox" ${on ? "checked":""} />
        <div>
          <b>${cmd.name}</b>
          <small>${cmd.uiHint}</small>
        </div>
      `;
      const cb = item.querySelector("input");
      cb.onchange = () => {
        c.allowedCommands[cmd.id] = cb.checked;
      };
      cmdGrid.appendChild(item);
    });

    ul.appendChild(li);
  });

  renderRelations();
}

function refreshStartAvailability() {
  $("#startGame").disabled = state.characters.length < 5;
  $("#execBtn").disabled = !state.game?.started;
}

function getSettings() {
  const enabled = {
    engineer: $("#set-engineer").checked,
    doctor: $("#set-doctor").checked,
    guardian: $("#set-guardian").checked,
    wait: $("#set-wait").checked,
    ac: $("#set-ac").checked,
    bug: $("#set-bug").checked,
  };
  const gCount = clamp($("#gnosiaCount").value, 1, 99);
  return { enabled, gnosiaCount: gCount };
}

// max gnosia
function maxGnosia(n) {
  if (n <= 6) return 1;
  if (n <= 8) return 2;
  if (n <= 10) return 3;
  if (n <= 12) return 4;
  if (n <= 14) return 5;
  return 6;
}

function enforceGnosiaLimit() {
  const n = state.characters.length;
  const max = maxGnosia(n);
  const input = $("#gnosiaCount");
  if (!input.value) input.value = "1";
  const cur = clamp(input.value, 1, max);
  input.value = String(cur);
  input.max = String(max);
}

function renderRelations() {
  const wrap = $("#relationView");
  wrap.innerHTML = "";

  if (!state.game?.started) {
    wrap.innerHTML = `<div class="notice">게임을 시작하면 관계도(신뢰/우호)가 생성돼.</div>`;
    return;
  }

  const rel = state.game.relations;
  const names = state.game.characters.map(c => c.name);

  const tabs = document.createElement("div");
  tabs.className = "relTabs";
  tabs.innerHTML = `
    <button id="relTrust" class="${state.relationMode === "trust" ? "primary":""}">신뢰도</button>
    <button id="relFavor" class="${state.relationMode === "favor" ? "primary":""}">우호도</button>
  `;
  wrap.appendChild(tabs);

  $("#relTrust").onclick = () => { state.relationMode = "trust"; renderRelations(); };
  $("#relFavor").onclick = () => { state.relationMode = "favor"; renderRelations(); };

  const tableWrap = document.createElement("div");
  tableWrap.className = "tableWrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  trh.innerHTML = `<th class="nameCell">→</th>` + names.map(n => `<th>${n}</th>`).join("");
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (let i=0;i<names.length;i++){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="nameCell"><b>${names[i]}</b></td>`;
    for (let j=0;j<names.length;j++){
      if (i===j){
        tr.innerHTML += `<td class="heat logMeta">—</td>`;
      } else {
        const v = state.relationMode === "trust" ? rel.trust[i][j] : rel.favor[i][j];
        tr.innerHTML += `<td class="heat">${v.toFixed(1)}</td>`;
      }
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);
}

function setupTabs() {
  const buttons = document.querySelectorAll("nav button");
  buttons.forEach(btn => {
    btn.onclick = () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const id = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach(s => s.classList.remove("active"));
      $("#" + id).classList.add("active");
    };
  });
  buttons[0].classList.add("active");
}

function wireButtons() {
  $("#addChar").onclick = () => {
    const editId = $("#addChar").dataset.editId || null;
    const c = readCharacterFromForm();
    const err = validateCharacter(c);
    if (err) return alert(err);

    if (editId) {
      const idx = state.characters.findIndex(x => x.id === editId);
      if (idx >= 0) {
        // keep original id
        c.id = editId;
        state.characters[idx] = c;
      }
      $("#addChar").textContent = "캐릭터 추가";
      delete $("#addChar").dataset.editId;
    } else {
      if (state.characters.length >= 15) return alert("캐릭터는 최대 15명까지야.");
      state.characters.push(c);
    }

    // reset form
    $("#c-name").value = "";
    $("#c-age").value = "";
    $("#s-charisma").value = "";
    $("#s-logic").value = "";
    $("#s-acting").value = "";
    $("#s-charm").value = "";
    $("#s-stealth").value = "";
    $("#s-intuition").value = "";
    $("#p-cheer").value = "";
    $("#p-social").value = "";
    $("#p-logical").value = "";
    $("#p-kindness").value = "";
    $("#p-desire").value = "";
    $("#p-courage").value = "";

    renderCharacters();
    enforceGnosiaLimit();
    refreshStartAvailability();
  };

  $("#startGame").onclick = () => {
    if (state.characters.length < 5) return alert("캐릭터는 최소 5명 필요해.");
    enforceGnosiaLimit();

    const settings = getSettings();
    const max = maxGnosia(state.characters.length);
    if (settings.gnosiaCount > max) {
      alert(`그노시아 수는 현재 인원(${state.characters.length})에서 최대 ${max}명까지야.`);
      return;
    }

    state.game = new Game(structuredClone(state.characters), settings, logLine);
    state.game.start();

    clearLog();
    logLine(`[시작] 역할이 공개됩니다.`);
    state.game.characters.forEach(c => logLine(`- ${c.name}: ${c.role}`));

    $("#execBtn").disabled = false;
    $("#startGame").disabled = true;
    renderCharacters();
    renderRelations();
  };

  $("#execBtn").onclick = () => {
    if (!state.game?.started) return;
    state.game.step();
    renderCharacters();
    renderRelations();
  };

  // save/load characters
  $("#characters").addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.id === "saveChars") {
      const payload = {
        version: 1,
        characters: state.characters,
      };
      downloadText("gnosia_characters.json", JSON.stringify(payload, null, 2));
    }

    if (t.id === "loadChars") {
      $("#loadCharsFile").click();
    }
  });

  $("#characters").addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.id === "loadCharsFile" && t.files?.[0]) {
      const file = t.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          if (!data?.characters || !Array.isArray(data.characters)) throw new Error("형식 오류");
          state.characters = data.characters;
          renderCharacters();
          enforceGnosiaLimit();
          refreshStartAvailability();
        } catch {
          alert("불러오기 실패: JSON 파일 형식이 올바르지 않아.");
        } finally {
          t.value = "";
        }
      };
      reader.readAsText(file, "utf-8");
    }
  });

  // log save
  $("#run").addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.id === "saveLog") {
      const lines = Array.from($("#log").querySelectorAll(".logLine")).map(x => x.textContent).join("\n");
      downloadText("gnosia_log.txt", lines || "");
    }
  });

  // settings helper
  $("#gnosiaCount").addEventListener("input", enforceGnosiaLimit);
}

// ----- boot -----
injectUtilityButtons();
setupTabs();
wireButtons();
renderCharacters();
enforceGnosiaLimit();
refreshStartAvailability();

