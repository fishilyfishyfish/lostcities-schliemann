// UI. 게임 진행은 worker.js(엔진)가 하고, 여기서는 사람 시점 관측 객체를 그리기만 한다.
// cards.js / scoring.js는 카드 표기와 점수 미리보기 계산용으로만 가져온다 (순수 함수, 상태 없음).
import { NUM_COLORS, cardColor, cardValue, isWager } from '../engine/cards.js';
import { expeditionBreakdown, expeditionScore } from '../engine/scoring.js';

const COLOR_KEYS = ['yellow', 'blue', 'white', 'green', 'red'];
const COLOR_NAMES = ['노랑', '파랑', '하양', '초록', '빨강'];
const EXPEDITION = 'expedition';
const DISCARD = 'discard';
const DECK = 'deck';

const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const ui = {
  obs: null,
  legalMoves: [],
  final: null,
  selected: null, // 손패에서 고른 카드
  pending: null, // { card, target } 놓기/버리기 결정, 뽑기 대기
  error: null,
  tracker: null, // 카드 추적표 (워커가 관측에서 계산)
  analysis: null, // { turn, result } 수 분석 결과
  analyzing: false,
  suggestedDraw: null, // 분석 행을 눌렀을 때 추천 뽑기
  expanded: null, // 수 분석 후보 중 펼친 행
  tab: 'moves',
};

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'update') {
    const prevTurn = ui.obs?.turn ?? -1;
    ui.obs = msg.obs;
    ui.legalMoves = msg.legalMoves;
    ui.final = msg.final;
    ui.tracker = msg.tracker;
    ui.error = null;
    if (msg.obs.turn !== prevTurn) {
      ui.selected = null;
      ui.pending = null;
      ui.suggestedDraw = null;
      if (ui.analysis && ui.analysis.turn !== msg.obs.turn) ui.analysis = null;
    }
    render();
    if (ui.final) showResult();
  } else if (msg.type === 'analysis') {
    ui.analyzing = false;
    if (ui.obs && msg.turn === ui.obs.turn) {
      ui.analysis = { turn: msg.turn, result: msg.result };
      ui.expanded = null;
    }
    render();
  } else if (msg.type === 'error') {
    ui.error = msg.message;
    ui.pending = null;
    ui.analyzing = false;
    render();
  }
};

function newGame() {
  $('overlay').hidden = true;
  ui.obs = null;
  ui.selected = null;
  ui.pending = null;
  ui.final = null;
  ui.analysis = null;
  ui.analyzing = false;
  ui.suggestedDraw = null;
  worker.postMessage({ type: 'new', ai: $('ai-select').value });
}

// ---------- 표기 ----------

function cardText(card) {
  return isWager(card) ? '🤝' : String(cardValue(card));
}

function cardName(card) {
  return `${COLOR_NAMES[cardColor(card)]} ${isWager(card) ? '투자' : cardValue(card)}`;
}

function cardEl(card, extra = '') {
  const el = document.createElement('div');
  el.className = `card c-${COLOR_KEYS[cardColor(card)]} ${isWager(card) ? 'wager' : ''} ${extra}`;
  el.innerHTML = `<span class="v">${cardText(card)}</span><span class="v2">${cardText(card)}</span>`;
  el.dataset.card = card;
  return el;
}

function fmtScore(n) {
  return n > 0 ? `+${n}` : String(n);
}

// ---------- 상태 파생 ----------

const myTurn = () => ui.obs && !ui.obs.over && ui.obs.current === ui.obs.player;

function canTarget(card, target) {
  return ui.legalMoves.some((m) => sameCardKind(m.card, card) && m.target === target);
}

// 합법수는 같은 색 투자 카드를 하나만 담으므로 투자 카드는 색으로 비교
function sameCardKind(a, b) {
  return a === b || (isWager(a) && isWager(b) && cardColor(a) === cardColor(b));
}

function legalDraws() {
  if (!ui.pending) return [];
  const { card, target } = ui.pending;
  return ui.legalMoves.filter((m) => sameCardKind(m.card, card) && m.target === target).map((m) => m.draw);
}

