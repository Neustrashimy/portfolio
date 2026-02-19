/* global window, document, fetch */

"use strict";

/** @typedef {{ sha1: string, takenAt: string, worldId: (string|null) }} CatalogItem */
/** @typedef {{ worldId: string, worldName: string }} WorldInfo */
/** @typedef {{ items: CatalogItem[], worlds: WorldInfo[] }} Catalog */

class Settings {
    constructor() {
        /** @type {string} */
        this.catalog_url = "./catalog.json";

        /** @type {number} */
        this.thumb_w = 148;
        /** @type {number} */
        this.thumb_h = 148;

        /** @type {string} */
        this.lazy_root_margin = "700px 0px";
        /** @type {number} */
        this.lazy_threshold = 0.01;

        /** @type {string} */
        this.key_all = "__all__";
        /** @type {string} */
        this.key_unknown = "__unknown__";
    }
}

class Elements {
    constructor() {
        /** @type {HTMLSelectElement} */
        this.worldSelect = mustGetEl("worldSelect");
        /** @type {HTMLElement} */
        this.content = mustGetEl("content");
        /** @type {HTMLElement} */
        this.status = mustGetEl("status");

        // Modal（ポラロイド）
        /** @type {HTMLElement} */
        this.modal = mustGetEl("photoModal");
        /** @type {HTMLElement} */
        this.modalPolaroid = mustGetEl("modalPolaroid");
        /** @type {HTMLImageElement} */
        this.modalImage = mustGetEl("modalImage");
        /** @type {HTMLElement} */
        this.modalWorldName = mustGetEl("modalWorldName");
        /** @type {HTMLElement} */
        this.modalSha1 = mustGetEl("modalSha1");
        /** @type {HTMLElement} */
        this.modalTakenAt = mustGetEl("modalTakenAt");
        /** @type {HTMLButtonElement} */
        this.modalClose = mustGetEl("modalClose");
    }
}

class State {
    constructor() {
        /** @type {Catalog|null} */
        this.catalog = null;

        /** @type {IntersectionObserver|null} */
        this.thumbObserver = null;

        /**
         * worldId -> worldName の辞書（Mapは使わず素朴に）
         * @type {{ [worldId: string]: string }}
         */
        this.worldIdToName = Object.create(null);

        /** @type {HTMLElement|null} */
        this.lastFocused = null;

        /** @type {boolean} */
        this.isModalOpen = false;

        /** @type {string} */
        this.modalStandardSrc = "";
        /** @type {string} */
        this.modalThumbSrc = "";
    }
}

const settings = new Settings();
const el = new Elements();
const state = new State();

window.addEventListener("DOMContentLoaded", () => {
    void main();
});

async function main() {
    wireModalEvents();

    el.worldSelect.addEventListener("change", () => {
        render();
    });

    try {
        setStatus("loading catalog...");
        state.catalog = await loadCatalog(settings.catalog_url);

        state.worldIdToName = buildWorldIdToName(state.catalog);
        initWorldSelect(state.catalog, state.worldIdToName);

        render();
        setStatus(`items=${state.catalog.items.length} / sorted by takenAt (desc)`);
    } catch (e) {
        console.error(e);
        setStatus("failed to load catalog. (is catalog.json present?)");
    }
}

/**
 * 必須DOM要素を取得（なければ例外）
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function mustGetEl(id) {
    const found = document.getElementById(id);
    if (!found) {
        throw new Error(`Missing element: #${id}`);
    }
    return /** @type {T} */ (found);
}

/**
 * catalog.json を読み込む
 * @param {string} url
 * @returns {Promise<Catalog>}
 */
async function loadCatalog(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
        throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
    }

    /** @type {any} */
    const data = await res.json();
    validateCatalogShape(data);
    return /** @type {Catalog} */ (data);
}

/**
 * ざっくり形だけチェック
 * @param {any} data
 */
