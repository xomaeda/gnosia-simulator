export function saveGame(game) {
  localStorage.setItem("gnosiaSave", JSON.stringify(game));
}

export function loadGame() {
  return JSON.parse(localStorage.getItem("gnosiaSave"));
}