/** 확정 전 미리보기를 반영한 내 탐험대/버림 더미/손패. */
function view() {
  const o = ui.obs;
  const myExps = o.myExpeditions.map((e) => e.slice());
  const discards = o.discards.map((d) => d.slice());
  let hand = o.hand.slice();
  if (ui.pending) {
    const { card, target } = ui.pending;
    hand = hand.filter((c) => c !== card);
    (target === EXPEDITION ? myExps : discards)[cardColor(card)].push(card);
  }
  return { myExps, discards, hand };
}

// ---------- 그리기 ----------

function render() {
  const o = ui.obs;
  if (!o) return;
  const v = view();
  const lastOpp = [...o.history].reverse().find((h) => h.player !== o.player);
  const lastOppIdx = lastOpp ? o.history.lastIndexOf(lastOpp) : -1;
  const lastOppIsLatest = lastOppIdx === o.history.length - 1;

  // 점수
  const myTotal = v.myExps.reduce((s, e) => s + expeditionScore(e), 0);
  const oppTotal = o.oppExpeditions.reduce((s, e) => s + expeditionScore(e), 0);
  $('total-me').textContent = fmtScore(myTotal);
  $('total-ai').textContent = fmtScore(oppTotal);
  $('opp-hand-count').textContent = `· 손패 ${o.opponentHandCount}장`;

  // 탐험대
  renderExpeditions($('opp-exps'), o.oppExpeditions, {
    highlight: lastOpp && lastOpp.target === EXPEDITION && lastOppIsLatest ? lastOpp.card : null,
  });
  renderExpeditions($('my-exps'), v.myExps, {
    ghost: ui.pending?.target === EXPEDITION ? ui.pending.card : null,
    targetColor: ui.selected !== null && !ui.pending && canTarget(ui.selected, EXPEDITION) ? cardColor(ui.selected) : null,
    onTap: (color) => {
      if (ui.selected !== null && !ui.pending && cardColor(ui.selected) === color && canTarget(ui.selected, EXPEDITION)) {
        choose(EXPEDITION);
      }
    },
  });

  // 버림 더미
  const draws = legalDraws();
  const piles = $('piles');
  piles.replaceChildren();
  for (let c = 0; c < NUM_COLORS; c++) {
    const pile = document.createElement('button');
    pile.type = 'button';
    pile.className = `pile p-${COLOR_KEYS[c]}`;
    pile.setAttribute('aria-label', `${COLOR_NAMES[c]} 버림 더미 ${v.discards[c].length}장`);
    const d = v.discards[c];
    if (d.length) {
      const top = d[d.length - 1];
      const ghost = ui.pending?.target === DISCARD && ui.pending.card === top;
      const hi = lastOpp && lastOppIsLatest && lastOpp.target === DISCARD && lastOpp.card === top;
      pile.append(cardEl(top, `${ghost ? 'ghost' : ''} ${hi ? 'last' : ''}`));
      if (d.length > 1) {
        const n = document.createElement('span');
        n.className = 'count';
        n.textContent = d.length;
        pile.append(n);
      }
    } else {
      pile.append(Object.assign(document.createElement('div'), { className: 'slot' }));
    }
    const drawable = draws.includes(c);
    const discardTarget = ui.selected !== null && !ui.pending && cardColor(ui.selected) === c && canTarget(ui.selected, DISCARD);
    pile.classList.toggle('drawable', drawable);
    pile.classList.toggle('target', discardTarget);
    pile.disabled = !(drawable || discardTarget);
    pile.onclick = () => {
      if (drawable) draw(c);
      else if (discardTarget) choose(DISCARD);
    };
    piles.append(pile);
  }

  // 덱
  $('deck-count').textContent = o.deckCount;
  const deck = $('deck');
  const deckDrawable = draws.includes(DECK);
  deck.classList.toggle('drawable', deckDrawable);
  deck.disabled = !deckDrawable;
  deck.onclick = () => deckDrawable && draw(DECK);

  // 손패
  const hand = $('hand');
  hand.replaceChildren();
  for (const card of v.hand) {
    const el = cardEl(card, ui.selected === card ? 'selected' : '');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hand-card';
    b.setAttribute('aria-label', cardName(card));
    b.disabled = !myTurn() || !!ui.pending;
    b.append(el);
    b.onclick = () => select(card);
    hand.append(b);
  }

  // 상대가 버림 더미에서 가져가 아직 들고 있는 카드
  const known = $('known');
  known.replaceChildren();
  if (o.opponentKnownCards.length) {
    const label = document.createElement('span');
    label.className = 'known-label';
    label.textContent = 'AI가 버림 더미에서 가져간 카드';
    known.append(label);
    const row = document.createElement('div');
    row.className = 'mini-row';
    for (const c of o.opponentKnownCards) row.append(cardEl(c, 'mini'));
    known.append(row);
  }

  renderStatus(lastOpp);

  // 분석 행에서 고른 수의 추천 뽑기 표시
  $('deck').classList.remove('suggested');
  if (ui.pending && ui.suggestedDraw !== null) {
    if (ui.suggestedDraw === DECK) $('deck').classList.add('suggested');
    else $('piles').children[ui.suggestedDraw]?.classList.add('suggested');
  }
  renderAnalysis();
}

