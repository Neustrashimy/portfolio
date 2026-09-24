// =====================================================================
// 設定
// =====================================================================

// 世代の並び順（上から下へ表示する順番）
const STAGES = ['幼年期I', '幼年期II', '成長期', '成熟期', 'アーマー体', '完全体', '究極体', '超究極体'];
const OTHER_STAGE = 'その他';      // 世代が空、または上の一覧に無いもの
const UNFOUND_STAGE = '未発見';    // 進化先に名前はあるが、CSVに行が無いもの

// 進化先が分からないことを表す記号（全角・半角どちらも可）
const UNKNOWN_MARKS = ['？？？', '???'];

// 種族の並び順と、色分け用のクラス名
const RACES = [
  { name: 'ワクチン', className: 'race-vaccine' },
  { name: 'データ',   className: 'race-data' },
  { name: 'ウィルス', className: 'race-virus' },
  { name: 'フリー',   className: 'race-free' },
];

// 属性の並び順（絞り込みの選択肢に使う）
const ATTRS = ['火', '水', '草木', '電気', '風', '地面', '光', '闇', '無'];

// 進化データのCSVファイル（このHTMLと同じフォルダに置く）
const DATA_URL = './data.csv';

// localStorage に保存するときのキー名
const STORAGE_KEY_MODE = 'digimon-map-mode';

// =====================================================================
// 状態（アプリ全体で使う変数）
// =====================================================================

const state = {
  digimon: [],          // [{ name, stage, race, attr, no }]
  nextMap: new Map(),   // 名前 → 進化先の名前の配列
  unknownMap: new Map(),// 名前 → 進化先「？？？」の件数
  prevMap: new Map(),   // 名前 → 進化元（退化先）の名前の配列
  selected: null,       // 選択中のデジモン名
  hovered: null,        // マウスを乗せているデジモン名（ルート強調用）
  mode: 'direct',       // 'direct'（直接のみ） または 'all'（全系統）
  filterRace: '',       // 絞り込み中の種族（'' はすべて）
  filterAttr: '',       // 絞り込み中の属性（'' はすべて）
};

// よく使う要素
const el = {
  bands: document.getElementById('bands'),
  map: document.getElementById('map'),
  svg: document.getElementById('lines'),
  info: document.getElementById('info'),
  search: document.getElementById('search'),
  names: document.getElementById('names'),
  modeDirect: document.getElementById('mode-direct'),
  modeAll: document.getElementById('mode-all'),
  notice: document.getElementById('notice'),
  filterRace: document.getElementById('filter-race'),
  filterAttr: document.getElementById('filter-attr'),
};

// =====================================================================
// localStorage（使えない環境でもエラーにならないよう try/catch で包む）
// =====================================================================

function loadSetting(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動作は続ける */ }
}

// =====================================================================
// CSV の読み込み
// =====================================================================

/**
 * CSV文字列を解析して、デジモン一覧と進化関係を作る。
 * 戻り値: { digimon, nextMap, prevMap, unknownMap, warnings }
 */
function parseCsv(text) {
  const digimon = [];
  const nextMap = new Map();
  const unknownMap = new Map();
  const warnings = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '') return;                       // 空行は飛ばす

    const cells = line.split(',').map(c => c.trim());
    // 列の順番：世代, デジモン名, 進化先一覧, 種族, 属性, 番号
    const stage = cells[0];
    const name = cells[1] || '';
    const nextText = cells[2] || '';
    const race = cells[3] || '';
    const attr = cells[4] || '';
    const no = parseInt(cells[5], 10);             // 数字でなければ NaN になる

    if (index === 0 && stage === '世代') return;   // 見出し行は飛ばす
    if (name === '') return;

    if (nextMap.has(name)) {
      warnings.push(`「${name}」が2回以上書かれています（${index + 1}行目は無視）`);
      return;
    }

    // 「/」または全角「／」で区切って進化先の配列にする
    const allNext = nextText.split(/[\/／]/).map(s => s.trim()).filter(s => s !== '');
    // 「？？？」は件数だけ数えて、進化先の一覧からは外す
    const nextNames = allNext.filter(n => !UNKNOWN_MARKS.includes(n));
    const unknownCount = allNext.length - nextNames.length;

    digimon.push({
      name: name,
      stage: STAGES.includes(stage) ? stage : OTHER_STAGE,
      race: race,
      attr: attr,
      no: Number.isNaN(no) ? null : no,
    });
    nextMap.set(name, nextNames);
    unknownMap.set(name, unknownCount);
  });

  // 進化先に書かれているのに、行が存在しないデジモンを「未発見」に追加する
  const missing = new Set();
  nextMap.forEach(nextNames => {
    nextNames.forEach(n => { if (!nextMap.has(n)) missing.add(n); });
  });
  missing.forEach(n => {
    digimon.push({ name: n, stage: UNFOUND_STAGE, race: '', attr: '', no: null });
    nextMap.set(n, []);
    unknownMap.set(n, 0);
  });

  // 進化先の逆向きを集めて「進化元（退化先）」を作る
  const prevMap = new Map();
  digimon.forEach(d => prevMap.set(d.name, []));
  nextMap.forEach((nextNames, from) => {
    nextNames.forEach(to => prevMap.get(to).push(from));
  });

  return { digimon, nextMap, prevMap, unknownMap, warnings };
}

