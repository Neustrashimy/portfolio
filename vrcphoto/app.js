/* global window, document, fetch */

"use strict";

/*
    公開向けギャラリー app.js
*/

/** @typedef {{ sha1: string, takenAt: string, worldId: (string|null) }} CatalogItem */
/** @typedef {{ worldId: string, worldName: string, note: (string|null|undefined) }} WorldInfo */
/** @typedef {{ items: CatalogItem[], worlds: WorldInfo[] }} Catalog */

// ─── 定数 ────────────────────────────────────────────────────────────────────

const CATALOG_URL = "./catalog.json";

const THUMB_W = 148;
const THUMB_H = 148;

const LAZY_ROOT_MARGIN = "700px 0px";
const LAZY_THRESHOLD   = 0.01;

// ワールドフィルタ用の特殊キー
const KEY_ALL     = "__all__";
const KEY_UNKNOWN = "__unknown__";

// localStorage キー
const LS_GROUP_BY_WORLD        = "vrc_gallery_group_by_world";
const LS_ORDER_BY_LAST_VISITED = "vrc_gallery_order_by_last_visited";

// ─── DOM参照（起動時に埋める） ────────────────────────────────────────────────

const el = {
    worldSelect:       /** @type {HTMLSelectElement}  */ (null),
    groupToggle:       /** @type {HTMLInputElement}   */ (null),
    orderToggle:       /** @type {HTMLInputElement}   */ (null),
    orderToggleLabel:  /** @type {HTMLElement}        */ (null),
    content:           /** @type {HTMLElement}        */ (null),
    status:            /** @type {HTMLElement}        */ (null),

    // モーダル（ポラロイド）
    modal:             /** @type {HTMLElement}        */ (null),
    modalPolaroid:     /** @type {HTMLElement}        */ (null),
    modalImage:        /** @type {HTMLImageElement}   */ (null),
    modalWorldName:    /** @type {HTMLAnchorElement}  */ (null),
    modalSha1:         /** @type {HTMLElement}        */ (null),
    modalTakenAt:      /** @type {HTMLElement}        */ (null),
    modalClose:        /** @type {HTMLElement}        */ (null),
};

// ─── 状態 ─────────────────────────────────────────────────────────────────────

const state = {
    /** @type {Catalog|null} */
    catalog: null,

    /** @type {IntersectionObserver|null} */
    thumbObserver: null,

    /** worldId -> { worldName, note } @type {Record<string, { worldName: string, note: string }>} */
    worldIdToInfo: Object.create(null),

    // グルーピング設定
    groupByWorld:       true,
    orderByLastVisited: true,

    // モーダル
    isModalOpen:      false,
    lastFocused:      /** @type {HTMLElement|null} */ (null),
    modalStandardSrc: "",
    modalThumbSrc:    "",

    // スクロール固定用
    scrollYBeforeModal:          0,
    bodyPaddingRightBeforeModal: "",
};

// ─── 起動 ─────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
    initElements();
    wireEvents();
    void main();
});

function initElements() {
    el.worldSelect      = mustGetEl("worldSelect");
    el.groupToggle      = mustGetEl("groupToggle");
    el.orderToggle      = mustGetEl("orderToggle");
    el.orderToggleLabel = mustGetEl("orderToggleLabel");
    el.content          = mustGetEl("content");
    el.status           = mustGetEl("status");

    el.modal            = mustGetEl("photoModal");
    el.modalPolaroid    = mustGetEl("modalPolaroid");
    el.modalImage       = mustGetEl("modalImage");
    el.modalWorldName   = /** @type {HTMLAnchorElement} */ (mustGetEl("modalWorldName"));
    el.modalSha1        = mustGetEl("modalSha1");
    el.modalTakenAt     = mustGetEl("modalTakenAt");
    el.modalClose       = mustGetEl("modalClose");

    // 初期状態は非表示
    el.modalPolaroid.hidden = true;
}