function renderExpeditions(container, exps, { ghost = null, highlight = null, targetColor = null, onTap = null }) {
  container.replaceChildren();
  for (let c = 0; c < NUM_COLORS; c++) {
    const col = document.createElement('div');
    col.className = `exp e-${COLOR_KEYS[c]}`;
    col.classList.toggle('target', targetColor === c);
    const stack = document.createElement('div');
    stack.className = 'stack';
    for (const card of exps[c]) {
      stack.append(cardEl(card, `${card === ghost ? 'ghost' : ''} ${card === highlight ? 'last' : ''}`));
    }
    if (exps[c].length === 0) stack.append(Object.assign(document.createElement('div'), { className: 'slot' }));
    const score = document.createElement('div');
    score.className = 'exp-score';
    const s = expeditionScore(exps[c]);
    score.textContent = exps[c].length ? fmtScore(s) : '·';
    score.classList.toggle('neg', s < 0);
    score.classList.toggle('pos', s > 0);
    col.append(stack, score);
    if (onTap) col.onclick = () => onTap(c);
    container.append(col);
  }
}

function renderStatus(lastOpp) {
  const o = ui.obs;
  const msg = $('message');
  const actions = $('actions');
  actions.replaceChildren();
  const button = (label, fn, cls = '', disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = fn;
    actions.append(b);
  };

  const oppNote = lastOpp ? `AI: ${cardName(lastOpp.card)} ${lastOpp.target === EXPEDITION ? '놓음' : '버림'}, ${lastOpp.draw === DECK ? '덱에서 뽑음' : `${COLOR_NAMES[lastOpp.draw]} 더미에서 가져감`}. ` : '';

  if (ui.error) {
    msg.textContent = `오류: ${ui.error}`;
  } else if (o.over) {
    msg.textContent = '라운드 종료';
    button('결과 보기', showResult, 'primary');
  } else if (!myTurn()) {
    msg.textContent = 'AI 차례…';
  } else if (ui.pending) {
    const { card, target } = ui.pending;
    msg.textContent = `${cardName(card)} ${target === EXPEDITION ? '놓기' : '버리기'} → 덱이나 버림 더미에서 뽑을 곳을 고르세요`;
    button('취소', () => { ui.pending = null; ui.suggestedDraw = null; render(); });
  } else if (ui.selected !== null) {
    const c = ui.selected;
    msg.textContent = `${cardName(c)} 선택`;
    const canExp = canTarget(c, EXPEDITION);
    const exp = ui.obs.myExpeditions[cardColor(c)];
    const preview = canExp ? ` (${fmtScore(expeditionScore(exp))} → ${fmtScore(expeditionScore([...exp, c]))})` : '';
    button(`탐험대에 놓기${preview}`, () => choose(EXPEDITION), 'primary', !canExp);
    button('버리기', () => choose(DISCARD), '', !canTarget(c, DISCARD));
    button('취소', () => { ui.selected = null; render(); });
  } else {
    msg.textContent = `${oppNote}카드를 고르세요`;
  }
}