function validateCatalogShape(data) {
    if (!data) throw new Error("Invalid catalog: null");
    if (!Array.isArray(data.items)) throw new Error("Invalid catalog: items");
    if (!Array.isArray(data.worlds)) throw new Error("Invalid catalog: worlds");
}

/**
 * worldId -> worldName の辞書を作る
 * @param {Catalog} catalog
 * @returns {{ [worldId: string]: string }}
 */
function buildWorldIdToName(catalog) {
    /** @type {{ [worldId: string]: string }} */
    const dict = Object.create(null);

    for (const w of catalog.worlds) {
        if (!w) continue;
        if (!w.worldId) continue;
        if (!w.worldName) continue;
        dict[w.worldId] = w.worldName;
    }
    return dict;
}

/**
 * ワールド選択ドロップダウンを初期化
 * @param {Catalog} catalog
 * @param {{ [worldId: string]: string }} worldIdToName
 */
function initWorldSelect(catalog, worldIdToName) {
    el.worldSelect.innerHTML = "";

    addOption(el.worldSelect, settings.key_all, "All worlds");

    /** @type {{ worldId: string, worldName: string }[]} */
    const list = [];
    for (const worldId of Object.keys(worldIdToName)) {
        list.push({ worldId, worldName: worldIdToName[worldId] });
    }
    list.sort((a, b) => a.worldName.localeCompare(b.worldName, "ja"));

    for (const w of list) {
        addOption(el.worldSelect, w.worldId, w.worldName);
    }

    const hasUnknown = catalog.items.some((it) => !it.worldId);
    if (hasUnknown) {
        addOption(el.worldSelect, settings.key_unknown, "(unknown)");
    }
}

/**
 * select に option を追加
 * @param {HTMLSelectElement} select
 * @param {string} value
 * @param {string} label
 */
function addOption(select, value, label) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
}

/**
 * 表示を作り直す
 */
function render() {
    if (!state.catalog) return;

    // 既存observerを破棄して作り直す（簡単で事故りにくい）
    if (state.thumbObserver) {
        state.thumbObserver.disconnect();
    }
    state.thumbObserver = createThumbObserver();

    const worldFilter = el.worldSelect.value;

    /** @type {CatalogItem[]} */
    let items = state.catalog.items.slice();

    if (worldFilter === settings.key_unknown) {
        items = items.filter((it) => !it.worldId);
    } else if (worldFilter !== settings.key_all) {
        items = items.filter((it) => it.worldId === worldFilter);
    }

    // 新しい順固定
    items.sort((a, b) => b.takenAt.localeCompare(a.takenAt));

    // グルーピング（Mapは使わず、素直な辞書で）
    /** @type {{ [key: string]: CatalogItem[] }} */
    const groups = Object.create(null);

    for (const it of items) {
        const key = it.worldId ? it.worldId : settings.key_unknown;
        if (!groups[key]) groups[key] = [];
        groups[key].push(it);
    }

    // グループ順（worldName基準 / unknownは最後）
    const groupKeys = Object.keys(groups);
    groupKeys.sort((a, b) => compareWorldKeys(a, b, state.worldIdToName));

    // 描画
    el.content.innerHTML = "";

    let shown = 0;
    for (let i = 0; i < groupKeys.length; i++) {
        const key = groupKeys[i];
        const groupItems = groups[key] || [];
        groupItems.sort((a, b) => b.takenAt.localeCompare(a.takenAt));

        const worldName = getWorldName(key, state.worldIdToName);
        const worldId = key === settings.key_unknown ? null : key;

        el.content.appendChild(renderWorldSection(worldName, worldId, groupItems));
        shown += groupItems.length;

        // ワールド区切り：薄い1pxのhrを全幅で
        if (i < groupKeys.length - 1) {
            el.content.appendChild(renderWorldDivider());
        }
    }

    setStatus(`showing ${shown} items`);
}

/**
 * ワールド区切り用のhr
 * @returns {HTMLElement}
 */
function renderWorldDivider() {
    const hr = document.createElement("hr");
    hr.className = "world-divider";
    return hr;
}

