// ==UserScript==
// @name         煎蛋 GIF 还原（mp4 → gif）
// @namespace    https://github.com/Lianzy-Baimiao/jandan-gif-restore
// @version      1.4.1
// @description  把煎蛋无聊图/随手拍里用 <video> 播放的 mp4 换回同名的原始 GIF，方便右键复制或拖进 QQ 等 IM 转发
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

    // ---------------------------------------------------------------- 设置

    const CFG_KEY = 'jd-gif-restore:cfg';
    const OLD_AUTO_KEY = 'jd-gif-restore:auto';    // 1.3.x
    const OLD_DEBUG_KEY = 'jd-gif-restore:debug';  // 1.3.x

    const DEFAULTS = {
        mode: 'auto',      // auto：滑到就换；manual：图上出现按钮，点了才换
        margin: 200,       // 提前几屏开始取图；'all' 表示整页一次性全取（1.3.x 的行为）
        origin: true,      // 取 GIF 时把 dfyun 镜像换回源站
        hideThumb: true,   // 换好后隐藏站点自己的静态缩略图
        fab: true,         // 页面右下角显示设置按钮
        debug: false,
    };

    function loadCfg() {
        const c = Object.assign({}, DEFAULTS);
        try {
            const raw = localStorage.getItem(CFG_KEY);
            if (raw) {
                Object.assign(c, JSON.parse(raw));
            } else {
                // 从 1.3.x 的两个独立开关迁移过来
                if (localStorage.getItem(OLD_AUTO_KEY) === '0') c.mode = 'manual';
                if (localStorage.getItem(OLD_DEBUG_KEY) === '1') c.debug = true;
            }
        } catch (e) {
            // 存的内容坏了就用默认值，不要把脚本卡死
        }
        return c;
    }

    const cfg = loadCfg();

    function saveCfg() {
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 隐私模式等写不进去 */ }
    }

    // ---------------------------------------------------------------- 地址推导

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
        if (!cfg.origin) return [mirror];
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

    // ---------------------------------------------------------------- 替换

    // 每个 <video> 对应一条记录：候选地址、插进去的 <img>、按钮、被隐藏的缩略图。
    // 用 WeakMap 而不是靠 previousElementSibling 找回 <img>：
    // Vue 要是在中间插了节点，按兄弟节点找就找不着了，旧 GIF 会留在 DOM 里继续下载。
    const state = new WeakMap();

    function cleanup(video) {
        const st = state.get(video);
        if (!st) return;
        if (st.img) st.img.remove();
        if (st.btn) st.btn.remove();
        if (st.thumbs) for (const n of st.thumbs) n.style.display = '';
        video.style.display = '';
        video.classList.remove('d-none');
        state.delete(video);
        if (io) io.unobserve(video);
    }

    // 量一次 <video> 的宽度，返回能直接写进 style.width 的字符串（量不到返回 ''）。
    // 读 getBoundingClientRect 会强制同步布局，所以调用方尽量先把一批都量完再插节点。
    function measure(video) {
        if (video.style.width) return video.style.width;
        const w = video.getBoundingClientRect().width;
        return w ? w + 'px' : '';
    }

    // width 由下面的批量流程预先量好传进来；手动点按钮那种单个的场合不传，现场量。
    function restore(video, width) {
        const st = state.get(video);
        if (!st || st.restored) return;
        const box = video.parentElement;
        if (!box) return;
        st.restored = true;

        const img = document.createElement('img');
        img.className = 'jd-gif-restored';
        img.referrerPolicy = 'no-referrer';
        // 解码放到别的线程，别卡住滚动
        img.decoding = 'async';
        // 这里刻意不加 loading="lazy"：取图时机由下面的 IntersectionObserver 按
        // 「提前加载范围」控制，浏览器自带的惰性阈值不可调（约 1250px），
        // 两道闸门叠在一起只会让设置项失效
        img.alt = 'GIF';

        // 先占住原来的宽度，替换时不跳版
        if (width === undefined) width = measure(video);
        if (width) img.style.width = width;

        img.addEventListener('load', () => {
            if (video.pause) video.pause();
            video.removeAttribute('autoplay');
            video.style.display = 'none';
            // 站点自己的静态缩略图，留着会和 GIF 重复显示
            if (cfg.hideThumb) {
                st.thumbs = [...box.querySelectorAll('img.img-min, img.gif-shot-thumb')];
                for (const n of st.thumbs) n.style.display = 'none';
            }
        });

        // 挨个试候选地址（源站 → 镜像），都不行就退回原来的 video
        let i = 0;
        img.addEventListener('error', () => {
            if (cfg.debug) console.log('[jd-gif] 取 GIF 失败:', st.candidates[i]);
            if (++i < st.candidates.length) {
                img.src = st.candidates[i];
                return;
            }
            img.remove();
            st.img = null;
            st.restored = false;
            video.style.display = '';
            video.classList.remove('d-none');
        });

        st.img = img;
        // 先进文档再给 src：给游离节点赋 src 会立刻发请求，
        // 而且此时拿不到布局，占位宽度也就白设了
        box.insertBefore(img, video);
        img.src = st.candidates[0];
    }

    // 手动模式：盖一个小按钮，点了才拉原图
    function arm(video) {
        const st = state.get(video);
        if (!st || st.btn || st.restored) return;
        const box = video.parentElement;
        if (!box) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'jd-gif-btn';
        btn.textContent = 'GIF';
        btn.title = '加载原始 GIF';
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.remove();
            st.btn = null;
            restore(video);
        });

        st.btn = btn;
        if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
        box.appendChild(btn);
    }

    // ---------------------------------------------------------------- 视口门控

    // 原始 GIF 普遍 5-8MB，一页二十来张就是上百 MB，而且浏览器会把每张都解码、
    // 持续动画化，解码后的帧缓存比文件本身还大。所以自动模式也只取快要看到的那几张。
    let io = null;
    function makeIO() {
        if (io) { io.disconnect(); io = null; }
        if (cfg.mode !== 'auto' || cfg.margin === 'all') return;
        if (typeof IntersectionObserver !== 'function') return;  // 老浏览器直接退回立即加载
        io = new IntersectionObserver((entries, obs) => {
            const hit = [];
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                obs.unobserve(e.target);
                hit.push(e.target);
            }
            restoreBatch(hit);
        }, { rootMargin: `${cfg.margin}% 0px` });
    }

    // 先把这一批的宽度全量完，再统一插节点。
    // 量宽度（读）和插节点（写）交替进行的话，每次读都会强制同步布局，
    // 一批二十个就是二十次重排。
    function restoreBatch(videos) {
        if (!videos.length) return;
        if (videos.length === 1) { restore(videos[0]); return; }
        const widths = videos.map(measure);
        for (let i = 0; i < videos.length; i++) restore(videos[i], widths[i]);
    }

    // 立即加载的那条路（「立即全部加载」或老浏览器没有 IntersectionObserver）
    // 会一次处理一整页，所以把 video 先攒进 batch，由调用方量完宽度再统一插。
    function apply(video, batch) {
        if (cfg.mode === 'manual') arm(video);
        else if (io) io.observe(video);
        else if (batch) batch.push(video);
        else restore(video);
    }

    // ---------------------------------------------------------------- 扫描

    function scan() {
        let fresh = 0, bad = 0;
        const badSrc = [];
        const batch = [];
        for (const v of document.querySelectorAll('video')) {
            const raw = videoSrc(v);
            // 地址没变过就跳过。脚本自己插 <img>、删按钮也会触发 MutationObserver，
            // 这个比对把那些空转挡在正则和内存分配之前。
            if (v.dataset.jdSrc === raw) continue;
            v.dataset.jdSrc = raw;
            fresh++;
            cleanup(v);   // 地址变了说明翻页时 Vue 复用了这个 <video>
            const candidates = toGifUrl(raw);
            if (!candidates) {
                bad++;
                if (cfg.debug && badSrc.length < 3) badSrc.push(raw || '(src 为空)');
                continue;
            }
            state.set(v, { candidates });
            apply(v, batch);
        }
        restoreBatch(batch);
        if (cfg.debug && fresh) {
            console.log('[jd-gif] 新增 video:', fresh, '｜推导不出 GIF 地址:', bad, badSrc);
        }
    }

    // 改了设置之后重新铺一遍：已经换成 GIF 的不动，剩下的按新设置处理
    function reapply() {
        makeIO();
        const batch = [];
        for (const v of document.querySelectorAll('video')) {
            const st = state.get(v);
            if (st && st.restored) continue;
            if (st && st.btn) { st.btn.remove(); st.btn = null; }
            const candidates = toGifUrl(v.dataset.jdSrc || videoSrc(v));
            if (!candidates) continue;
            state.set(v, { candidates });
            apply(v, batch);
        }
        restoreBatch(batch);
    }

    // 图片列表是 Vue 异步渲染的，翻页也不刷新整页，所以得盯着 DOM。
    // 纯后沿防抖会被持续的 DOM 变更（评论轮询之类）无限推迟，所以加个最长等待。
    const DEBOUNCE = 120;
    const MAX_WAIT = 500;
    let timer = 0;
    let queuedAt = 0;

    function runScan() {
        clearTimeout(timer);
        timer = 0;
        queuedAt = 0;
        scan();
    }

    function queueScan() {
        const now = Date.now();
        if (!queuedAt) queuedAt = now;
        if (now - queuedAt >= MAX_WAIT) { runScan(); return; }
        clearTimeout(timer);
        timer = setTimeout(runScan, DEBOUNCE);
    }

    // ---------------------------------------------------------------- 设置面板

    const MARGIN_OPTIONS = [
        ['all', '立即全部加载（最费流量）'],
        [400, '提前四屏'],
        [200, '提前两屏（推荐）'],
        [100, '提前一屏'],
        [0, '只加载当前屏'],
    ];

    let panel = null;

    function buildPanel() {
        const wrap = document.createElement('div');
        wrap.className = 'jd-gif-mask';
        wrap.hidden = true;
        wrap.innerHTML = `
            <div class="jd-gif-panel" role="dialog" aria-modal="true" aria-labelledby="jd-gif-title">
                <div class="jd-gif-head">
                    <h2 id="jd-gif-title">GIF 还原设置</h2>
                    <button type="button" class="jd-gif-x" data-act="close" aria-label="关闭设置">×</button>
                </div>

                <fieldset class="jd-gif-row">
                    <legend>加载方式</legend>
                    <label><input type="radio" name="jd-gif-mode" value="auto"> 自动换成 GIF</label>
                    <label><input type="radio" name="jd-gif-mode" value="manual"> 图上显示按钮，点了再换</label>
                </fieldset>

                <div class="jd-gif-row" data-only="auto">
                    <label for="jd-gif-margin">提前加载范围</label>
                    <select id="jd-gif-margin"></select>
                    <p class="jd-gif-hint">原始 GIF 普遍 5-8MB。范围越大滑动越跟手，流量和内存也吃得越多。</p>
                </div>

                <div class="jd-gif-row">
                    <label><input type="checkbox" data-cfg="origin"> 取 GIF 时换回源站</label>
                    <p class="jd-gif-hint">站点「通道2（国内优化）」的镜像发大 GIF 容易断连。关掉就直接用镜像。</p>
                </div>

                <div class="jd-gif-row">
                    <label><input type="checkbox" data-cfg="hideThumb"> 隐藏站点自带的静态缩略图</label>
                </div>

                <div class="jd-gif-row">
                    <label><input type="checkbox" data-cfg="fab"> 页面右下角显示这个设置按钮</label>
                    <p class="jd-gif-hint">关掉之后从 Tampermonkey 的脚本菜单进来。</p>
                </div>

                <div class="jd-gif-row">
                    <label><input type="checkbox" data-cfg="debug"> 控制台输出排查日志</label>
                </div>

                <p class="jd-gif-hint">改完立刻生效，已经换好的图不会退回去。</p>
                <div class="jd-gif-foot">
                    <button type="button" data-act="reset">恢复默认</button>
                    <button type="button" class="jd-gif-primary" data-act="close">完成</button>
                </div>
            </div>`;

        const sel = wrap.querySelector('#jd-gif-margin');
        for (const [val, text] of MARGIN_OPTIONS) {
            const o = document.createElement('option');
            o.value = String(val);
            o.textContent = text;
            sel.appendChild(o);
        }

        // 点遮罩空白处关闭，但别让点击冒到站点自己的监听上
        wrap.addEventListener('click', e => {
            if (e.target === wrap) closePanel();
        });
        wrap.addEventListener('change', e => {
            const t = e.target;
            if (t.name === 'jd-gif-mode') cfg.mode = t.value;
            else if (t.id === 'jd-gif-margin') cfg.margin = t.value === 'all' ? 'all' : Number(t.value);
            else if (t.dataset.cfg) cfg[t.dataset.cfg] = t.checked;
            else return;
            saveCfg();
            syncPanel();
            syncFab();
            reapply();
        });
        wrap.addEventListener('click', e => {
            const act = e.target.dataset && e.target.dataset.act;
            if (act === 'close') closePanel();
            if (act === 'reset') {
                Object.assign(cfg, DEFAULTS);
                saveCfg();
                syncPanel();
                syncFab();
                reapply();
            }
        });

        document.body.appendChild(wrap);
        return wrap;
    }

    function syncPanel() {
        if (!panel) return;
        for (const r of panel.querySelectorAll('input[name="jd-gif-mode"]')) {
            r.checked = r.value === cfg.mode;
        }
        panel.querySelector('#jd-gif-margin').value = String(cfg.margin);
        for (const c of panel.querySelectorAll('input[data-cfg]')) {
            c.checked = !!cfg[c.dataset.cfg];
        }
        for (const el of panel.querySelectorAll('[data-only="auto"]')) {
            el.hidden = cfg.mode !== 'auto';
        }
    }

    function onKey(e) {
        if (e.key === 'Escape') closePanel();
    }

    function openPanel() {
        if (!panel) panel = buildPanel();
        syncPanel();
        panel.hidden = false;
        document.addEventListener('keydown', onKey);
        const first = panel.querySelector('input[name="jd-gif-mode"]:checked') ||
            panel.querySelector('input,select,button');
        if (first) first.focus();
    }

    function closePanel() {
        if (!panel) return;
        panel.hidden = true;
        document.removeEventListener('keydown', onKey);
    }

    let fab = null;
    function syncFab() {
        if (cfg.fab && !fab) {
            fab = document.createElement('button');
            fab.type = 'button';
            fab.className = 'jd-gif-fab';
            fab.textContent = 'GIF';
            fab.title = 'GIF 还原设置';
            fab.setAttribute('aria-label', 'GIF 还原设置');
            fab.addEventListener('click', openPanel);
            document.body.appendChild(fab);
        } else if (!cfg.fab && fab) {
            fab.remove();
            fab = null;
        }
    }

    // ---------------------------------------------------------------- 样式

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

        .jd-gif-fab {
            position: fixed; right: 14px; bottom: 14px; z-index: 99998;
            padding: 5px 9px; border: 0; border-radius: 4px;
            font: 600 11px/1.6 system-ui, sans-serif;
            color: #fff; background: rgba(0,0,0,.42); cursor: pointer;
            opacity: .5; transition: opacity .15s, background .15s;
        }
        .jd-gif-fab:hover, .jd-gif-fab:focus-visible { opacity: 1; background: rgba(0,0,0,.8); }

        .jd-gif-mask {
            position: fixed; inset: 0; z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,.45);
        }
        .jd-gif-mask[hidden] { display: none; }
        .jd-gif-panel {
            width: min(92vw, 420px); max-height: 86vh; overflow: auto;
            box-sizing: border-box; padding: 16px 18px 14px;
            border-radius: 8px; background: #fff; color: #222;
            font: 13px/1.7 system-ui, -apple-system, "Microsoft YaHei", sans-serif;
            box-shadow: 0 10px 40px rgba(0,0,0,.3);
        }
        .jd-gif-head { display: flex; align-items: center; justify-content: space-between; }
        .jd-gif-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
        .jd-gif-x {
            border: 0; background: none; cursor: pointer;
            font-size: 20px; line-height: 1; color: #888; padding: 0 2px;
        }
        .jd-gif-x:hover { color: #222; }
        .jd-gif-row {
            margin: 14px 0 0; padding: 0; border: 0;
            border-top: 1px solid #eee; padding-top: 12px;
        }
        .jd-gif-row[hidden] { display: none; }
        .jd-gif-row legend { padding: 0; font-weight: 600; }
        .jd-gif-row > label { display: block; cursor: pointer; }
        .jd-gif-row input[type=radio], .jd-gif-row input[type=checkbox] {
            margin: 0 6px 0 0; vertical-align: -1px;
        }
        .jd-gif-row select { width: 100%; margin-top: 4px; padding: 4px; font: inherit; }
        .jd-gif-hint { margin: 4px 0 0; color: #888; font-size: 12px; line-height: 1.6; }
        .jd-gif-foot {
            display: flex; gap: 8px; justify-content: flex-end;
            margin-top: 14px; padding-top: 12px; border-top: 1px solid #eee;
        }
        .jd-gif-foot button {
            padding: 5px 14px; border: 1px solid #ccc; border-radius: 4px;
            background: #fafafa; color: #222; font: inherit; cursor: pointer;
        }
        .jd-gif-foot button:hover { background: #f0f0f0; }
        .jd-gif-foot .jd-gif-primary { border-color: #c33; background: #c33; color: #fff; }
        .jd-gif-foot .jd-gif-primary:hover { background: #b22; }
    `;
    document.head.appendChild(style);

    // ---------------------------------------------------------------- 启动

    makeIO();
    syncFab();

    new MutationObserver(queueScan).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    scan();

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('GIF 还原设置…', openPanel);
        GM_registerMenuCommand('快速切换：自动 / 点击加载', () => {
            cfg.mode = cfg.mode === 'auto' ? 'manual' : 'auto';
            saveCfg();
            syncPanel();
            reapply();
        });
    }
})();