function wireEvents() {
    el.worldSelect.addEventListener("change", () => render());

    el.groupToggle.addEventListener("change", () => {
        state.groupByWorld = el.groupToggle.checked;
        saveBoolean(LS_GROUP_BY_WORLD, state.groupByWorld);
        updateOrderToggleEnabled();
        render();
    });

    el.orderToggle.addEventListener("change", () => {
        state.orderByLastVisited = el.orderToggle.checked;
        saveBoolean(LS_ORDER_BY_LAST_VISITED, state.orderByLastVisited);
        render();
    });

    el.modalClose.addEventListener("click", closeModal);

    // オーバーレイ（モーダル背景）クリックで閉じる
    el.modal.addEventListener("click", (ev) => {
        if (state.isModalOpen && ev.target === el.modal) closeModal();
    });

    // 画像クリックで新しいタブに開いてモーダルを閉じる
    el.modalImage.addEventListener("click", (ev) => {
        if (!state.isModalOpen) return;
        ev.stopPropagation();
        const url = el.modalImage.currentSrc || el.modalImage.src;
        if (url) {
            openInNewTab(url);
            closeModal(); // "戻る" ですぐ戻れるように
        }
    });

    // ESC で閉じる
    document.addEventListener("keydown", (ev) => {
        if (state.isModalOpen && ev.key === "Escape") {
            ev.preventDefault();
            closeModal();
        }
    });
}

async function main() {
    try {
        setStatus("loading catalog...");
        state.catalog = await loadCatalog(CATALOG_URL);

        // 後方互換の吸収（note:null、TZなし日時など）
        normalizeCatalogData(state.catalog);

        state.worldIdToInfo = buildWorldIdToInfo(state.catalog);
        initWorldSelect(state.catalog, state.worldIdToInfo);

        // グルーピング設定を復元（デフォルトON）
        state.groupByWorld       = loadBoolean(LS_GROUP_BY_WORLD,        true);
        state.orderByLastVisited = loadBoolean(LS_ORDER_BY_LAST_VISITED, true);
        el.groupToggle.checked   = state.groupByWorld;
        el.orderToggle.checked   = state.orderByLastVisited;

        updateOrderToggleEnabled();

        setStatus(`items=${state.catalog.items.length}`);
        render();
    } catch (e) {
        console.error(e);
        setStatus("failed to load catalog. (is catalog.json present?)");
    }
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

/**
 * getElementById のラッパー（要素が存在しない場合は即エラー）
 * @param {string} id
 * @returns {HTMLElement}
 */
function mustGetEl(id) {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing element: #${id}`);
    return found;
}

/** ステータスバーにテキストを表示 */
const setStatus = (text) => { el.status.textContent = text; };

/**
 * グルーピングON時だけ「最後に訪れた順」を有効にする
 */
function updateOrderToggleEnabled() {
    const enabled = state.groupByWorld;
    el.orderToggle.disabled = !enabled;
    el.orderToggleLabel.classList.toggle("is-disabled", !enabled);
}

// ─── localStorage（boolean の読み書き） ──────────────────────────────────────

/**
 * boolean を "1"/"0" として保存
 * @param {string} key
 * @param {boolean} value
 */
function saveBoolean(key, value) {
    try {
        window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
        // localStorage が使えない環境でも動作継続
    }
}

/**
 * "1"/"0" で保存された boolean を読み込む
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function loadBoolean(key, defaultValue) {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === "1") return true;
        if (raw === "0") return false;
        return defaultValue;
    } catch {
        return defaultValue;
    }
}

// ─── カタログ 読み込み・正規化 ────────────────────────────────────────────────

/**
 * catalog.json を fetch して返す
 * @param {string} url
 * @returns {Promise<Catalog>}
 */
async function loadCatalog(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);

    const data = await res.json();
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.worlds)) {
        throw new Error("Invalid catalog shape");
    }
    return /** @type {Catalog} */ (data);
}

/**
 * 後方互換の正規化（旧データの note:null、TZなし日時を吸収）
 * @param {Catalog} catalog
 */
