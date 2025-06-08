
const images = [
    'images/card_1.png',
    'images/card_2.png',
    'images/card_3.png',
    'images/card_4.png'
];

let current = 0;
const card = document.querySelector('.card');
const overlay = document.querySelector('.overlay');

function fadeToNextImage() {
    // フェードアウト
    overlay.style.transition = 'opacity 1s ease';
    overlay.style.opacity = 1;

    setTimeout(() => {
        // 画像切り替え
        current = (current + 1) % images.length;
        card.style.backgroundImage = `url('${images[current]}')`;

        // フェードイン
        overlay.style.opacity = 0.4; // 元の不透明度に戻す
    }, 1000);
}

// 初期化
setInterval(fadeToNextImage, 15000); // ミリ秒