// ---------- 입력 ----------

function select(card) {
  if (!myTurn() || ui.pending) return;
  ui.selected = ui.selected === card ? null : card;
  render();
}

function choose(target) {
  if (ui.selected === null || !canTarget(ui.selected, target)) return;
  ui.suggestedDraw = null;
  ui.pending = { card: ui.selected, target };
  ui.selected = null;
  render();
}

function draw(source) {
  if (!ui.pending) return;
  const move = { card: ui.pending.card, target: ui.pending.target, draw: source };
  worker.postMessage({ type: 'move', move });
}

// ---------- 결과 ----------

function showResult() {
  if (!ui.final) return;
  const [me, ai] = ui.final.scores;
  $('result-title').textContent = me.total > ai.total ? '승리' : me.total < ai.total ? '패배' : '무승부';
  const t = $('result-table');
  const rows = [`<tr><th></th>${COLOR_NAMES.map((n, i) => `<th class="h-${COLOR_KEYS[i]}">${n}</th>`).join('')}<th>합계</th></tr>`];
  for (const [label, s] of [['나', me], ['AI', ai]]) {
    rows.push(`<tr><th>${label}</th>${s.perColor.map((x) => `<td>${fmtScore(x)}</td>`).join('')}<td><b>${fmtScore(s.total)}</b></td></tr>`);
  }
  t.innerHTML = rows.join('');
  const aiHand = $('ai-hand');
  aiHand.replaceChildren(...ui.final.aiHand.map((c) => cardEl(c, 'mini')));
  $('overlay').hidden = false;
}

$('btn-new').onclick = newGame;
$('ai-select').onchange = newGame;
try {
  const saved = localStorage.getItem('lc-ai');
  if (saved && [...$('ai-select').options].some((o) => o.value === saved)) $('ai-select').value = saved;
} catch {}
$('ai-select').addEventListener('change', () => { try { localStorage.setItem('lc-ai', $('ai-select').value); } catch {} });
$('btn-again').onclick = newGame;
$('btn-close').onclick = () => { $('overlay').hidden = true; };

newGame();

// ---------- 분석 패널 ----------

const STATUS_LABEL = {
  myHand: ['손', '내 손패'],
  myExpedition: ['내', '내 탐험대'],
  oppExpedition: ['AI', 'AI 탐험대'],
  discard: ['버', '버림 더미 (굵게: 맨 위)'],
  oppHandKnown: ['AI손', 'AI가 버림 더미에서 가져가 들고 있음'],
  unseen: ['', '미확인 (덱 또는 AI 손패)'],
};

function setAnalysisOpen(open) {
  $('analysis').hidden = !open;
  $('btn-analysis').setAttribute('aria-pressed', String(open));
  try { localStorage.setItem('lc-analysis', open ? '1' : '0'); } catch {}
  render();
}

function setTab(tab) {
  ui.tab = tab;
  try { localStorage.setItem('lc-tab', tab); } catch {}
  render();
}


