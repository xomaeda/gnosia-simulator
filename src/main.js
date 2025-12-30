import { Character } from "./Character.js";
import { createGame } from "./Game.js";
import { runDiscussion } from "./Discussion.js";
import { runNight } from "./Night.js";
import { drawGraph } from "./Graph.js";
import { saveGame, loadGame } from "./SaveLoad.js";

const logEl = document.getElementById("log");
const canvas = document.getElementById("graph");

const chars = [
  new Character(0,"세츠",{logic:30,acting:20,stealth:10},{kind:20}),
  new Character(1,"라키오",{logic:40,acting:10,stealth:5},{kind:5}),
  new Character(2,"지나",{logic:15,acting:35,stealth:20},{kind:40}),
  new Character(3,"비야",{logic:10,acting:25,stealth:30},{kind:30}),
  new Character(4,"스텔라",{logic:20,acting:20,stealth:15},{kind:25})
];

let game = createGame(chars);

document.getElementById("dayBtn").onclick = ()=>{
  runDiscussion(game);
  logEl.textContent = game.log.join("\n");
  drawGraph(canvas, game);
};

document.getElementById("nightBtn").onclick = ()=>{
  runNight(game);
  logEl.textContent = game.log.join("\n");
};

document.getElementById("saveBtn").onclick = ()=>saveGame(game);
document.getElementById("loadBtn").onclick = ()=>{
  game = loadGame();
  logEl.textContent = game.log.join("\n");
};

