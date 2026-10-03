// ==UserScript==
// @name         煎蛋 GIF 还原（mp4 → gif）
// @namespace    https://github.com/Lianzy-Baimiao/jandan-gif-restore
// @version      1.3.0
// @description  把煎蛋无聊图/随手拍里用 <video> 播放的 mp4 换回同名的原始 GIF
// @author       白描
// @license      MIT
// @homepageURL  https://github.com/Lianzy-Baimiao/jandan-gif-restore
// @supportURL   https://github.com/Lianzy-Baimiao/jandan-gif-restore/issues
// @downloadURL  https://raw.githubusercontent.com/Lianzy-Baimiao/jandan-gif-restore/main/jandan-gif-restore.user.js
// @updateURL    https://raw.githubusercontent.com/Lianzy-Baimiao/jandan-gif-restore/main/jandan-gif-restore.user.js
// @match        https://jandan.net/*
// @match        https://*.jandan.net/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // 原始 GIF 普遍 5-8MB，一页二十来张就是上百 MB。
    // 想改成点一下再加载：菜单里切换，或把下面的默认值改成 '0'。
    const LS_KEY = 'jd-gif-restore:auto';
    const AUTO = (localStorage.getItem(LS_KEY) || '1') !== '0';

    // 排查用：控制台执行 localStorage.setItem('jd-gif-restore:debug','1') 再刷新，
    // 每轮扫描会打印找到多少 video、其中多少推导不出 GIF 地址
    const DEBUG = localStorage.getItem('jd-gif-restore:debug') === '1';

    // 站点设置里的「通道2（国内优化）」会把图源域名改写到 dfyun 镜像。
    // 那些镜像发 mp4 没问题，但取几 MB 的原始 GIF 容易直接断连
    // （实测 ERR_HTTP2_PROTOCOL_ERROR / curl exit 56），所以拿 GIF 时换回源站。
    const ORIGIN_HOST = {
        'wangmoyuimg.cdn.dfyun.com.cn': 'img.wangmoyu.com',
        'moyuimg.cdn.dfyun.com.cn': 'img.moyu.im',
        'totoimg.cdn.dfyun.com.cn': 'img.toto.im',
    };

    function toOrigin(url) {
        return url.replace(/^(https?:\/\/)([^/]+)/, (all, scheme, host) =>
            ORIGIN_HOST[host] ? scheme + ORIGIN_HOST[host] : all);
    }

    // 站点前端从同一文件名派生出三个地址：
    //   /thumb180/NAME.gif.webp  静态缩略图
    //   /large/NAME.mp4          页面里实际播放的
    //   /large/NAME.gif          原始 GIF
    // 所以把尺寸段换成 large、后缀换回 .gif 就能拿到原图。
    // 返回 [首选地址, 兜底地址]：镜像域名先试源站，失败再回镜像。
    function toGifUrl(src) {
        if (!src) return null;
        const u = src.replace(/^http:/, 'https:');
        const m = u.match(/^(https?:\/\/[^/]+)\/[^/]+\/(.+?)\.mp4(\?.*)?$/);
        if (!m) return null;
        const mirror = `${m[1]}/large/${m[2]}.gif${m[3] || ''}`;
        const origin = toOrigin(mirror);
        return origin === mirror ? [mirror] : [origin, mirror];
    }

    // 站点用了 vue-lazyload，没进视口的图地址挂在 data-src 上，src 是空的，
    // 只读 src 会漏掉大半页
    function videoSrc(video) {
        const s = video.querySelector('source');
        const pick = el => el && (el.getAttribute('src') || el.dataset.src ||
            el.getAttribute('data-original') || el.dataset.original);
        return pick(s) || pick(video) || video.currentSrc || '';
    }

    function restore(video) {
        const candidates = toGifUrl(videoSrc(video));
        if (!candidates) return;
        const key = candidates[0];
        if (video.dataset.jdGif === key) return;
        // 地址变了说明翻页时 Vue 复用了这个 <video>，先清掉上一张 GIF
        if (video.dataset.jdGif) {
            const prev = video.previousElementSibling;
            if (prev && prev.classList.contains('jd-gif-restored')) prev.remove();
        }
        video.dataset.jdGif = key;

        const img = document.createElement('img');
        img.className = 'jd-gif-restored';
        img.referrerPolicy = 'no-referrer';
        img.alt = 'GIF';

        // 先占住原来的宽度，替换时不跳版
        const rect = video.getBoundingClientRect();
        if (rect.width) img.style.width = video.style.width || rect.width + 'px';

        img.addEventListener('load', () => {
            video.pause && video.pause();
            video.removeAttribute('autoplay');
            video.style.display = 'none';
            // 站点自己的静态缩略图，留着会和 GIF 重复显示
            const box = video.parentElement;
            if (box) box.querySelectorAll('img.img-min, img.gif-shot-thumb').forEach(n => { n.style.display = 'none'; });
        });

        // 挨个试候选地址（源站 → 镜像），都不行就退回原来的 video
        let i = 0;
        img.addEventListener('error', () => {
            if (DEBUG) console.log('[jd-gif] 取 GIF 失败:', candidates[i]);
            if (++i < candidates.length) {
                img.src = candidates[i];
                return;
            }
            img.remove();
            video.style.display = '';
            video.classList.remove('d-none');
            delete video.dataset.jdGif;
        });

        img.src = candidates[0];
        (video.parentElement || document.body).insertBefore(img, video);
    }

    // 手动模式：盖一个小按钮，点了才拉原图
    function arm(video) {
        const candidates = toGifUrl(videoSrc(video));
        if (!candidates) return;
        const key = candidates[0];
        if (video.dataset.jdGif === key || video.dataset.jdGifArmed === key) return;
        video.dataset.jdGifArmed = key;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'jd-gif-btn';
        btn.textContent = 'GIF';
        btn.title = '加载原始 GIF';
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.remove();
            restore(video);
        });

        const box = video.parentElement;
        if (!box) return;
        if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
        box.appendChild(btn);
    }

    function scan() {
        const vs = document.querySelectorAll('video');
        if (DEBUG) {
            const bad = [...vs].filter(v => !toGifUrl(videoSrc(v)));
            console.log('[jd-gif] video:', vs.length, '｜推导不出 GIF 地址:', bad.length,
                bad.slice(0, 3).map(v => videoSrc(v) || '(src 为空)'));
        }
        vs.forEach(AUTO ? restore : arm);
    }

    const style = document.createElement('style');
    style.textContent = `
        img.jd-gif-restored { max-width: 100%; height: auto; display: block; }
        .jd-gif-btn {
            position: absolute; left: 6px; top: 6px; z-index: 5;
            padding: 2px 7px; border: 0; border-radius: 3px;
            font: 600 11px/1.6 system-ui, sans-serif;
            color: #fff; background: rgba(0,0,0,.6); cursor: pointer;
        }
        .jd-gif-btn:hover { background: rgba(0,0,0,.85); }
    `;
    document.head.appendChild(style);

    // 图片列表是 Vue 异步渲染的，翻页也不刷新整页，所以得盯着 DOM
    let timer = 0;
    new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(scan, 120);
    }).observe(document.documentElement, { childList: true, subtree: true });

    scan();

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(
            AUTO ? '切换为：点击后加载 GIF' : '切换为：自动加载 GIF',
            () => {
                localStorage.setItem(LS_KEY, AUTO ? '0' : '1');
                location.reload();
            }
        );
    }
})();