/** メッセージ欄に表示する（空文字なら隠す） */
function showNotice(message) {
  el.notice.textContent = message;
  el.notice.hidden = (message === '');
}

/** CSV を解析して画面に反映する */
function applyCsv(text) {
  const result = parseCsv(text);
  if (result.digimon.length === 0) {
    showNotice(`${DATA_URL} からデジモンが1体も読み込めませんでした。「世代,デジモン名,進化先一覧,種族,属性,番号」の形式か確認してください。`);
    return;
  }
  state.digimon = result.digimon;
  state.nextMap = result.nextMap;
  state.prevMap = result.prevMap;
  state.unknownMap = result.unknownMap;

  // CSVの書き間違いに気付けるよう、注意点があれば表示する
  showNotice(result.warnings.length ? '注意：' + result.warnings.join(' ／ ') : '');

  renderFilterOptions();
  renderBands();
  renderNameList();
  applyFilter();
  updateSelection();
}

/** data.csv を読み込む */
async function loadData() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });  // 更新がすぐ反映されるようキャッシュを使わない
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = (await response.text()).replace(/^\uFEFF/, '');     // Excel の BOM を取り除く
    applyCsv(text);
  } catch (e) {
    // HTMLファイルを直接ダブルクリックで開いた場合（file://）も、ここに来る
    showNotice(`${DATA_URL} を読み込めませんでした（${e.message}）。ファイルがHTMLと同じフォルダにあるか、Webサーバー経由で開いているか確認してください。`);
    renderInfo(null);
  }
}

// =====================================================================
// 画面の描画
// =====================================================================

/** 世代ごとの帯と、その中のデジモンを描画する */
function renderBands() {
  el.bands.innerHTML = '';
  const allStages = [...STAGES, OTHER_STAGE, UNFOUND_STAGE];

  allStages.forEach(stage => {
    const members = state.digimon.filter(d => d.stage === stage).sort(compareByNumber);
    if (members.length === 0) return;             // 誰もいない世代は表示しない

    const band = document.createElement('section');
    band.className = 'band';

    const label = document.createElement('div');
    label.className = 'band-label';
    label.innerHTML = `${stage}<span class="band-count">${members.length} 体</span>`;

    const nodes = document.createElement('div');
    nodes.className = 'nodes';
    members.forEach(d => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'node';
      btn.dataset.name = d.name;

      // 種族が分かるものは、名前の前に種族の色の丸を付ける
      const race = RACES.find(r => r.name === d.race);
      if (race) {
        const dot = document.createElement('span');
        dot.className = `race-dot ${race.className}`;
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(d.name));
      btn.addEventListener('click', () => selectDigimon(d.name, false));
      // マウスを乗せる（またはTabキーで移動する）と、選択中デジモンとのルートを強調
      btn.addEventListener('mouseenter', () => setHovered(d.name));
      btn.addEventListener('mouseleave', () => setHovered(null));
      btn.addEventListener('focus', () => setHovered(d.name));
      btn.addEventListener('blur', () => setHovered(null));
      nodes.appendChild(btn);
    });

    band.appendChild(label);
    band.appendChild(nodes);
    el.bands.appendChild(band);
  });
}

