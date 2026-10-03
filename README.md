# 煎蛋 GIF 还原（mp4 → gif）

[![许可 MIT](https://img.shields.io/badge/许可-MIT-blue?style=flat-square)](LICENSE)
[![用户脚本](https://img.shields.io/badge/UserScript-1.4.1-ff8c00?style=flat-square)](jandan-gif-restore.user.js)
[![赞赏 爱发电](https://img.shields.io/badge/赞赏-爱发电-946ce6?style=flat-square)](https://ifdian.net/a/lianzy)

煎蛋的无聊图/随手拍把 GIF 转成了 mp4，用 `<video>` 播放。页面上看着没什么区别，
想把图顺手丢到 QQ 群里就卡住了：右键出来的是视频那一套菜单，没有「复制图片」；
拖进聊天窗口不认；存下来是个 `.mp4` 文件，发出去成了视频附件，不是会动的表情图。

这个脚本按同名规则推导出原始 GIF 地址，把 `<video>` 换回真正的 `<img>`。
之后右键「复制图片」直接粘进聊天框，或者把图拖进聊天窗口，发过去就是 GIF。

## 安装

先装一个脚本管理器，再点下面的安装链接。

### 脚本管理器

| 管理器 | 适用 | 说明 |
| --- | --- | --- |
| [脚本猫 ScriptCat](https://scriptcat.org/zh-CN) | Chrome / Edge / Firefox | 国内团队做的，中文界面，兼容油猴脚本格式和 GM API |
| [Tampermonkey](https://www.tampermonkey.net/) | Chrome / Edge / Firefox / Safari / Opera | 用得最多的那个 |
| [Violentmonkey](https://violentmonkey.github.io/) | Chrome / Edge / Firefox | 开源，界面清爽 |
| [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) | Safari（macOS / iOS） | 苹果端的开源选择，iPhone 上也能装 |

这几个装哪个都行。本脚本只用到一个扩展 API（`GM_registerMenuCommand`，就是管理器菜单里那两项快捷开关），
而且代码里做了存在性判断 —— 管理器不提供这个 API 也能正常跑，设置照样从页面右下角的 `GIF` 按钮进。

### 装脚本

**[点此安装](https://raw.githubusercontent.com/Lianzy-Baimiao/jandan-gif-restore/main/jandan-gif-restore.user.js)**

管理器会弹出确认页，确认后刷新煎蛋页面即可。脚本自带 `@updateURL`，之后由管理器自动检查更新。

装不上的话，就手动来：把 [脚本源码](jandan-gif-restore.user.js) 全选复制，
在管理器里新建一个空脚本，粘贴进去保存。

## 搬运

还原之后页面上就是一张普通 GIF 图片，正常的图片操作都能用：

- 右键 **复制图片**，到聊天框 `Ctrl+V`
- 按住图**直接拖**进聊天窗口
- 右键 **图片另存为**，存下来是 `.gif`，再当图片发

只要文件本身是真 GIF，支持动图的客户端发过去就会动。具体某个 IM 客户端的表现没法逐个验证，
QQ 我自己在用，没遇到问题。

## 设置

页面右下角有个半透明的 `GIF` 按钮，点开就是设置面板；也可以从脚本管理器的菜单进。
改完即时生效，不用刷新，已经换好的图不会退回去。

| 设置项 | 说明 |
| --- | --- |
| **加载方式** | 自动换成 GIF，或者图上显示按钮、点了再换 |
| **提前加载范围** | 自动模式下提前几屏开始取图：四屏 / 两屏（默认）/ 一屏 / 只当前屏，也可以选「立即全部加载」 |
| **取 GIF 时换回源站** | 默认开。关掉就直接用站点的镜像域名 |
| **隐藏站点自带的静态缩略图** | 默认开。关掉会和 GIF 同时显示 |
| **页面右下角显示设置按钮** | 嫌挡着就关掉，之后从管理器菜单进来 |
| **控制台输出排查日志** | 打印每轮扫到多少 `video`、多少推导不出 GIF 地址 |

设置存在 `localStorage` 的 `jd-gif-restore:cfg` 里。1.3.x 的旧开关会自动迁移过来。
管理器菜单里另有一项「快速切换：自动 / 点击加载」，不开面板也能换模式。

## 功能

- **换回原图**：`/large/NAME.mp4` → `/large/NAME.gif`，取到就把 `<video>` 换成 `<img>`，
  顺手隐藏站点自己的静态缩略图，不会和 GIF 重复显示
- **按需加载**：原始 GIF 普遍 5-8MB，一页二十来张就是上百 MB，而且浏览器会把每张都解码、
  持续动画化，解码后的帧缓存比文件本身还大。所以自动模式只取快要看到的那几张，
  默认提前两屏
- **懒加载兼容**：站点用 vue-lazyload，没进视口的图地址挂在 `data-src` 上，脚本一并读取；
  翻页时 Vue 复用 `<video>`，旧 GIF 会被清掉
- **镜像回源**：站点设置里的「通道2（国内优化）」会把图源指到 dfyun 镜像，
  那边发 mp4 没问题，但取几 MB 的原始 GIF 容易直接断连，
  所以拿 GIF 时先换回源站，失败再退回镜像，最后退回原来的 video
- **不跳版**：替换前先占住原来的宽度。一批图一起换的时候先把宽度全量完再统一插节点，
  避免量宽度和插节点交替触发强制同步布局

## 常见问题

**该装哪个管理器**　都行，上面表格里随便挑一个。想要中文界面就脚本猫，
想要用的人最多、教程最好找就 Tampermonkey，在乎开源就 Violentmonkey，
Safari 用户装 Userscripts。

**换管理器要重新设置吗**　要。设置存在 `localStorage` 里，按浏览器+域名隔离，
换浏览器要重新调；同一个浏览器里换管理器则不受影响。

**为什么不存下 mp4 自己转 GIF**　站点上原始 GIF 本来就还在，同名同目录，换个后缀就能取到。
转码一道既费时间又掉画质，没必要。

**有些图没被还原**　说明那张本来就不是 GIF 转的 mp4（站点也有真视频），或者地址推导不出来。
想看具体情况，在设置面板里打开「控制台输出排查日志」。

**图片加载很慢 / 流量吃不消**　把「提前加载范围」调小，或者直接切成点击加载。

**换成 GIF 后一片空白**　源站和镜像都取不到的话脚本会自动退回 video。
如果停在空白，多半是网络层被掐了，关掉站点设置里的「通道2」再试。

**只在煎蛋生效吗**　是，`@match` 限定 `jandan.net`，且 `@noframes`。

## 许可

[MIT](LICENSE)
