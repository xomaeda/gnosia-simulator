// main.js
// 이 파일은 "실행 버튼"과 "게임 로직"을 연결하는 역할만 한다.

import GameState from "./src/GameState.js";
import Logger from "./src/Logger.js";

// HTML이 전부 로드된 뒤에 실행되도록 보장
window.onload = () => {
  // 게임 상태 생성 (아직 실행 안 됨)
  const game = new GameState();

  // 실행 버튼 찾기
  const runButton = document.getElementById("runBtn");

  // 버튼 클릭 시 동작 정의
  runButton.onclick = () => {
    game.execute();
  };

  // 최초 안내 로그
  Logger.separator("시뮬레이터 시작");
  Logger.write("실행 버튼을 누르면 턴이 진행됩니다.");
};