function normalizeCatalogData(catalog) {
    for (const w of catalog.worlds) {
        if (!w) continue;
        // note: null/undefined/非文字列 → 文字列に統一
        if (w.note == null)                  w.note = "";
        else if (typeof w.note !== "string") w.note = String(w.note);
    }

    for (const it of catalog.items) {
        if (!it || typeof it.takenAt !== "string") continue;
        // TZなし → +09:00 として補完
        if (!hasTimezoneSuffix(it.takenAt)) it.takenAt += "+09:00";
    }
}

/**
 * 文字列の末尾にタイムゾーン表記があるか判定
 * （Z / +09:00 / +0900 / -05:00 などに対応）
 * @param {string} text
 * @returns {boolean}
 */
const hasTimezoneSuffix = (text) => /([zZ]|[+\-]\d\d:?\d\d)$/.test(text);

/**
 * worldId -> { worldName, note } の辞書を構築
 * @param {Catalog} catalog
 * @returns {Record<string, { worldName: string, note: string }>}
 */
function buildWorldIdToInfo(catalog) {
    const dict = Object.create(null);
    for (const w of catalog.worlds) {
        if (!w?.worldId || !w.worldName) continue;
        dict[w.worldId] = {
            worldName: w.worldName,
            note: typeof w.note === "string" ? w.note : "",
        };
    }
    return dict;
}

// ─── ワールドセレクト ─────────────────────────────────────────────────────────

/**
 * ワールドセレクトボックスを初期化
 * @param {Catalog} catalog
 * @param {Record<string, { worldName: string }>} worldIdToInfo
 */
