
/* 背景画像 */
const images = [
    'images/card_1.png',
    'images/card_2.png',
    'images/card_3.png',
    'images/card_4.png'
];

let current = 0;

const card = document.querySelector('.card');
const overlay = document.querySelector('.overlay');

/* -------------------------
   画像のプリロード
   ------------------------- */

/**
 * 画像を事前読み込みしてから callback を呼び出します。
 * @param {string[]} imagePaths
 * @param {Function} callback
 */
function preloadImages(imagePaths, callback) {
    let loaded = 0;
    const total = imagePaths.length;

    for (let i = 0; i < total; i++) {
        const img = new Image();
        img.src = imagePaths[i];

        img.onload = () => {
            loaded++;

            /* 全部読み込めたら開始 */
            if (loaded === total) {
                callback();
            }
        };
    }
}

/* -------------------------
   背景画像のフェード切り替え
   ------------------------- */

/**
 * overlay を使って「一旦暗くしてから」次の背景に切り替えます。
 */
function fadeToNextImage() {
    overlay.style.transition = 'opacity 1s ease';
    overlay.style.opacity = 1;

    window.setTimeout(() => {
        current = (current + 1) % images.length;
        card.style.backgroundImage = `url('${images[current]}')`;

        /* 通常時の暗さに戻す（CSSの overlay と合わせる） */
        overlay.style.opacity = 0.4;
    }, 1000);
}

/* =========================
   Fullscreen modal
   ========================= */

let modalBackdrop = null;
let modalCard = null;

/**
 * fullscreen用のDOMを作成します（初回だけ）。
 */
function ensureCardModal() {
    if (modalBackdrop) {
        return;
    }

    modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'card-modal-backdrop';

    /* 背景クリックで閉じる（カード自身のクリックは閉じない） */
    modalBackdrop.addEventListener('click', (event) => {
        if (event.target === modalBackdrop) {
            closeCardModal();
        }
    });

    document.body.appendChild(modalBackdrop);

    /* ESCキーで閉じる */
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeCardModal();
        }
    });
}

/**
 * カードを全画面表示します。
 * 元の .card をクローンして、そのまま表示するので見た目が一致します。
 */
function openCardModal() {
    ensureCardModal();

    /* 既に開いている場合は何もしない */
    if (modalBackdrop.classList.contains('is-open')) {
        return;
    }

    /* 元のカードをクローンしてモーダルに配置 */
    modalCard = card.cloneNode(true);
    modalCard.classList.add('card--modal');

    /* 現在の表示背景をクローン側に強制反映（JS切替中でも一致させる） */
    const computed = window.getComputedStyle(card);
    modalCard.style.backgroundImage = computed.backgroundImage;

    modalBackdrop.appendChild(modalCard);

    /* 背景スクロールを止める */
    document.body.classList.add('is-modal-open');
    modalBackdrop.classList.add('is-open');
}

/**
 * 全画面表示を閉じます。
 */
function closeCardModal() {
    if (!modalBackdrop) {
        return;
    }

    modalBackdrop.classList.remove('is-open');
    document.body.classList.remove('is-modal-open');

    /* クローンカードを削除して次回に備える */
    if (modalCard) {
        modalCard.remove();
        modalCard = null;
    }
}

/* =========================
   Init
   ========================= */

window.addEventListener('load', () => {
    /* 初回表示に即反映 */
    card.style.backgroundImage = `url('${images[0]}')`;

    /* 背景切り替え（プリロード後に開始） */
    preloadImages(images, () => {
        window.setInterval(fadeToNextImage, 10000);
    });

    /* カードをタップ/クリックで全画面表示 */
    card.addEventListener('click', () => {
        openCardModal();
    });

    console.log(
    '%c＜◎＞＜◎＞　何かお探しですか？',
    'color: white; background: black; font-size: 20px; padding: 4px 8px;'
);

});
