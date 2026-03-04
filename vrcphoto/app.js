/* global window, document, fetch */

"use strict";

/*
    公開向けギャラリー app.js

    方針：
    - 設定値、DOM参照、状態は「素朴なオブジェクト」
    - Mapなどは使わず、配列＋プレーンオブジェクト（辞書）
    - モーダル表示時は body fixed 方式でスクロール位置を見た目ごと固定
*/

/** @typedef {{ sha1: string, takenAt: string, worldId: (string|null) }} CatalogItem */
/** @typedef {{ worldId: string, worldName: string, note: (string|null|undefined) }} WorldInfo */
/** @typedef {{ items: CatalogItem[], worlds: WorldInfo[] }} Catalog */

/* -----------------------------
    設定
----------------------------- */
var settings = {
    catalog_url: "./catalog.json",

    thumb_w: 148,
    thumb_h: 148,

    lazy_root_margin: "700px 0px",
    lazy_threshold: 0.01,

    key_all: "__all__",
    key_unknown: "__unknown__",

    // UI保存キー
    ls_group_by_world: "vrc_gallery_group_by_world"
};

/* -----------------------------
    DOM参照（起動時に埋める）
----------------------------- */
var el = {
    worldSelect: null,
    groupToggle: null,
    content: null,
    status: null,

    // Modal（ポラロイド）
    modal: null,
    modalPolaroid: null,
    modalImage: null,
    modalWorldName: null,
    modalSha1: null,
    modalTakenAt: null,
    modalClose: null
};

/* -----------------------------
    状態
----------------------------- */
var state = {
    catalog: null,
    thumbObserver: null,

    // worldId -> { worldName, note }
    worldIdToInfo: Object.create(null),

    // grouping
    groupByWorld: true,

    // modal
    isModalOpen: false,
    lastFocused: null,
    modalStandardSrc: "",
    modalThumbSrc: "",

    // スクロール固定用
    scrollYBeforeModal: 0,
    bodyPaddingRightBeforeModal: ""
};

/* -----------------------------
    起動
----------------------------- */
window.addEventListener("DOMContentLoaded", function () {
    initElements();
    wireEvents();
    void main();
});

function initElements() {
    el.worldSelect = mustGetEl("worldSelect");
    el.groupToggle = mustGetEl("groupToggle");
    el.content = mustGetEl("content");
    el.status = mustGetEl("status");

    el.modal = mustGetEl("photoModal");
    el.modalPolaroid = mustGetEl("modalPolaroid");

    // 初期状態は非表示（モーダルはdisplay:noneだが、念のため）
    el.modalPolaroid.hidden = true;

    el.modalImage = mustGetEl("modalImage");

    // index.htmlで aタグにしたので HTMLAnchorElement 扱い
    el.modalWorldName = /** @type {HTMLAnchorElement} */ (mustGetEl("modalWorldName"));

    el.modalSha1 = mustGetEl("modalSha1");
    el.modalTakenAt = mustGetEl("modalTakenAt");
    el.modalClose = mustGetEl("modalClose");
}

function wireEvents() {
    // world select
    el.worldSelect.addEventListener("change", function () {
        render();
    });

    // grouping toggle
    el.groupToggle.addEventListener("change", function () {
        state.groupByWorld = !!el.groupToggle.checked;
        saveGroupByWorld(state.groupByWorld);
        render();
    });

    // modal close button
    el.modalClose.addEventListener("click", function () {
        closeModal();
    });

    // overlay click to close
    el.modal.addEventListener("click", function (ev) {
        if (!state.isModalOpen) {
            return;
        }
        if (ev.target === el.modal) {
            closeModal();
        }
    });

    // modal image click -> open in new tab
    el.modalImage.addEventListener("click", function (ev) {
        if (!state.isModalOpen) {
            return;
        }

        // overlay click判定に干渉しないように
        ev.stopPropagation();

        var url = el.modalImage.currentSrc || el.modalImage.src;
        if (url) {
            openInNewTab(url);

            // “戻る”が即できて楽なので、開いたら閉じる
            closeModal();
        }
    });

    // ESC to close
    document.addEventListener("keydown", function (ev) {
        if (!state.isModalOpen) {
            return;
        }
        if (ev.key === "Escape") {
            ev.preventDefault();
            closeModal();
        }
    });
}