function initWorldSelect(catalog, worldIdToInfo) {
    el.worldSelect.innerHTML = "";
    addOption(el.worldSelect, KEY_ALL, "All worlds");

    const sorted = Object.entries(worldIdToInfo)
        .map(([id, info]) => ({ id, name: info.worldName }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    for (const { id, name } of sorted) {
        addOption(el.worldSelect, id, name);
    }

    if (catalog.items.some(it => !it.worldId)) {
        addOption(el.worldSelect, KEY_UNKNOWN, "(unknown)");
    }
}

/**
 * select に option を追加するヘルパー
 */
function addOption(select, value, label) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
}

// ─── 再描画 ───────────────────────────────────────────────────────────────────

function render() {
    if (!state.catalog) return;

    // ThumbObserver をリセット
    state.thumbObserver?.disconnect();
    state.thumbObserver = createThumbObserver();

    const worldFilter = el.worldSelect.value;

    // フィルタ（元の配列を破壊しないようにコピー）
    let items = state.catalog.items.slice();
    if      (worldFilter === KEY_UNKNOWN) items = items.filter(it => !it.worldId);
    else if (worldFilter !== KEY_ALL)     items = items.filter(it => it.worldId === worldFilter);

    // 新しい順固定（公開側は desc 固定）
    items.sort((a, b) => b.takenAt.localeCompare(a.takenAt));

    el.content.innerHTML = "";

    if (state.groupByWorld) renderGrouped(items);
    else                    renderFlat(items);

    setStatus(`showing ${items.length} items`);
}

// ─── グループ描画 ─────────────────────────────────────────────────────────────

/**
 * ワールドごとにグルーピングして描画
 * @param {CatalogItem[]} items  takenAt desc 済みのアイテム
 */
function renderGrouped(items) {
    // items は takenAt desc 済みなので groups[key][0] がそのワールドの最新
    const groups = groupItemsByWorldKey(items);
    const keys   = Object.keys(groups);

    // 各グループの「最後に訪れた」時刻（先頭要素の takenAt）
    const lastVisitedMs = Object.fromEntries(
        keys.map(k => [k, toTimeValue(groups[k][0]?.takenAt)])
    );

    // グループキーをソート
    const comparator = state.orderByLastVisited
        ? (a, b) => compareByLastVisited(a, b, lastVisitedMs)
        : (a, b) => compareByName(a, b);

    keys.sort(comparator);

    keys.forEach((key, i) => {
        const groupItems = groups[key].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
        const worldId    = key === KEY_UNKNOWN ? null : key;
        const worldName  = resolveWorldName(key);
        const worldNote  = resolveWorldNote(key);

        el.content.appendChild(renderWorldSection(worldName, worldId, worldNote, groupItems));

        // ワールド間の区切り線（最後のグループには不要）
        if (i < keys.length - 1) el.content.appendChild(renderWorldDivider());
    });
}

/**
 * グルーピングなし：全件を1グリッドで描画
 * @param {CatalogItem[]} items
 */
function renderFlat(items) {
    const grid = document.createElement("div");
    grid.className = "grid";

    for (const it of items) {
        const worldId   = it.worldId ?? null;
        const worldKey  = worldId ?? KEY_UNKNOWN;
        const worldName = resolveWorldName(worldKey);
        grid.appendChild(renderCard(it, worldName, worldId));
    }

    el.content.appendChild(grid);
}

// ─── グループ化ヘルパー ───────────────────────────────────────────────────────

/**
 * アイテムを worldId キーでグルーピング
 * @param {CatalogItem[]} items
 * @returns {Record<string, CatalogItem[]>}
 */
function groupItemsByWorldKey(items) {
    const groups = Object.create(null);
    for (const it of items) {
        const key = it.worldId ?? KEY_UNKNOWN;
        (groups[key] ??= []).push(it);
    }
    return groups;
}

/**
 * ワールドキーをワールド名順で比較（KEY_UNKNOWN は末尾固定）
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareByName(a, b) {
    if (a === KEY_UNKNOWN) return  1;
    if (b === KEY_UNKNOWN) return -1;
    const c = resolveWorldName(a).localeCompare(resolveWorldName(b), "ja");
    return c !== 0 ? c : a.localeCompare(b); // 同名の場合はIDで安定ソート
}

/**
 * ワールドキーを「最後に訪れた順」で比較（同時刻はワールド名順）
 * @param {string} a
 * @param {string} b
 * @param {Record<string, number>} lastVisitedMs
 * @returns {number}
 */
function compareByLastVisited(a, b, lastVisitedMs) {
    if (a === KEY_UNKNOWN) return  1;
    if (b === KEY_UNKNOWN) return -1;
    const diff = (lastVisitedMs[b] ?? 0) - (lastVisitedMs[a] ?? 0);
    return diff !== 0 ? diff : compareByName(a, b);
}

/**
 * takenAt 文字列をミリ秒に変換（パース失敗は 0）
 * @param {string} takenAt
 * @returns {number}
 */
function toTimeValue(takenAt) {
    const t = Date.parse(takenAt);
    return Number.isNaN(t) ? 0 : t;
}

// ─── ワールド情報解決 ─────────────────────────────────────────────────────────

/**
 * worldKey から表示名を解決
 * @param {string} worldKey
 * @returns {string}
 */
function resolveWorldName(worldKey) {
    if (worldKey === KEY_UNKNOWN) return "(unknown)";
    const info = state.worldIdToInfo[worldKey];
    return info?.worldName || worldKey;
}

/**
 * worldKey から note を解決
 * @param {string} worldKey
 * @returns {string}
 */
function resolveWorldNote(worldKey) {
    if (worldKey === KEY_UNKNOWN) return "";
    return state.worldIdToInfo[worldKey]?.note ?? "";
}

// ─── セクション・カード描画 ───────────────────────────────────────────────────

/**
 * ワールドセクション（h2 + note + grid）を生成
 * @param {string}        worldName
 * @param {string|null}   worldId
 * @param {string}        worldNote
 * @param {CatalogItem[]} items
 * @returns {HTMLElement}
 */
function renderWorldSection(worldName, worldId, worldNote, items) {
    const wrap = document.createElement("section");
    wrap.className = "world-section";

    // 見出し（worldId がある場合はリンク化）
    const h = document.createElement("h2");
    h.className = "world-title";

    if (worldId) {
        const a = document.createElement("a");
        a.className   = "world-title__link";
        a.href        = `https://vrchat.com/home/world/${worldId}/info`;
        a.textContent = worldName;
        a.target      = "_blank";
        a.rel         = "noopener";
        h.appendChild(a);
    } else {
        h.textContent = worldName;
    }

    const countSpan = document.createElement("span");
    countSpan.className   = "world-title__count";
    countSpan.textContent = `  (${items.length})`;
    h.appendChild(countSpan);

    wrap.appendChild(h);

    // 備考（空文字は未設定とみなして非表示）
    if (worldNote) {
        const noteEl = document.createElement("div");
        noteEl.className   = "world-note";
        noteEl.textContent = worldNote;
        wrap.appendChild(noteEl);
    }

    const grid = document.createElement("div");
    grid.className = "grid";
    for (const it of items) grid.appendChild(renderCard(it, worldName, worldId));

    wrap.appendChild(grid);
    return wrap;
}

/**
 * ワールド区切り線（hr）を生成
 * @returns {HTMLHRElement}
 */
function renderWorldDivider() {
    const hr = document.createElement("hr");
    hr.className = "world-divider";
    return hr;
}

/**
 * サムネカードを生成
 * @param {CatalogItem} it
 * @param {string}      worldName
 * @param {string|null} worldId
 * @returns {HTMLElement}
 */
function renderCard(it, worldName, worldId) {
    const card = document.createElement("div");
    card.className = "card";

    // サムネ画像（lazy-load）
    const img = document.createElement("img");
    img.className   = "thumb";
    img.alt         = it.sha1;
    img.width       = THUMB_W;
    img.height      = THUMB_H;
    img.dataset.src = buildThumbPath(it.sha1);
    state.thumbObserver?.observe(img);

    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "thumb-button";
    btn.addEventListener("click", () => openModal(it, worldName, worldId));
    btn.appendChild(img);

    // メタ情報（sha1の先頭8文字 + 撮影日時）
    const meta = document.createElement("div");
    meta.className = "meta";

    const sha1El = document.createElement("div");
    sha1El.className   = "meta__sha1";
    sha1El.textContent = it.sha1.slice(0, 8);

    const takenAtEl = document.createElement("div");
    takenAtEl.className   = "meta__takenat";
    takenAtEl.textContent = it.takenAt;

    meta.appendChild(sha1El);
    meta.appendChild(takenAtEl);

    card.appendChild(btn);
    card.appendChild(meta);
    return card;
}

// ─── Lazy-load ────────────────────────────────────────────────────────────────

/**
 * 画像遅延読み込み用の IntersectionObserver を生成
 * （未対応ブラウザでは即時読み込みにフォールバック）
 * @returns {IntersectionObserver}
 */
function createThumbObserver() {
    if (!("IntersectionObserver" in window)) {
        return { observe: loadImgNow, unobserve: () => {}, disconnect: () => {} };
    }

    return new IntersectionObserver(
        (entries, observer) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                loadImgNow(/** @type {HTMLImageElement} */ (entry.target));
                observer.unobserve(entry.target);
            }
        },
        { root: null, rootMargin: LAZY_ROOT_MARGIN, threshold: LAZY_THRESHOLD }
    );
}

