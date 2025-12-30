// js/main.js
import { createInitialState, addLog } from "./dataStructures.js";
import {
  initCharacterUI,
  renderCommandChecklist,
  initGameSettingUI,
  updateRunButton,
} from "./ui.js";
import { startNewGame, runOneStep } from "./gameLoop.js";

const state = createInitialState();

function boot() {
  // 커맨드 체크리스트 렌더(가장 먼저)
  renderCommandChecklist(state);

  // UI 초기화
  initCharacterUI(state);
  initGameSettingUI(state);
  updateRunButton(state);

  // 실행 버튼 연결
  const runBtn = document.getElementById("run-btn");
  runBtn.onclick = () => {
    if (state.phase === "setup") {
      if (state.chars.length < 5) {
        addLog(state, "캐릭터는 최소 5명 이상이어야 합니다.");
        return;
      }
      const ok = startNewGame(state);
      if (!ok) {
        addLog(state, "게임 시작 실패: 설정을 확인하세요.");
        return;
      }
      addLog(state, "게임을 시작합니다.");
      return;
    }
    runOneStep(state);
  };

  addLog(state, "그노시아 시뮬레이터 준비 완료.");
  addLog(state, "캐릭터를 5명 이상 추가하고 실행하세요.");
}

// DOM이 다 만들어진 뒤에 실행
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