async function main() {
    try {
        setStatus("loading catalog...");
        state.catalog = await loadCatalog(settings.catalog_url);

        // 後方互換の吸収（note:null、TZなし日時など）
        normalizeCatalogData(state.catalog);

        state.worldIdToInfo = buildWorldIdToInfo(state.catalog);
        initWorldSelect(state.catalog, state.worldIdToInfo);

        // grouping状態を復元
        state.groupByWorld = loadGroupByWorld(true);
        el.groupToggle.checked = state.groupByWorld;

        setStatus("items=" + state.catalog.items.length);
        render();
    } catch (e) {
        console.error(e);
        setStatus("failed to load catalog. (is catalog.json present?)");
    }
}

/* -----------------------------
    Utility
----------------------------- */
function mustGetEl(id) {
    var found = document.getElementById(id);
    if (!found) {
        throw new Error("Missing element: #" + id);
    }
    return found;
}

function setStatus(text) {
    el.status.textContent = text;
}

/* -----------------------------
    localStorage (grouping)
----------------------------- */
function loadGroupByWorld(defaultValue) {
    try {
        var raw = window.localStorage.getItem(settings.ls_group_by_world);
        if (raw === "1") {
            return true;
        }
        if (raw === "0") {
            return false;
        }
        return defaultValue;
    } catch (e) {
        return defaultValue;
    }
}

function saveGroupByWorld(value) {
    try {
        window.localStorage.setItem(settings.ls_group_by_world, value ? "1" : "0");
    } catch (e) {
        // localStorageが使えない環境でも動作は継続する
    }
}

/* -----------------------------
    Catalog Load / Validate
----------------------------- */
async function loadCatalog(url) {
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
        throw new Error("fetch failed: " + res.status + " " + res.statusText);
    }

    var data = await res.json();
    validateCatalogShape(data);
    return /** @type {Catalog} */ (data);
}

function validateCatalogShape(data) {
    if (!data) {
        throw new Error("Invalid catalog: null");
    }
    if (!Array.isArray(data.items)) {
        throw new Error("Invalid catalog: items");
    }
    if (!Array.isArray(data.worlds)) {
        throw new Error("Invalid catalog: worlds");
    }
}

function normalizeCatalogData(catalog) {
    // worlds[].note: null -> "" （後方互換）
    if (catalog && Array.isArray(catalog.worlds)) {
        for (var i = 0; i < catalog.worlds.length; i++) {
            var w = catalog.worlds[i];
            if (!w) {
                continue;
            }

            // note が null/undefined の旧データを吸収
            if (w.note === null || typeof w.note === "undefined") {
                w.note = "";
            }

            // 念のため（数値などが混ざっても落ちないように）
            if (typeof w.note !== "string") {
                w.note = String(w.note);
            }
        }
    }

    // items[].takenAt: TZ無し -> +09:00 として読み替え（後方互換）
    if (catalog && Array.isArray(catalog.items)) {
        for (var j = 0; j < catalog.items.length; j++) {
            var it = catalog.items[j];
            if (!it) {
                continue;
            }
            if (typeof it.takenAt !== "string") {
                continue;
            }
            it.takenAt = normalizeTakenAtTz(it.takenAt);
        }
    }
}

function normalizeTakenAtTz(takenAt) {
    // 例: 2026-02-24T12:34:56  -> 2026-02-24T12:34:56+09:00
    // 例: 2026-02-24T12:34:56Z -> そのまま
    // 例: 2026-02-24T12:34:56+09:00 -> そのまま
    if (!takenAt) {
        return takenAt;
    }
    if (hasTimezoneSuffix(takenAt)) {
        return takenAt;
    }
    return takenAt + "+09:00";
}

function hasTimezoneSuffix(text) {
    // 末尾が Z / +0900 / +09:00 / -0500 / -05:00 などなら「TZあり」
    return /([zZ]|[+\-]\d\d:?\d\d)$/.test(text);
}