/**
 * data-src を src に昇格して読み込み開始
 * @param {HTMLImageElement} img
 */
function loadImgNow(img) {
    const src = img.dataset.src;
    if (!src || img.src) return;
    img.src = src;
    img.addEventListener("error", () => {
        img.removeAttribute("src");
        img.style.visibility = "hidden";
    }, { once: true });
}

// ─── パス生成 ─────────────────────────────────────────────────────────────────

/** thumbs の相対パスを構築 */
const buildThumbPath    = (sha1) => `./thumbs/${sha1.slice(0, 2)}/${sha1}.webp`;

/** standard の相対パスを構築 */
const buildStandardPath = (sha1) => `./standard/${sha1.slice(0, 2)}/${sha1}.webp`;

// ─── モーダル（ポラロイド） ───────────────────────────────────────────────────

/**
 * モーダルを開く
 * @param {CatalogItem} it
 * @param {string}      worldName
 * @param {string|null} worldId
 */
function openModal(it, worldName, worldId) {
    state.lastFocused = /** @type {HTMLElement} */ (document.activeElement);

    setModalWorldLink(worldName, worldId);
    el.modalSha1.textContent    = it.sha1.slice(0, 8);
    el.modalTakenAt.textContent = it.takenAt;

    state.isModalOpen      = true;
    state.modalStandardSrc = buildStandardPath(it.sha1);
    state.modalThumbSrc    = buildThumbPath(it.sha1);

    // standard を優先して表示し、失敗したらサムネにフォールバック
    setImageWithFallback(el.modalImage, state.modalStandardSrc, state.modalThumbSrc);

    el.modalPolaroid.hidden = false;
    el.modal.classList.add("is-open");
    el.modal.setAttribute("aria-hidden", "false");

    lockScroll();
    el.modalClose.focus();
}

