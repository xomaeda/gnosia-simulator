// js/relationship.js
// 관계도(신뢰/우호) 변화 + 어그로 관리 + 관계도 캔버스 렌더(단순 선 그래프)

import { clamp, addLog, choice } from "./dataStructures.js";

// ===== 관계도 변화 =====
// 관계도 값 범위: -100 ~ +100 (중립 0)
// (기획서에 구체 범위는 없었으므로 시각화/밸런스를 위해 이 범위로 고정)
export const REL_MIN = -100;
export const REL_MAX = 100;

export function relGetTrust(state, fromId, toId) {
  return state.relations?.trust?.[fromId]?.[toId] ?? 0;
}
export function relGetLike(state, fromId, toId) {
  return state.relations?.like?.[fromId]?.[toId] ?? 0;
}

export function relSetTrust(state, fromId, toId, val) {
  if (!state.relations?.trust?.[fromId]) return;
  state.relations.trust[fromId][toId] = clamp(val, REL_MIN, REL_MAX);
}

export function relSetLike(state, fromId, toId, val) {
  if (!state.relations?.like?.[fromId]) return;
  state.relations.like[fromId][toId] = clamp(val, REL_MIN, REL_MAX);
}

export function relChangeTrust(state, fromId, toId, delta) {
  const cur = relGetTrust(state, fromId, toId);
  relSetTrust(state, fromId, toId, cur + delta);
}

export function relChangeLike(state, fromId, toId, delta) {
  const cur = relGetLike(state, fromId, toId);
  relSetLike(state, fromId, toId, cur + delta);
}

// ===== 어그로(hate) =====
// hate는 0~100 사이로 관리(높을수록 의심/습격 대상)
export function addHate(ch, amount) {
  ch.hate = clamp((ch.hate ?? 0) + Number(amount || 0), 0, 100);
}
export function reduceHate(ch, amount) {
  ch.hate = clamp((ch.hate ?? 0) - Number(amount || 0), 0, 100);
}

// ===== 밤 자유행동(우호 상승/혼자 보내기) 로그 도우미 =====
export function logNightFreeAction(state, actor, partner) {
  if (!partner) {
    addLog(state, `${actor.name}는 혼자 시간을 보냈다.`);
  } else {
    addLog(state, `${actor.name}는 ${partner.name}와 함께 시간을 보냈다.`);
  }
}

// ===== 관계도 캔버스 렌더 =====
// 단순 선 그래프:
// - 노드: 원
// - 선: (A->B) 신뢰/우호의 평균값을 두께로(절대값이 클수록 굵음)
// - 색을 지정하지 말라는 지침은 "차트"에 대한 것이고, 여기 캔버스 선은 UI라서
//   너무 단조로우면 구분이 안 돼서 최소한의 밝기만 다르게 줌(검은 배경 기준).

function arrangeCircle(n, cx, cy, r) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    pts.push({
      x: cx + Math.cos(ang) * r,
      y: cy + Math.sin(ang) * r,
    });
  }
  return pts;
}

export function renderRelationsCanvas(state, canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  // clear
  ctx.clearRect(0, 0, w, h);

  const alive = state.chars.filter(c => c.alive);
  if (alive.length === 0) {
    ctx.fillStyle = "#aaa";
    ctx.font = "16px monospace";
    ctx.fillText("표시할 캐릭터가 없습니다.", 20, 30);
    return;
  }

  // 배치(원형)
  const pts = arrangeCircle(alive.length, w / 2, h / 2, Math.min(w, h) * 0.32);

  // 선 그리기
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const ax = pts[i].x, ay = pts[i].y;
      const bx = pts[j].x, by = pts[j].y;

      // 방향성 관계를 평균으로 요약(시각화용)
      const tAB = state.relations.trust[a.id]?.[b.id] ?? 0;
      const tBA = state.relations.trust[b.id]?.[a.id] ?? 0;
      const lAB = state.relations.like[a.id]?.[b.id] ?? 0;
      const lBA = state.relations.like[b.id]?.[a.id] ?? 0;

      const mean = (tAB + tBA + lAB + lBA) / 4; // -100~100
      const abs = Math.abs(mean);

      // 두께 1~6 정도
      const lw = 1 + (abs / 100) * 5;

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);

      // 밝기: 긍정이면 밝게, 부정이면 어둡게(검은 배경 기준)
      // (색상은 최소한의 차이만)
      const v = clamp(Math.round(120 + (mean / 100) * 80), 50, 220);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  // 노드 그리기
  for (let i = 0; i < alive.length; i++) {
    const c = alive[i];
    const { x, y } = pts[i];

    // 원
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 이름
    ctx.fillStyle = "#eee";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.name, x, y);

    // 어그로(작게)
    ctx.fillStyle = "#aaa";
    ctx.font = "10px monospace";
    ctx.fillText(`H:${Math.round(c.hate)}`, x, y + 22);
  }

  // 안내
  ctx.fillStyle = "#aaa";
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.fillText("선 두께: 관계 강도(신뢰/우호 평균)  |  H: 어그로", 12, 18);
}