function buildWorldIdToInfo(catalog) {
    var dict = Object.create(null);

    for (var i = 0; i < catalog.worlds.length; i++) {
        var w = catalog.worlds[i];
        if (!w) {
            continue;
        }
        if (!w.worldId) {
            continue;
        }
        if (!w.worldName) {
            continue;
        }

        // normalizeCatalogData() で note は文字列に寄せてある前提
        var note = typeof w.note === "string" ? w.note : "";

        dict[w.worldId] = {
            worldName: w.worldName,
            note: note
        };
    }

    return dict;
}

/* -----------------------------
    World Select
----------------------------- */
function initWorldSelect(catalog, worldIdToInfo) {
    el.worldSelect.innerHTML = "";

    addOption(el.worldSelect, settings.key_all, "All worlds");

    // worldIdToInfo を配列にしてソート
    var list = [];
    var keys = Object.keys(worldIdToInfo);

    for (var i = 0; i < keys.length; i++) {
        var worldId = keys[i];
        list.push({
            worldId: worldId,
            worldName: worldIdToInfo[worldId].worldName
        });
    }

    list.sort(function (a, b) {
        return a.worldName.localeCompare(b.worldName, "ja");
    });

    for (var j = 0; j < list.length; j++) {
        addOption(el.worldSelect, list[j].worldId, list[j].worldName);
    }

    // unknown の存在チェック
    var hasUnknown = false;
    for (var k = 0; k < catalog.items.length; k++) {
        if (!catalog.items[k].worldId) {
            hasUnknown = true;
            break;
        }
    }
    if (hasUnknown) {
        addOption(el.worldSelect, settings.key_unknown, "(unknown)");
    }
}

function addOption(select, value, label) {
    var opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
}

/* -----------------------------
    Render
----------------------------- */
function render() {
    if (!state.catalog) {
        return;
    }

    // 既存observerを破棄して作り直し（簡単で事故りにくい）
    if (state.thumbObserver) {
        state.thumbObserver.disconnect();
    }
    state.thumbObserver = createThumbObserver();

    var worldFilter = el.worldSelect.value;

    // items をコピーしてフィルタ
    var items = state.catalog.items.slice();

    if (worldFilter === settings.key_unknown) {
        items = filterItemsUnknown(items);
    } else if (worldFilter !== settings.key_all) {
        items = filterItemsByWorld(items, worldFilter);
    }

    // 新しい順固定（publish側はdesc固定）
    items.sort(function (a, b) {
        return b.takenAt.localeCompare(a.takenAt);
    });

    // 描画
    el.content.innerHTML = "";

    if (state.groupByWorld) {
        renderGrouped(items);
    } else {
        renderFlat(items);
    }

    setStatus("showing " + items.length + " items");
}

function renderGrouped(items) {
    // worldId 単位でグルーピング（辞書）
    var groups = groupItemsByWorld(items);

    // グループキーの並び順
    var groupKeys = Object.keys(groups);
    groupKeys.sort(function (a, b) {
        return compareWorldKeys(a, b, state.worldIdToInfo);
    });

    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];
        var groupItems = groups[key] || [];

        groupItems.sort(function (a, b) {
            return b.takenAt.localeCompare(a.takenAt);
        });

        var worldName = getWorldName(key, state.worldIdToInfo);
        var worldNote = getWorldNote(key, state.worldIdToInfo);
        var worldId = key === settings.key_unknown ? null : key;

        el.content.appendChild(renderWorldSection(worldName, worldId, worldNote, groupItems));

        // ワールド区切り：薄い1pxのhr
        if (i < groupKeys.length - 1) {
            el.content.appendChild(renderWorldDivider());
        }
    }
}

function renderFlat(items) {
    // まとめて1つのgridに描画
    var grid = document.createElement("div");
    grid.className = "grid";

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var worldId = it.worldId ? it.worldId : null;
        var worldKey = worldId ? worldId : settings.key_unknown;
        var worldName = getWorldName(worldKey, state.worldIdToInfo);

        grid.appendChild(renderCard(it, worldName, worldId));
    }

    el.content.appendChild(grid);
}

function filterItemsUnknown(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
        if (!items[i].worldId) {
            out.push(items[i]);
        }
    }
    return out;
}