function renderAnalysis() {
  if ($('analysis').hidden || !ui.obs) return;
  for (const b of document.querySelectorAll('.tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
  }
  $('tab-moves').hidden = ui.tab !== 'moves';
  $('tab-tracker').hidden = ui.tab !== 'tracker';
  $('tab-score').hidden = ui.tab !== 'score';
  if (ui.tab === 'moves') renderMovesTab();
  else if (ui.tab === 'tracker') renderTrackerTab();
  else renderScoreTab();
}

const CONF_TEXT = { similar: '비슷함', slight: '근소', clear: '뚜렷' };

function moveText(m) {
  const what = m.target === EXPEDITION ? '탐험대에 놓기' : '버리기';
  const from = m.draw === DECK ? '덱에서 뽑기' : `${COLOR_NAMES[m.draw]} 더미에서 뽑기`;
  return `${cardName(m.card)} ${what} → ${from}`;
}

const r1 = (x) => Math.round(x * 10) / 10;
const sign = (x) => fmtScore(r1(x));

function pickMove(m) {
  if (!myTurn()) return;
  ui.selected = null;
  ui.pending = { card: m.card, target: m.target };
  ui.suggestedDraw = m.draw;
  render();
}

function renderMovesTab() {
  const btn = $('btn-analyze');
  btn.disabled = !myTurn() || ui.analyzing;
  const a = ui.analysis && ui.analysis.turn === ui.obs.turn ? ui.analysis.result : null;
  $('analysis-status').textContent = ui.analyzing
    ? '분석 중… (약 1.5초)'
    : !myTurn() ? '내 차례에 분석할 수 있다'
    : a ? `수읽기 ${a.iterations.toLocaleString()}회` : '';
  const box = $('moves-table');
  box.replaceChildren();
  if (!a || !a.position) return;

  // --- 국면 요약: 현재 점수 → 예상 최종 점수 ---
  const pos = a.position;
  const summary = document.createElement('div');
  summary.className = 'pos-summary';
  const diffNow = pos.current[0] - pos.current[1];
  const diffExp = pos.projected[0] - pos.projected[1];
  summary.innerHTML = `
    <div class="pos-line"><span class="muted">지금 점수</span> 나 <b>${sign(pos.current[0])}</b> · AI <b>${sign(pos.current[1])}</b> <span class="muted">(차 ${sign(diffNow)})</span></div>
    <div class="pos-line"><span class="muted">예상 최종</span> 나 <b>${sign(pos.projected[0])}</b> · AI <b>${sign(pos.projected[1])}</b> <span class="muted">(차 ${sign(diffExp)})</span></div>
    <table class="proj">
      <tr><th></th>${COLOR_NAMES.map((n, i) => `<th class="h-${COLOR_KEYS[i]}">${n}</th>`).join('')}</tr>
      <tr><th>나</th>${pos.me.map((p) => `<td>${projCell(p)}</td>`).join('')}</tr>
      <tr><th>AI</th>${pos.opp.map((p) => `<td>${projCell(p)}</td>`).join('')}</tr>
    </table>
    <p class="note">예상 최종 = 놓인 카드 + 손패 중 이어 놓을 수 있는 카드 × ${Math.round(a.weights.hand * 100)}% + 아직 안 나온 카드 중 이어 놓을 수 있는 카드 × ${Math.round(a.weights.unseen * 100)}%(내가 뽑아 쓸 몫)로 (합 − 20) × 배수 + 보너스를 계산한 것. 시작 안 한 색은 손해면 시작하지 않는다고 보고 0. AI는 AI가 가져간 카드와, 안 나온 카드 × ${Math.round(a.weights.aiUnseen * 100)}%로 계산. 덱 ${pos.deckCount}장 · 내 남은 차례 약 ${pos.myTurns}번 · 지금 놓을 수 있는 손패 ${pos.planned}장.</p>`;
  box.append(summary);

  const searched = a.moves.filter((m) => m.expected !== null);
  if (!searched.length) return;

  // --- 추천 ---
  const best = searched[0];
  const second = searched[1];
  const rec = document.createElement('div');
  rec.className = 'recommend';
  const conf = !second ? ''
    : best.confidence === 'similar' ? `${r1(second.gap) === 0 ? '2위와 거의 같음' : `2위와 ${r1(second.gap)}점 차`} · 비슷함: 2위 수를 둬도 손해가 거의 없다`
    : `2위와 ${r1(second.gap)}점 차 · ${CONF_TEXT[best.confidence]}`;
  rec.innerHTML = `<div class="rec-title">추천: ${moveText(best.move)}</div>
    <div class="muted">${conf}</div>
    <div class="sub">이 수가 하는 일</div>
    <ul class="reasons">${best.reasons.map((r) => `<li class="r-${r.kind}">${r.text}</li>`).join('')}</ul>
    ${versusHtml(best, searched)}`;
  const recBtn = document.createElement('button');
  recBtn.className = 'btn small primary';
  recBtn.type = 'button';
  recBtn.textContent = '이 수 선택';
  recBtn.disabled = !myTurn();
  recBtn.onclick = () => pickMove(best.move);
  rec.append(recBtn);
  box.append(rec);

  // --- 후보 목록 ---
  const head = document.createElement('div');
  head.className = 'cand-head muted';
  head.textContent = `후보 ${searched.length}수 (규칙 평가 상위 수를 수읽기로 비교). 누르면 근거를 펼친다.`;
  box.append(head);
  searched.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = `cand ${ui.expanded === i ? 'open' : ''}`;
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'cand-line';
    line.append(cardEl(m.move.card, 'mini'));
    line.insertAdjacentHTML('beforeend', `<span class="cand-rank">${i + 1}</span><span class="cand-text">${moveText(m.move)}</span>
      <span class="cand-gap">${i === 0 ? '최선' : r1(m.gap) === 0 ? '≈0' : `−${r1(m.gap)}`}</span>
      <span class="badge b-${m.confidence}">${i === 0 ? (second ? CONF_TEXT[m.confidence] : '') : CONF_TEXT[m.confidence]}</span>`);
    line.onclick = () => { ui.expanded = ui.expanded === i ? null : i; render(); };
    row.append(line);
    if (ui.expanded === i) {
      const d = document.createElement('div');
      d.className = 'cand-detail';
      const eff = m.effects;
      const staticNote = m.staticRank === i + 1
        ? `정적 평가로도 ${m.staticRank}위.`
        : `정적 평가로는 ${m.staticRank}위${m.staticGap > 0.05 ? ` (1위보다 ${r1(m.staticGap)}점 낮음)` : ''}인데, 상대 응수와 종반까지 수읽기한 결과 ${i + 1}위.`;
      d.innerHTML = `<div class="sub">이 수가 하는 일</div>
        <ul class="reasons">${m.reasons.map((r) => `<li class="r-${r.kind}">${r.text}</li>`).join('')}</ul>
        ${i > 0 ? versusHtml(m, searched) : ''}
        <div class="effects">이 수의 효과: 놓기·버리기 <b>${sign(eff.play)}</b> · 뽑기 <b>${sign(eff.draw)}</b> · AI에게 줄 위험 <b>${sign(eff.gift)}</b> = <b>${sign(eff.total)}</b></div>
        <div class="muted">${staticNote} 수읽기 기대 점수 차(라운드 끝 내 점수 − AI 점수) ${sign(m.expected)}.</div>`;
      const b = document.createElement('button');
      b.className = 'btn small';
      b.type = 'button';
      b.textContent = '이 수 선택';
      b.disabled = !myTurn();
      b.onclick = () => pickMove(m.move);
      d.append(b);
      row.append(d);
    }
    box.append(row);
  });
}

