// engine/relation.js
// 관계도 시각화 렌더러
// main.js에서: relationApi.renderRelation(relationBox, engine) 로 호출됨

export function renderRelation(container, engine) {
  if (!container) return;

  const snap = readRelationSnapshot(engine);
  if (!snap) {
    container.innerHTML = `<div style="opacity:.85;">(관계 데이터를 찾지 못했습니다. engine에 관계 데이터가 준비되면 자동 표시됩니다)</div>`;
    return;
  }

  const { names, trust, like } = snap;

  container.innerHTML = "";
  container.classList.add("relation-wrap");

  // 스타일(한 번만 주입)
  ensureRelationStyles();

  // 헤더
  const header = document.createElement("div");
  header.className = "relation-head";
  header.innerHTML = `
    <div class="relation-title">관계도</div>
    <div class="relation-legend">
      <span class="pill">신뢰</span>
      <span class="pill">우호</span>
    </div>
  `;
  container.appendChild(header);

  // 표
  const tableWrap = document.createElement("div");
  tableWrap.className = "relation-table-wrap";
  container.appendChild(tableWrap);

  const table = document.createElement("table");
  table.className = "relation-table";
  tableWrap.appendChild(table);

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");

  // 좌상단 빈칸
  const th0 = document.createElement("th");
  th0.className = "sticky corner";
  th0.textContent = " ";
  trh.appendChild(th0);

  // 상단 이름들
  names.forEach((n) => {
    const th = document.createElement("th");
    th.className = "sticky colhead";
    th.textContent = n;
    trh.appendChild(th);
  });

  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  for (let i = 0; i < names.length; i++) {
    const tr = document.createElement("tr");

    const rowHead = document.createElement("th");
    rowHead.className = "sticky rowhead";
    rowHead.textContent = names[i];
    tr.appendChild(rowHead);

    for (let j = 0; j < names.length; j++) {
      const td = document.createElement("td");
      td.className = "cell";

      if (i === j) {
        td.classList.add("self");
        td.textContent = "—";
      } else {
        const t = trust?.[i]?.[j];
        const l = like?.[i]?.[j];

        // 값이 없으면 표시 최소화
        const tText = formatNum(t);
        const lText = formatNum(l);

        td.innerHTML = `
          <div class="pair">
            <div class="v trust" title="신뢰도">신 ${tText}</div>
            <div class="v like" title="우호도">우 ${lText}</div>
          </div>
        `;

        // 아주 대략적인 색강조(값 범위를 몰라도 “상대 비교”가 되게)
        // 숫자가 크면 진하게, 작으면 옅게
        const tint = computeTint(t, l);
        if (tint != null) td.style.background = `rgba(255,255,255,${tint})`;
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

/* -------------------------------------------------------
   관계 스냅샷 추출 (엔진 구현 차이를 흡수)
   반환 형식:
     { names: string[], trust: number[][], like: number[][] }
------------------------------------------------------- */
function readRelationSnapshot(engine) {
  if (!engine) return null;

  // 1) 캐릭터 이름 목록 추출
  const chars =
    engine.characters ||
    engine.players ||
    engine.state?.characters ||
    engine.state?.players ||
    null;

  let names = null;

  if (Array.isArray(chars) && chars.length) {
    names = chars.map((c) => String(c.name ?? c.id ?? "???"));
  } else if (Array.isArray(engine?.roster) && engine.roster.length) {
    names = engine.roster.map((c) => String(c.name ?? c.id ?? "???"));
  } else if (Array.isArray(engine?.names) && engine.names.length) {
    names = engine.names.map((x) => String(x));
  }

  // 엔진이 제공하는 메서드가 있다면 사용
  if (!names && typeof engine.getNames === "function") {
    try {
      const n = engine.getNames();
      if (Array.isArray(n) && n.length) names = n.map(String);
    } catch {}
  }

  if (!names || names.length === 0) return null;

  // 2) 관계 데이터 찾기
  // 가장 이상적인 형태: trust[i][j], like[i][j]
  let trust = null;
  let like = null;

  // 형태 A: engine.relations = { trust:[][], like:[][] }
  const relA = engine.relations || engine.state?.relations;
  if (relA && (relA.trust || relA.like)) {
    trust = relA.trust || null;
    like = relA.like || null;
  }

  // 형태 B: engine.getRelations() → {trust, like}
  if ((!trust && !like) && typeof engine.getRelations === "function") {
    try {
      const rel = engine.getRelations();
      if (rel && (rel.trust || rel.like)) {
        trust = rel.trust || trust;
        like = rel.like || like;
      }
    } catch {}
  }

  // 형태 C: engine.getRelation(i,j) → {trust, like} 또는 [trust, like]
  if ((!trust || !like) && typeof engine.getRelation === "function") {
    const n = names.length;
    trust = make2D(n, null);
    like = make2D(n, null);
    try {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const r = engine.getRelation(i, j);
          if (Array.isArray(r)) {
            trust[i][j] = r[0];
            like[i][j] = r[1];
          } else if (r && typeof r === "object") {
            trust[i][j] = r.trust;
            like[i][j] = r.like;
          }
        }
      }
    } catch {
      // 실패하면 초기화
      trust = null;
      like = null;
    }
  }

  // 형태 D: engine.relationTrust / engine.relationLike
  if (!trust && Array.isArray(engine.relationTrust)) trust = engine.relationTrust;
  if (!like && Array.isArray(engine.relationLike)) like = engine.relationLike;

  // 최소한 둘 중 하나라도 있어야 렌더 가능
  if (!trust && !like) return { names, trust: null, like: null };

  // 크기 보정
  const n = names.length;
  if (trust) trust = normalize2D(trust, n);
  if (like) like = normalize2D(like, n);

  return { names, trust, like };
}

/* -------------------------------------------------------
   헬퍼
------------------------------------------------------- */
function make2D(n, fill) {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => fill));
}

