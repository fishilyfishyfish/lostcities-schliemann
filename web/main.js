// UI. 게임 진행은 worker.js(엔진)가 하고, 여기서는 사람 시점 관측 객체를 그리기만 한다.
// cards.js / scoring.js는 카드 표기와 점수 미리보기 계산용으로만 가져온다 (순수 함수, 상태 없음).
import { NUM_COLORS, cardColor, cardValue, isWager } from '../engine/cards.js';
import { expeditionScore } from '../engine/scoring.js';

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
};

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'update') {
    const prevTurn = ui.obs?.turn ?? -1;
    ui.obs = msg.obs;
    ui.legalMoves = msg.legalMoves;
    ui.final = msg.final;
    ui.error = null;
    if (msg.obs.turn !== prevTurn) {
      ui.selected = null;
      ui.pending = null;
    }
    render();
    if (ui.final) showResult();
  } else if (msg.type === 'error') {
    ui.error = msg.message;
    ui.pending = null;
    render();
  }
};

function newGame() {
  $('overlay').hidden = true;
  ui.obs = null;
  ui.selected = null;
  ui.pending = null;
  ui.final = null;
  worker.postMessage({ type: 'new' });
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
    button('취소', () => { ui.pending = null; render(); });
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
$('btn-again').onclick = newGame;
$('btn-close').onclick = () => { $('overlay').hidden = true; };

newGame();
