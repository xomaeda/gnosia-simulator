// js/main.js
// 최종 통합 엔트리 포인트

import { createInitialState, addLog } from "./dataStructures.js";
import { initCharacterUI, renderCommandChecklist, initGameSettingUI, updateRunButton } from "./ui.js";
import { startNewGame, runOneStep } from "./gameLoop.js";

// ======================
// 전역 상태 생성
// ======================
const state = createInitialState();

// ======================
// UI 초기화
// ======================
renderCommandChecklist();
initCharacterUI(state);
initGameSettingUI(state);
updateRunButton(state);

// ======================
// 실행 버튼
// ======================
const runBtn = document.getElementById("run-btn");

runBtn.onclick = () => {
  // 게임 시작 전
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

  // 게임 진행 중
  runOneStep(state);
};

// ======================
// 초기 로그
// ======================
addLog(state, "그노시아 시뮬레이터 준비 완료.");
addLog(state, "캐릭터를 5명 이상 추가하고 실행하세요.");
