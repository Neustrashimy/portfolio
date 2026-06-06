/* =====================================================================
   Portfolio — interaction
   - fullscreen name-card toggle
   - subtle scroll reveal
   - hero crossfade rotation
   ===================================================================== */
(function () {
    'use strict';

    /* ---- fullscreen name-card toggle ---- */
    var card = document.querySelector('.namecard');
    var backdrop = document.getElementById('fsBackdrop');
    var isFs = false;

    function openFs() {
        if (isFs) { return; }
        isFs = true;
        card.classList.add('namecard--fs');
        backdrop.classList.add('is-open');
        document.body.classList.add('is-fs-open');
    }

    function closeFs() {
        if (!isFs) { return; }
        isFs = false;
        card.classList.remove('namecard--fs');
        backdrop.classList.remove('is-open');
        document.body.classList.remove('is-fs-open');
    }

    if (card && backdrop) {
        card.addEventListener('click', function () {
            if (isFs) { closeFs(); } else { openFs(); }
        });

        backdrop.addEventListener('click', function () {
            closeFs();
        });

        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') { closeFs(); }
        });
    }

    /* ---- scroll reveal (subtle) ---- */
    function initReveal() {
        var items = document.querySelectorAll('.reveal');
        if (!('IntersectionObserver' in window)) {
            for (var i = 0; i < items.length; i++) { items[i].classList.add('is-in'); }
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) {
                    en.target.classList.add('is-in');
                    io.unobserve(en.target);
                }
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        for (var j = 0; j < items.length; j++) { io.observe(items[j]); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initReveal);
    } else {
        initReveal();
    }

    /* ---- hero name-card crossfade rotation ---- */
    function initHeroRotation() {
        var frames = document.querySelectorAll('.hero-frame');
        if (frames.length < 2) { return; }
        var idx = 0;
        setInterval(function () {
            frames[idx].classList.remove('is-active');
            idx = (idx + 1) % frames.length;
            frames[idx].classList.add('is-active');
        }, 8000);
    }
    initHeroRotation();

    /* friendly console note (kept from original spirit) */
    console.log(
        '%c＜◎＞＜◎＞　何かお探しですか？',
        'color:#fff;background:#16181a;font-size:18px;padding:4px 10px;border-radius:4px;'
    );
})();