/** 수읽기 비교 (색별 예상 변화의 차이). 1위는 2위와, 나머지는 1위와. */
function versusHtml(m, searched) {
  const v = m.versus;
  if (!v || (!v.pros.length && !v.cons.length)) return '';
  const other = searched[v.rank - 1];
  const title = v.rank === 2
    ? `수읽기로 본 2위(${moveText(other.move)})와의 차이`
    : `수읽기로 본 1위(${moveText(other.move)})와의 차이`;
  const total = `${v.total >= 0 ? '+' : '−'}${Math.abs(r1(v.total))}`;
  const rest = Math.abs(v.rest) >= 0.05 ? `<li class="rest">그 밖의 작은 차이 합 ${v.rest >= 0 ? '+' : '−'}${Math.abs(r1(v.rest))}</li>` : '';
  return `<div class="sub">${title} — 합계 ${total}점 (+는 이 수가 유리한 쪽)</div>
    <ul class="reasons versus">
      ${v.pros.map((t) => `<li class="pro">${t}</li>`).join('')}
      ${v.cons.map((t) => `<li class="con">${t}</li>`).join('')}
      ${rest}
    </ul>`;
}

function projCell(p) {
  if (!p.started && p.projected === 0) return '<span class="muted">·</span>';
  return `<span class="muted">${p.started ? sign(p.current) : '0'}→</span>${sign(p.projected)}`;
}