/** 番号の小さい順に並べるための比較関数（番号が無いものは最後、同じなら名前順） */
function compareByNumber(a, b) {
  const noA = (a.no === null) ? Infinity : a.no;
  const noB = (b.no === null) ? Infinity : b.no;
  if (noA !== noB) return noA - noB;
  return a.name.localeCompare(b.name, 'ja');
}

/** 検索欄の候補リストを作る */
function renderNameList() {
  el.names.innerHTML = '';
  state.digimon.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.name;
    el.names.appendChild(opt);
  });
}

// =====================================================================
// 選択と強調表示
// =====================================================================

/**
 * start から map をたどって到達できる名前をすべて集める（幅優先探索）。
 * 同時に、たどった線（from → to）も集める。
 */
function collectReachable(start, map) {
  const visited = new Set();
  const edges = [];
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    (map.get(current) || []).forEach(next => {
      edges.push([current, next]);
      if (!visited.has(next) && next !== start) {
        visited.add(next);
        queue.push(next);
      }
    });
  }
  return { names: visited, edges };
}

/** 選択中デジモンから、強調するデジモンと線を計算する */
function computeHighlight() {
  const name = state.selected;
  const directNext = state.nextMap.get(name) || [];
  const directPrev = state.prevMap.get(name) || [];

  if (state.mode === 'direct') {
    return {
      nextNames: new Set(directNext),
      prevNames: new Set(directPrev),
      evoEdges: directNext.map(n => [name, n]),
      devoEdges: directPrev.map(p => [p, name]),
    };
  }

  // 全系統：進化先を最後まで、退化先を最初までたどる
  const down = collectReachable(name, state.nextMap);
  const up = collectReachable(name, state.prevMap);
  return {
    nextNames: down.names,
    prevNames: up.names,
    evoEdges: down.edges,
    // 退化方向は prevMap でたどったので、線の向き（進化元→進化先）に直す
    devoEdges: up.edges.map(([child, parent]) => [parent, child]),
  };
}