/**
 * グループ（worldId）の並び順比較
 * @param {string} a
 * @param {string} b
 * @param {{ [worldId: string]: string }} worldIdToName
 * @returns {number}
 */
function compareWorldKeys(a, b, worldIdToName) {
    if (a === settings.key_unknown && b !== settings.key_unknown) return 1;
    if (a !== settings.key_unknown && b === settings.key_unknown) return -1;

    const an = getWorldName(a, worldIdToName);
    const bn = getWorldName(b, worldIdToName);

    const c = an.localeCompare(bn, "ja");
    if (c !== 0) return c;

    return a.localeCompare(b);
}

/**
 * worldId から表示名を得る
 * @param {string} worldKey
 * @param {{ [worldId: string]: string }} worldIdToName
 * @returns {string}
 */
function getWorldName(worldKey, worldIdToName) {
    if (worldKey === settings.key_unknown) return "(unknown)";
    return worldIdToName[worldKey] || worldKey;
}

/**
 * ワールドセクションを描画
 * @param {string} worldName
 * @param {(string|null)} worldId
 * @param {CatalogItem[]} items
 * @returns {HTMLElement}
 */
function renderWorldSection(worldName, worldId, items) {
    const wrap = document.createElement("section");
    wrap.className = "world-section";

    const h = document.createElement("h2");
    h.className = "world-title";

    if (worldId) {
        const a = document.createElement("a");
        a.className = "world-title__link";
        a.href = "https://vrchat.com/home/world/" + worldId + "/info";
        a.textContent = worldName;
        a.target = "_blank";
        a.rel = "noopener";
        h.appendChild(a);
    } else {
        h.textContent = worldName;
    }

    const count = document.createElement("span");
    count.textContent = `  (${items.length})`;
    count.className = "world-title__count";
    h.appendChild(count);

    wrap.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "grid";

    for (const it of items) {
        grid.appendChild(renderCard(it, worldName));
    }

    wrap.appendChild(grid);
    return wrap;
}

/**
 * サムネカードを描画
 * @param {CatalogItem} it
 * @param {string} worldName
 * @returns {HTMLElement}
 */
function renderCard(it, worldName) {
    const card = document.createElement("div");
    card.className = "card";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb-button";
    btn.addEventListener("click", () => {
        openModal(it, worldName);
    });

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = it.sha1;

    // レイアウト安定用
    img.width = settings.thumb_w;
    img.height = settings.thumb_h;

    // lazy-load
    img.dataset.src = buildThumbPath(it.sha1);
    if (state.thumbObserver) {
        state.thumbObserver.observe(img);
    }

    btn.appendChild(img);
    card.appendChild(btn);

    const meta = document.createElement("div");
    meta.className = "meta";

    const line1 = document.createElement("div");
    line1.className = "meta__sha1";
    line1.textContent = it.sha1.slice(0, 8);

    const line2 = document.createElement("div");
    line2.className = "meta__takenat";
    line2.textContent = it.takenAt;

    meta.appendChild(line1);
    meta.appendChild(line2);
    card.appendChild(meta);

    return card;
}

/**
 * IntersectionObserver を作成
 * @returns {IntersectionObserver}
 */
function createThumbObserver() {
    if (!("IntersectionObserver" in window)) {
        return /** @type {any} */ ({
            observe: (img) => loadImgNow(img),
            unobserve: () => { },
            disconnect: () => { },
        });
    }

    return new IntersectionObserver(
        (entries, observer) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;

                /** @type {HTMLImageElement} */
                const img = /** @type {any} */ (entry.target);
                loadImgNow(img);
                observer.unobserve(img);
            }
        },
        {
            root: null,
            rootMargin: settings.lazy_root_margin,
            threshold: settings.lazy_threshold,
        }
    );
}

/**
 * img を今すぐ読み込む
 * @param {HTMLImageElement} img
 */