function renderTrackerTab() {
  const t = ui.tracker;
  if (!t) return;
  const o = ui.obs;
  const oppHidden = o.opponentHandCount - o.opponentKnownCards.length;
  $('tracker-summary').textContent = `미확인 ${t.unseenTotal}장 = 덱 ${o.deckCount}장 + AI 손패 중 모르는 ${oppHidden}장`;
  const table = $('tracker-table');
  table.replaceChildren();
  const head = document.createElement('tr');
  head.innerHTML = '<th></th><th colspan="3">투자</th>' + [2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => `<th>${v}</th>`).join('') + '<th>미확인</th>';
  table.append(head);
  for (let c = 0; c < NUM_COLORS; c++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th class="h-${COLOR_KEYS[c]}">${COLOR_NAMES[c]}</th>`;
    for (let slot = 0; slot < 12; slot++) {
      const id = c * 12 + slot;
      const st = t.status[id];
      const td = document.createElement('td');
      td.className = `st st-${st} ${t.discardTop[id] ? 'top' : ''}`;
      td.textContent = STATUS_LABEL[st][0];
      td.title = `${cardName(id)}: ${STATUS_LABEL[st][1]}`;
      tr.append(td);
    }
    tr.insertAdjacentHTML('beforeend', `<td class="num"><b>${t.unseenByColor[c]}</b></td>`);
    table.append(tr);
  }
  $('tracker-legend').innerHTML = Object.entries(STATUS_LABEL)
    .map(([k, [short, long]]) => `<span class="lg"><span class="st st-${k}">${short || '&nbsp;'}</span>${long}</span>`)
    .join('');
}

function renderScoreTab() {
  // 보드와 같은 기준: 확정 전 놓기도 미리보기로 반영
  const v = view();
  const side = (exps) => {
    const colors = exps.map(expeditionBreakdown);
    return { colors, total: colors.reduce((t, x) => t + x.total, 0) };
  };
  const b = [side(v.myExps), side(ui.obs.oppExpeditions)];
  const table = $('breakdown-table');
  const cell = (x, f) => (x.started ? f(x) : '·');
  const rows = [`<tr><th></th>${COLOR_NAMES.map((n, i) => `<th class="h-${COLOR_KEYS[i]}">${n}</th>`).join('')}<th>합계</th></tr>`];
  for (const [label, side] of [['나', b[0]], ['AI', b[1]]]) {
    rows.push(`<tr class="sec"><th colspan="7">${label}</th></tr>`);
    rows.push(`<tr><th>숫자 합</th>${side.colors.map((x) => `<td>${cell(x, (y) => y.sum)}</td>`).join('')}<td></td></tr>`);
    rows.push(`<tr><th>비용</th>${side.colors.map((x) => `<td>${cell(x, () => '−20')}</td>`).join('')}<td></td></tr>`);
    rows.push(`<tr><th>배수</th>${side.colors.map((x) => `<td>${cell(x, (y) => `×${y.multiplier}`)}</td>`).join('')}<td></td></tr>`);
    rows.push(`<tr><th>장수·보너스</th>${side.colors.map((x) => `<td>${cell(x, (y) => (y.bonus ? `${y.count}장 +20` : `${y.count}장`))}</td>`).join('')}<td></td></tr>`);
    rows.push(`<tr class="total"><th>점수</th>${side.colors.map((x) => `<td>${cell(x, (y) => fmtScore(y.total))}</td>`).join('')}<td><b>${fmtScore(side.total)}</b></td></tr>`);
  }
  if (ui.pending?.target === EXPEDITION) rows.push('<tr><td colspan="7" class="muted">확정 전 놓기를 포함한 미리보기</td></tr>');
  table.innerHTML = rows.join('');
}

$('btn-analysis').onclick = () => setAnalysisOpen($('analysis').hidden);
$('btn-analyze').onclick = () => {
  if (!myTurn() || ui.analyzing) return;
  ui.analyzing = true;
  ui.analysis = null;
  render();
  worker.postMessage({ type: 'analyze' });
};
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => setTab(b.dataset.tab);
try {
  const tab = localStorage.getItem('lc-tab');
  if (tab === 'moves' || tab === 'tracker' || tab === 'score') ui.tab = tab;
  if (localStorage.getItem('lc-analysis') === '1') setAnalysisOpen(true);
} catch {}