function normalize2D(arr, n) {
  const out = make2D(n, null);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out[i][j] = arr?.[i]?.[j] ?? null;
    }
  }
  return out;
}

function formatNum(v) {
  if (v == null || !Number.isFinite(Number(v))) return "?";
  const num = Number(v);
  // 소수 2자리까지 깔끔하게
  return (Math.round(num * 100) / 100).toFixed(2);
}

function computeTint(t, l) {
  // 신뢰/우호 값 범위를 모르는 상태에서, “있으면 조금 강조” 정도만 적용
  // 값이 0~1이면 약하게, 값이 0~100이면 적당히 보이도록 정규화
  const tv = Number.isFinite(Number(t)) ? Number(t) : null;
  const lv = Number.isFinite(Number(l)) ? Number(l) : null;
  if (tv == null && lv == null) return null;

  const v = (tv ?? 0) + (lv ?? 0);
  // 대충 스케일 추정: v가 0~2일 수도 있고 0~200일 수도 있음
  // 그래서 log 기반으로 눌러서 0.02~0.14 정도의 알파만
  const a = Math.min(0.14, Math.max(0.02, Math.log10(1 + Math.abs(v)) * 0.06));
  return a;
}

function ensureRelationStyles() {
  if (document.getElementById("relation-style")) return;

  const style = document.createElement("style");
  style.id = "relation-style";
  style.textContent = `
    .relation-wrap{
      display:flex;
      flex-direction:column;
      gap:10px;
      width:100%;
    }
    .relation-head{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
    }
    .relation-title{
      font-weight:800;
      letter-spacing:.2px;
      font-size:16px;
    }
    .relation-legend{
      display:flex;
      gap:6px;
      opacity:.9;
      font-size:12px;
    }
    .relation-legend .pill{
      border:1px solid rgba(255,255,255,.18);
      padding:3px 8px;
      border-radius:999px;
      background:rgba(0,0,0,.35);
    }
    .relation-table-wrap{
      border:1px solid rgba(255,255,255,.14);
      background:rgba(0,0,0,.35);
      overflow:auto;
      max-height:420px;
      border-radius:10px;
    }
    .relation-table{
      border-collapse:separate;
      border-spacing:0;
      width:max-content;
      min-width:100%;
      font-size:12px;
    }
    .relation-table th,
    .relation-table td{
      border-right:1px solid rgba(255,255,255,.10);
      border-bottom:1px solid rgba(255,255,255,.10);
      padding:6px 8px;
      text-align:center;
      white-space:nowrap;
      background:rgba(0,0,0,.20);
    }
    .relation-table thead th{
      background:rgba(0,0,0,.55);
      font-weight:700;
    }
    .relation-table .sticky{
      position:sticky;
      z-index:2;
    }
    .relation-table .corner{
      left:0; top:0;
      z-index:4;
      background:rgba(0,0,0,.70);
    }
    .relation-table .rowhead{
      left:0;
      z-index:3;
      background:rgba(0,0,0,.55);
      text-align:left;
      min-width:90px;
    }
    .relation-table .colhead{
      top:0;
      z-index:3;
      min-width:90px;
    }
    .relation-table .cell{
      min-width:86px;
    }
    .relation-table .cell.self{
      opacity:.55;
      font-weight:700;
    }
    .pair{
      display:flex;
      flex-direction:column;
      gap:2px;
      align-items:center;
      justify-content:center;
      line-height:1.1;
    }
    .pair .v{
      width:100%;
      display:flex;
      justify-content:center;
      gap:6px;
    }
    .pair .trust{ opacity:.95; }
    .pair .like{ opacity:.95; }
  `;
  document.head.appendChild(style);
}