function loadImgNow(img) {
    const src = img.dataset.src;
    if (!src) return;
    if (img.src) return;

    img.src = src;

    img.addEventListener(
        "error",
        () => {
            img.removeAttribute("src");
            img.style.visibility = "hidden";
        },
        { once: true }
    );
}

/**
 * thumbs のパスを組み立て
 * @param {string} sha1
 * @returns {string}
 */
function buildThumbPath(sha1) {
    const head2 = sha1.slice(0, 2);
    return `./thumbs/${head2}/${sha1}.webp`;
}

/**
 * standard のパスを組み立て
 * @param {string} sha1
 * @returns {string}
 */
function buildStandardPath(sha1) {
    const head2 = sha1.slice(0, 2);
    return `./standard/${head2}/${sha1}.webp`;
}

/**
 * ステータス表示
 * @param {string} text
 */
function setStatus(text) {
    el.status.textContent = text;
}

/* ---------------- Modal ---------------- */

function wireModalEvents() {
    // ×で閉じる
    el.modalClose.addEventListener("click", () => {
        closeModal();
    });

    // 枠外クリックで閉じる（overlay自体をクリックした時だけ）
    el.modal.addEventListener("click", (ev) => {
        if (!state.isModalOpen) return;
        if (ev.target === el.modal) {
            closeModal();
        }
    });

    // ポラロイド写真をクリック → 別タブで開く（表示されている画像を開く）
    el.modalImage.addEventListener("click", (ev) => {
        if (!state.isModalOpen) return;

        // overlayクリック判定に干渉しないように止める
        ev.stopPropagation();

        const url = el.modalImage.currentSrc || el.modalImage.src;
        if (url) {
            openInNewTab(url);
            // 好みで：開いたらモーダル閉じる（“戻る”が即できて楽）
            closeModal();
        }
    });

    // ESCで閉じる
    document.addEventListener("keydown", (ev) => {
        if (!state.isModalOpen) return;
        if (ev.key === "Escape") {
            ev.preventDefault();
            closeModal();
        }
    });
}



function openModal(it, worldName) {
    state.lastFocused = /** @type {any} */ (document.activeElement);

    el.modalWorldName.textContent = worldName;
    el.modalSha1.textContent = it.sha1.slice(0, 8);
    el.modalTakenAt.textContent = it.takenAt;

    state.isModalOpen = true;

    el.modalPolaroid.hidden = false;

    state.modalStandardSrc = buildStandardPath(it.sha1);
    state.modalThumbSrc = buildThumbPath(it.sha1);

    setImageWithFallback(el.modalImage, state.modalStandardSrc, state.modalThumbSrc);

    el.modal.classList.add("is-open");
    el.modal.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("is-modal-open");

    el.modalClose.focus();
}


function closeModal() {
    if (!state.isModalOpen) return;

    state.isModalOpen = false;

    el.modal.classList.remove("is-open");
    el.modal.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("is-modal-open");

    clearImage(el.modalImage);

    el.modalPolaroid.hidden = false;

    state.modalStandardSrc = "";
    state.modalThumbSrc = "";

    if (state.lastFocused && typeof state.lastFocused.focus === "function") {
        state.lastFocused.focus();
    }
    state.lastFocused = null;
}

/**
 * 別タブで安全に開く（noopener/noreferrer）
 * window.openよりブラウザ互換が良いことが多い
 * @param {string} url
 */
function openInNewTab(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
}


/**
 * imgにsrcを設定（標準→失敗ならフォールバック）
 * @param {HTMLImageElement} img
 * @param {string} primarySrc
 * @param {string} fallbackSrc
 */
function setImageWithFallback(img, primarySrc, fallbackSrc) {
    // 以前のイベントを潰してから安全に張り直す
    img.onerror = null;
    img.src = "";

    img.onerror = () => {
        img.onerror = null;
        img.src = fallbackSrc;
    };

    img.src = primarySrc;
}

/**
 * imgをクリア
 * @param {HTMLImageElement} img
 */
function clearImage(img) {
    img.onerror = null;
    img.src = "";
}