/** デジモンを選択する（同じものを再度押すと解除） */
function selectDigimon(name, scroll) {
  state.selected = (state.selected === name) ? null : name;
  updateSelection();
  if (scroll && state.selected) {
    const node = findNode(state.selected);
    if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function findNode(name) {
  return el.bands.querySelector(`.node[data-name="${CSS.escape(name)}"]`);
}

/** 選択状態に合わせて、ノードの見た目・情報バー・線を更新する */
function updateSelection() {
  const nodes = el.bands.querySelectorAll('.node');
  nodes.forEach(n => n.classList.remove('is-selected', 'is-next', 'is-prev'));

  if (!state.selected) {
    el.map.classList.remove('has-selection');
    renderInfo(null);
    drawLines([], []);
    return;
  }

  const hl = computeHighlight();
  nodes.forEach(n => {
    const name = n.dataset.name;
    if (name === state.selected) n.classList.add('is-selected');
    else if (hl.nextNames.has(name)) n.classList.add('is-next');
    else if (hl.prevNames.has(name)) n.classList.add('is-prev');
  });
  el.map.classList.add('has-selection');
  renderInfo(hl);
  drawLines(hl.evoEdges, hl.devoEdges);
}

/** 上部の情報バーを描画する */
function renderInfo(hl) {
  if (!hl) {
    el.info.innerHTML = `
      <div class="info-head"><span class="none">デジモンを選ぶと、進化先（下方向）と退化先（上方向）を表示します。</span></div>
      <div class="legend"><span><i style="background:var(--evo)"></i>進化</span><span><i style="background:var(--devo)"></i>退化</span></div>`;
    return;
  }
  const d = state.digimon.find(x => x.name === state.selected);
  const head = document.createElement('div');
  head.className = 'info-head';
  head.innerHTML = `<span class="info-no"></span><span class="info-name"></span><span class="info-stage"></span>`;
  head.querySelector('.info-no').textContent = (d.no === null) ? '' : `No.${d.no}`;
  head.querySelector('.info-name').textContent = d.name;
  // 世代・種族・属性のうち、分かっているものだけを「／」でつなぐ
  head.querySelector('.info-stage').textContent = [d.stage, d.race, d.attr].filter(s => s !== '').join(' ／ ');

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'link-chip';
  clearBtn.textContent = '選択解除';
  clearBtn.addEventListener('click', () => selectDigimon(state.selected, false));
  head.appendChild(clearBtn);

  // 情報バーには常に「直接の」進化先・退化先を表示する
  const rowNext = makeInfoRow('進化先', 'evo', state.nextMap.get(d.name), state.unknownMap.get(d.name));
  const rowPrev = makeInfoRow('退化先', 'devo', state.prevMap.get(d.name), 0);

  el.info.innerHTML = '';
  el.info.append(head, rowNext, rowPrev);
}

/** 情報バーの1行（進化先 または 退化先）を作る。unknownCount は「？？？」の件数 */
function makeInfoRow(labelText, kind, names, unknownCount) {
  const row = document.createElement('div');
  row.className = 'info-row';
  const label = document.createElement('span');
  label.className = `info-label ${kind}`;
  label.textContent = labelText;
  row.appendChild(label);

  if ((!names || names.length === 0) && !unknownCount) {
    const none = document.createElement('span');
    none.className = 'none';
    none.textContent = 'なし';
    row.appendChild(none);
    return row;
  }
  names.forEach(n => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-chip';
    b.textContent = n;
    b.addEventListener('click', () => selectDigimon(n, true));
    row.appendChild(b);
  });
  if (unknownCount > 0) {
    const unknown = document.createElement('span');
    unknown.className = 'unknown';
    unknown.textContent = `？？？ ×${unknownCount}`;
    row.appendChild(unknown);
  }
  return row;
}

// =====================================================================
// 種族・属性での絞り込み
// =====================================================================

/**
 * データに出てくる値を、決めておいた順番（order）で並べて返す。
 * order に無い値は、データに出てきた順で後ろに付ける。
 */
function orderedValues(values, order) {
  const unique = [...new Set(values.filter(v => v !== ''))];
  const known = order.filter(v => unique.includes(v));
  const others = unique.filter(v => !order.includes(v));
  return [...known, ...others];
}

/** 絞り込みの選択肢を、読み込んだデータから作る */
function renderFilterOptions() {
  const races = orderedValues(state.digimon.map(d => d.race), RACES.map(r => r.name));
  const attrs = orderedValues(state.digimon.map(d => d.attr), ATTRS);
  fillSelect(el.filterRace, '種族：すべて', races);
  fillSelect(el.filterAttr, '属性：すべて', attrs);
}

function fillSelect(select, allLabel, values) {
  select.innerHTML = '';
  select.appendChild(new Option(allLabel, ''));
  values.forEach(v => select.appendChild(new Option(v, v)));
}

/** 絞り込み条件に合わないデジモンを薄く表示する */
function applyFilter() {
  state.digimon.forEach(d => {
    const node = findNode(d.name);
    if (!node) return;
    const raceOk = (state.filterRace === '' || d.race === state.filterRace);
    const attrOk = (state.filterAttr === '' || d.attr === state.filterAttr);
    node.classList.toggle('is-filtered-out', !(raceOk && attrOk));
  });
}

// =====================================================================
// 線の描画（SVG）
// =====================================================================

let lastEdges = { evo: [], devo: [] };

/** 進化元の下端 → 進化先の上端 を曲線で結ぶ */
function drawLines(evoEdges, devoEdges) {
  lastEdges = { evo: evoEdges, devo: devoEdges };
  const mapRect = el.map.getBoundingClientRect();
  el.svg.setAttribute('width', mapRect.width);
  el.svg.setAttribute('height', mapRect.height);
  el.svg.innerHTML = '';

  const addPath = (from, to, color) => {
    const a = findNode(from);
    const b = findNode(to);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const x1 = ra.left + ra.width / 2 - mapRect.left;
    const y1 = ra.bottom - mapRect.top;
    const x2 = rb.left + rb.width / 2 - mapRect.left;
    const y2 = rb.top - mapRect.top;
    const bend = Math.max(24, Math.abs(y2 - y1) / 2);   // 曲がり具合

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`);
    path.setAttribute('fill', 'none');
    path.style.stroke = color;   // CSS変数を使うため属性ではなく style で指定
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-opacity', '0.75');
    path.dataset.from = from;    // ルート強調のときに、どの線か判別するため
    path.dataset.to = to;
    el.svg.appendChild(path);
  };

  devoEdges.forEach(([from, to]) => addPath(from, to, 'var(--devo)'));
  evoEdges.forEach(([from, to]) => addPath(from, to, 'var(--evo)'));

  applyPathHighlight();   // 線を描き直すと強調が消えるので、付け直す
}

// =====================================================================
// ルートの強調（マウスを乗せたデジモン ⇔ 選択中デジモン）
// =====================================================================

function setHovered(name) {
  state.hovered = name;
  applyPathHighlight();
}

/**
 * edges（[進化元, 進化先] の配列）だけを使って、start からたどれる名前を集める。
 * direction が 'forward' なら進化方向、'backward' なら退化方向にたどる。
 */
function reachableByEdges(start, edges, direction) {
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    edges.forEach(([from, to]) => {
      let next = null;
      if (direction === 'forward' && from === current) next = to;
      if (direction === 'backward' && to === current) next = from;
      if (next !== null && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    });
  }
  return visited;
}

/**
 * 選択中デジモンと target の間のルート上にある名前を返す。
 * ルートが無ければ null。
 * 考え方：「上側から進化方向にたどれる」かつ「下側から退化方向にたどれる」名前がルート上にある。
 */
function computePathNodes(target) {
  const selected = state.selected;
  if (!selected || !target || target === selected) return null;

  const node = findNode(target);
  if (!node) return null;

  // 画面に描かれている線だけを使う（表示モードと結果を一致させるため）
  const edges = [...lastEdges.evo, ...lastEdges.devo];

  let upper, lower;
  if (node.classList.contains('is-next')) {        // 進化先側にある
    upper = selected; lower = target;
  } else if (node.classList.contains('is-prev')) { // 退化先側にある
    upper = target; lower = selected;
  } else {
    return null;                                   // 関係の無いデジモン
  }

  const fromUpper = reachableByEdges(upper, edges, 'forward');
  const toLower = reachableByEdges(lower, edges, 'backward');
  return new Set([...fromUpper].filter(n => toLower.has(n)));
}

/** ルート上の線とデジモンに目印のクラスを付ける（ルートが無ければ外す） */
function applyPathHighlight() {
  const pathNodes = computePathNodes(state.hovered);
  el.map.classList.toggle('has-path', pathNodes !== null);

  el.bands.querySelectorAll('.node').forEach(n => {
    n.classList.toggle('is-on-path', pathNodes !== null && pathNodes.has(n.dataset.name));
  });
  el.svg.querySelectorAll('path').forEach(p => {
    const onPath = pathNodes !== null && pathNodes.has(p.dataset.from) && pathNodes.has(p.dataset.to);
    p.classList.toggle('on-path', onPath);
  });
}

// 画面サイズが変わるとノードの位置も変わるので、線を描き直す
new ResizeObserver(() => drawLines(lastEdges.evo, lastEdges.devo)).observe(el.map);

// =====================================================================
// 操作イベント
// =====================================================================

// 表示モードの切り替え
function setMode(mode) {
  state.mode = mode;
  el.modeDirect.setAttribute('aria-pressed', String(mode === 'direct'));
  el.modeAll.setAttribute('aria-pressed', String(mode === 'all'));
  saveSetting(STORAGE_KEY_MODE, mode);
  updateSelection();
}
el.modeDirect.addEventListener('click', () => setMode('direct'));
el.modeAll.addEventListener('click', () => setMode('all'));

// 検索：候補から選ぶか Enter で、その名前のデジモンを選択
function trySearch() {
  const name = el.search.value.trim();
  if (!state.nextMap.has(name)) return;
  state.selected = null;           // selectDigimon は同名で解除になるため一度リセット
  selectDigimon(name, true);
  el.search.value = '';
}
el.search.addEventListener('change', trySearch);

// 種族・属性の絞り込み
el.filterRace.addEventListener('change', () => {
  state.filterRace = el.filterRace.value;
  applyFilter();
});
el.filterAttr.addEventListener('change', () => {
  state.filterAttr = el.filterAttr.value;
  applyFilter();
});
el.search.addEventListener('keydown', e => { if (e.key === 'Enter') trySearch(); });

// =====================================================================
// 起動
// =====================================================================

const savedMode = loadSetting(STORAGE_KEY_MODE);
if (savedMode === 'all' || savedMode === 'direct') state.mode = savedMode;
el.modeDirect.setAttribute('aria-pressed', String(state.mode === 'direct'));
el.modeAll.setAttribute('aria-pressed', String(state.mode === 'all'));

loadData();

// フォント読み込み後にノードの幅が変わるので、線を描き直す
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => drawLines(lastEdges.evo, lastEdges.devo));
}