function filterItemsByWorld(items, worldId) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
        if (items[i].worldId === worldId) {
            out.push(items[i]);
        }
    }
    return out;
}

function groupItemsByWorld(items) {
    var groups = Object.create(null);

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var key = it.worldId ? it.worldId : settings.key_unknown;

        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(it);
    }

    return groups;
}

function renderWorldDivider() {
    var hr = document.createElement("hr");
    hr.className = "world-divider";
    return hr;
}

function compareWorldKeys(a, b, worldIdToInfo) {
    // unknownは最後
    if (a === settings.key_unknown && b !== settings.key_unknown) {
        return 1;
    }
    if (a !== settings.key_unknown && b === settings.key_unknown) {
        return -1;
    }

    var an = getWorldName(a, worldIdToInfo);
    var bn = getWorldName(b, worldIdToInfo);

    var c = an.localeCompare(bn, "ja");
    if (c !== 0) {
        return c;
    }

    // 同名の場合はIDで安定ソート
    return a.localeCompare(b);
}

function getWorldName(worldKey, worldIdToInfo) {
    if (worldKey === settings.key_unknown) {
        return "(unknown)";
    }

    var info = worldIdToInfo[worldKey];
    if (!info) {
        return worldKey;
    }

    return info.worldName || worldKey;
}

function getWorldNote(worldKey, worldIdToInfo) {
    if (worldKey === settings.key_unknown) {
        return "";
    }

    var info = worldIdToInfo[worldKey];
    if (!info) {
        return "";
    }

    return info.note || "";
}

function renderWorldSection(worldName, worldId, worldNote, items) {
    var wrap = document.createElement("section");
    wrap.className = "world-section";

    var h = document.createElement("h2");
    h.className = "world-title";

    if (worldId) {
        var a = document.createElement("a");
        a.className = "world-title__link";
        a.href = "https://vrchat.com/home/world/" + worldId + "/info";
        a.textContent = worldName;
        a.target = "_blank";
        a.rel = "noopener";
        h.appendChild(a);
    } else {
        h.textContent = worldName;
    }

    var count = document.createElement("span");
    count.textContent = "  (" + items.length + ")";
    count.className = "world-title__count";
    h.appendChild(count);

    wrap.appendChild(h);

    // World備考（note）：空文字は未設定扱い
    if (worldNote) {
        var note = document.createElement("div");
        note.className = "world-note";
        note.textContent = worldNote;
        wrap.appendChild(note);
    }

    var grid = document.createElement("div");
    grid.className = "grid";

    for (var i = 0; i < items.length; i++) {
        grid.appendChild(renderCard(items[i], worldName, worldId));
    }

    wrap.appendChild(grid);
    return wrap;
}

function renderCard(it, worldName, worldId) {
    var card = document.createElement("div");
    card.className = "card";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb-button";
    btn.addEventListener("click", function () {
        openModal(it, worldName, worldId);
    });

    var img = document.createElement("img");
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

    var meta = document.createElement("div");
    meta.className = "meta";

    var line1 = document.createElement("div");
    line1.className = "meta__sha1";
    line1.textContent = it.sha1.slice(0, 8);

    var line2 = document.createElement("div");
    line2.className = "meta__takenat";
    line2.textContent = it.takenAt;

    meta.appendChild(line1);
    meta.appendChild(line2);
    card.appendChild(meta);

    return card;
}

/* -----------------------------
    Lazy Load
----------------------------- */
function createThumbObserver() {
    // IntersectionObserverがない環境は即時ロード
    if (!("IntersectionObserver" in window)) {
        return {
            observe: function (img) {
                loadImgNow(img);
            },
            unobserve: function () { },
            disconnect: function () { }
        };
    }

    return new IntersectionObserver(
        function (entries, observer) {
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (!entry.isIntersecting) {
                    continue;
                }

                var img = /** @type {HTMLImageElement} */ (entry.target);
                loadImgNow(img);
                observer.unobserve(img);
            }
        },
        {
            root: null,
            rootMargin: settings.lazy_root_margin,
            threshold: settings.lazy_threshold
        }
    );
}

