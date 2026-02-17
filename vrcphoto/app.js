/* global window, document, fetch */

"use strict";

/**
 * 公開用ビューア
 * - コントロールはワールドのドロップダウンのみ
 * - 並びは takenAt の新しい順固定
 * - クリックで standard を別タブで開く（直リンク）
 * - サムネは IntersectionObserver で lazyload
 */

/** @typedef {{ sha1: string, takenAt: string, worldId: (string|null) }} CatalogItem */
/** @typedef {{ worldId: string, worldName: string }} WorldInfo */
/** @typedef {{ items: CatalogItem[], worlds: WorldInfo[] }} Catalog */

const CATALOG_URL = "./catalog.json";

const THUMB_W = 128;
const THUMB_H = 128;

const LAZY_ROOT_MARGIN = "700px 0px";
const LAZY_THRESHOLD = 0.01;

const elWorldSelect = document.getElementById("worldSelect");
const elContent = document.getElementById("content");
const elStatus = document.getElementById("status");

/** @type {Catalog|null} */
let gCatalog = null;

/** @type {IntersectionObserver|null} */
let gThumbObserver = null;

window.addEventListener("DOMContentLoaded", async () => {
    try {
        setStatus("loading catalog...");
        gCatalog = await loadCatalog(CATALOG_URL);

        initWorldSelect(gCatalog);
        render();

        setStatus(`items=${gCatalog.items.length} / sorted by takenAt (desc)`);
    } catch (e) {
        console.error(e);
        setStatus("failed to load catalog. (is catalog_public.json present?)");
    }

    elWorldSelect.addEventListener("change", () => render());
});

/**
 * @param {string} url
 * @returns {Promise<Catalog>}
 */
async function loadCatalog(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
        throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
    }

    /** @type {Catalog} */
    const data = await res.json();
    validateCatalogShape(data);
    return data;
}

/**
 * @param {any} data
 */
function validateCatalogShape(data) {
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.worlds)) {
        throw new Error("Invalid catalog shape");
    }
}

/**
 * @param {Catalog} catalog
 */
function initWorldSelect(catalog) {
    const worldMap = buildWorldMap(catalog);
    const hasUnknown = catalog.items.some((it) => !it.worldId);

    elWorldSelect.innerHTML = "";

    addOption(elWorldSelect, "__all__", "All worlds");

    const list = Array.from(worldMap.entries())
        .map(([worldId, worldName]) => ({ worldId, worldName }))
        .sort((a, b) => a.worldName.localeCompare(b.worldName, "ja"));

    for (const w of list) {
        addOption(elWorldSelect, w.worldId, w.worldName);
    }

    if (hasUnknown) {
        addOption(elWorldSelect, "__unknown__", "(unknown)");
    }
}

/**
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
 * @param {Catalog} catalog
 * @returns {Map<string, string>}
 */
function buildWorldMap(catalog) {
    /** @type {Map<string, string>} */
    const map = new Map();
    for (const w of catalog.worlds) {
        if (w && w.worldId && w.worldName) {
            map.set(w.worldId, w.worldName);
        }
    }
    return map;
}

function render() {
    if (!gCatalog) return;

    if (gThumbObserver) {
        gThumbObserver.disconnect();
    }
    gThumbObserver = createThumbObserver();

    const worldFilter = elWorldSelect.value;
    const worldMap = buildWorldMap(gCatalog);

    let items = gCatalog.items.slice();

    if (worldFilter === "__unknown__") {
        items = items.filter((it) => !it.worldId);
    } else if (worldFilter !== "__all__") {
        items = items.filter((it) => it.worldId === worldFilter);
    }

    // 新しい順固定
    items.sort((a, b) => b.takenAt.localeCompare(a.takenAt));

    /** @type {Map<string, CatalogItem[]>} */
    const groups = new Map();
    for (const it of items) {
        const key = it.worldId ? it.worldId : "__unknown__";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
    }

    const groupKeys = Array.from(groups.keys()).sort((a, b) => {
        if (a === "__unknown__" && b !== "__unknown__") return 1;
        if (a !== "__unknown__" && b === "__unknown__") return -1;

        const an = a === "__unknown__" ? "(unknown)" : (worldMap.get(a) || a);
        const bn = b === "__unknown__" ? "(unknown)" : (worldMap.get(b) || b);

        const c = an.localeCompare(bn, "ja");
        if (c !== 0) return c;
        return a.localeCompare(b);
    });

    elContent.innerHTML = "";

    let shown = 0;

    for (const key of groupKeys) {
        const groupItems = groups.get(key) || [];
        groupItems.sort((a, b) => b.takenAt.localeCompare(a.takenAt));

        const worldName = key === "__unknown__" ? "(unknown)" : (worldMap.get(key) || key);
        const worldId = key === "__unknown__" ? null : key;

        elContent.appendChild(renderWorldSection(worldName, worldId, groupItems));
        shown += groupItems.length;
    }

    setStatus(`showing ${shown} items`);
}

/**
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
    count.style.color = "rgba(20,20,20,0.50)";
    count.style.fontWeight = "400";
    h.appendChild(count);

    wrap.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "grid";

    for (const it of items) {
        grid.appendChild(renderCard(it));
    }

    wrap.appendChild(grid);
    return wrap;
}

/**
 * @param {CatalogItem} it
 * @returns {HTMLElement}
 */
function renderCard(it) {
    const card = document.createElement("div");
    card.className = "card";

    const a = document.createElement("a");
    a.className = "thumb-link";
    a.href = buildStandardPath(it.sha1);
    a.target = "_blank";
    a.rel = "noopener";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = it.sha1;
    img.width = THUMB_W;
    img.height = THUMB_H;

    img.dataset.src = buildThumbPath(it.sha1);
    if (gThumbObserver) {
        gThumbObserver.observe(img);
    }

    a.appendChild(img);
    card.appendChild(a);

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
 * @returns {IntersectionObserver}
 */
function createThumbObserver() {
    if (!("IntersectionObserver" in window)) {
        return {
            observe: (img) => loadImgNow(img),
            unobserve: () => {},
            disconnect: () => {},
        };
    }

    return new IntersectionObserver(
        (entries, observer) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;

                /** @type {HTMLImageElement} */
                const img = entry.target;

                loadImgNow(img);
                observer.unobserve(img);
            }
        },
        {
            root: null,
            rootMargin: LAZY_ROOT_MARGIN,
            threshold: LAZY_THRESHOLD,
        }
    );
}

/**
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

function buildThumbPath(sha1) {
    const head2 = sha1.slice(0, 2);
    return `./thumbs/${head2}/${sha1}.jpg`;
}

function buildStandardPath(sha1) {
    const head2 = sha1.slice(0, 2);
    return `./standard/${head2}/${sha1}.jpg`;
}

function setStatus(text) {
    elStatus.textContent = text;
}
