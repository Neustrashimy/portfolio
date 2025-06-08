
const images = [
    'images/card_1.png',
    'images/card_2.png',
    'images/card_3.png',
    'images/card_4.png'
];

let current = 0;
const card = document.querySelector('.card');
const overlay = document.querySelector('.overlay');


// 画像のプリロード
function preloadImages(imagePaths, callback) {
    let loaded = 0;
    const total = imagePaths.length;

    for (let i = 0; i < total; i++) {
        const img = new Image();
        img.src = imagePaths[i];
        img.onload = () => {
            loaded++;
            if (loaded === total) {
                callback(); // 全て読み込まれたら開始
            }
        };
    }
}

function fadeToNextImage() {
    overlay.style.transition = 'opacity 1s ease';
    overlay.style.opacity = 1;

    setTimeout(() => {
        current = (current + 1) % images.length;
        card.style.backgroundImage = `url('${images[current]}')`;
        overlay.style.opacity = 0.4;
    }, 1000);
}

// ページ読み込み後にプリロード→開始
window.addEventListener('load', () => {
    preloadImages(images, () => {
        // 初回表示に即反映
        card.style.backgroundImage = `url('${images[0]}')`;

        setInterval(fadeToNextImage, 10000);
    });
});