/**
 * モーダルを閉じる
 */
function closeModal() {
    if (!state.isModalOpen) return;

    state.isModalOpen = false;
    el.modal.classList.remove("is-open");
    el.modal.setAttribute("aria-hidden", "true");

    unlockScroll();
    clearImage(el.modalImage);

    // 次回表示までコンテンツを隠す
    el.modalPolaroid.hidden = true;

    state.modalStandardSrc = "";
    state.modalThumbSrc    = "";

    state.lastFocused?.focus();
    state.lastFocused = null;
}

/**
 * モーダルのワールド名リンクを設定
 * @param {string}      worldName
 * @param {string|null} worldId
 */
function setModalWorldLink(worldName, worldId) {
    el.modalWorldName.textContent = worldName;

    if (worldId) {
        el.modalWorldName.href   = `https://vrchat.com/home/world/${worldId}/info`;
        el.modalWorldName.target = "_blank";
        el.modalWorldName.rel    = "noopener";
    } else {
        // href なしにしてリンク表示を無効化（CSS で :not([href]) 対応）
        el.modalWorldName.removeAttribute("href");
        el.modalWorldName.removeAttribute("target");
        el.modalWorldName.removeAttribute("rel");
    }
}

// ─── スクロール固定（body fixed 方式） ───────────────────────────────────────

function lockScroll() {
    state.scrollYBeforeModal = window.scrollY || 0;

    // スクロールバー消滅による横ガタつきを補正
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    state.bodyPaddingRightBeforeModal = document.body.style.paddingRight || "";
    if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    document.body.style.position = "fixed";
    document.body.style.top      = `-${state.scrollYBeforeModal}px`;
    document.body.style.left     = "0";
    document.body.style.right    = "0";
    document.body.style.width    = "100%";

    document.documentElement.classList.add("is-modal-open");
}

function unlockScroll() {
    document.body.style.position     = "";
    document.body.style.top          = "";
    document.body.style.left         = "";
    document.body.style.right        = "";
    document.body.style.width        = "";
    document.body.style.paddingRight = state.bodyPaddingRightBeforeModal;

    state.bodyPaddingRightBeforeModal = "";
    document.documentElement.classList.remove("is-modal-open");

    window.scrollTo(0, state.scrollYBeforeModal);
}

// ─── 画像ヘルパー ─────────────────────────────────────────────────────────────

/**
 * primarySrc を優先して読み込み、失敗したら fallbackSrc を表示
 * @param {HTMLImageElement} img
 * @param {string} primarySrc
 * @param {string} fallbackSrc
 */
function setImageWithFallback(img, primarySrc, fallbackSrc) {
    img.onerror = null;
    img.src     = "";
    img.onerror = () => {
        img.onerror = null;
        img.src     = fallbackSrc;
    };
    img.src = primarySrc;
}

/**
 * img の src と onerror をリセット
 * @param {HTMLImageElement} img
 */
function clearImage(img) {
    img.onerror = null;
    img.src     = "";
}

// ─── 新しいタブで開く ─────────────────────────────────────────────────────────

/**
 * URL を新しいタブで開く
 * @param {string} url
 */
function openInNewTab(url) {
    const a = Object.assign(document.createElement("a"), {
        href: url, target: "_blank", rel: "noopener noreferrer",
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
}