function loadImgNow(img) {
    var src = img.dataset.src;
    if (!src) {
        return;
    }
    if (img.src) {
        return;
    }

    img.src = src;

    img.addEventListener(
        "error",
        function () {
            img.removeAttribute("src");
            img.style.visibility = "hidden";
        },
        { once: true }
    );
}

/* -----------------------------
    Path Builder
----------------------------- */
function buildThumbPath(sha1) {
    var head2 = sha1.slice(0, 2);
    return "./thumbs/" + head2 + "/" + sha1 + ".webp";
}

function buildStandardPath(sha1) {
    var head2 = sha1.slice(0, 2);
    return "./standard/" + head2 + "/" + sha1 + ".webp";
}

/* -----------------------------
    Modal (Polaroid)
----------------------------- */
function openModal(it, worldName, worldId) {
    state.lastFocused = /** @type {any} */ (document.activeElement);

    // モーダルのワールド名：リンク化（unknownはリンク無し）
    setModalWorldLink(worldName, worldId);

    el.modalSha1.textContent = it.sha1.slice(0, 8);
    el.modalTakenAt.textContent = it.takenAt;

    state.isModalOpen = true;

    // 画像URLを保持（standard優先、失敗時thumb）
    state.modalStandardSrc = buildStandardPath(it.sha1);
    state.modalThumbSrc = buildThumbPath(it.sha1);

    setImageWithFallback(el.modalImage, state.modalStandardSrc, state.modalThumbSrc);

    el.modalPolaroid.hidden = false;

    el.modal.classList.add("is-open");
    el.modal.setAttribute("aria-hidden", "false");

    // 背景スクロールを「見た目ごと」固定
    lockScroll();

    el.modalClose.focus();
}

function closeModal() {
    if (!state.isModalOpen) {
        return;
    }

    state.isModalOpen = false;

    el.modal.classList.remove("is-open");
    el.modal.setAttribute("aria-hidden", "true");

    // スクロール復帰
    unlockScroll();

    clearImage(el.modalImage);

    // 次回の読み込み中に中身が見えないように
    el.modalPolaroid.hidden = true;

    state.modalStandardSrc = "";
    state.modalThumbSrc = "";

    if (state.lastFocused && typeof state.lastFocused.focus === "function") {
        state.lastFocused.focus();
    }
    state.lastFocused = null;
}

function setModalWorldLink(worldName, worldId) {
    el.modalWorldName.textContent = worldName;

    if (worldId) {
        el.modalWorldName.href = "https://vrchat.com/home/world/" + worldId + "/info";
        el.modalWorldName.target = "_blank";
        el.modalWorldName.rel = "noopener";
    } else {
        // href無しにして、見た目もリンクっぽくしない（CSSで:not([href])対応）
        el.modalWorldName.removeAttribute("href");
        el.modalWorldName.removeAttribute("target");
        el.modalWorldName.removeAttribute("rel");
    }
}

/*
    スクロール固定（body fixed方式）
*/
function lockScroll() {
    var y = window.scrollY || 0;
    state.scrollYBeforeModal = y;

    // スクロールバー幅（横ガタつき抑制）
    var scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    state.bodyPaddingRightBeforeModal = document.body.style.paddingRight || "";
    if (scrollbarWidth > 0) {
        document.body.style.paddingRight = String(scrollbarWidth) + "px";
    }

    document.body.style.position = "fixed";
    document.body.style.top = "-" + String(y) + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";

    document.documentElement.classList.add("is-modal-open");
}

function unlockScroll() {
    var y = state.scrollYBeforeModal || 0;

    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";

    document.body.style.paddingRight = state.bodyPaddingRightBeforeModal;
    state.bodyPaddingRightBeforeModal = "";

    document.documentElement.classList.remove("is-modal-open");

    window.scrollTo(0, y);
}

/* -----------------------------
    Image helpers
----------------------------- */
function setImageWithFallback(img, primarySrc, fallbackSrc) {
    img.onerror = null;
    img.src = "";

    img.onerror = function () {
        img.onerror = null;
        img.src = fallbackSrc;
    };

    img.src = primarySrc;
}

function clearImage(img) {
    img.onerror = null;
    img.src = "";
}

/* -----------------------------
    Open in new tab
----------------------------- */
function openInNewTab(url) {
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
}