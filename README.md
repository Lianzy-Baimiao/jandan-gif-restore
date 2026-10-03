# 煎蛋 GIF 还原（mp4 → gif）

[![许可 MIT](https://img.shields.io/badge/许可-MIT-blue?style=flat-square)](LICENSE)
[![油猴脚本](https://img.shields.io/badge/UserScript-1.3.0-ff8c00?style=flat-square)](jandan-gif-restore.user.js)
[![赞赏 爱发电](https://img.shields.io/badge/赞赏-爱发电-946ce6?style=flat-square)](https://ifdian.net/a/lianzy)

煎蛋的无聊图/随手拍把 GIF 转成了 mp4 用 `<video>` 播放，画质掉得厉害，长图还会被裁。
这个脚本按同名规则推导出原始 GIF 地址，换回真正的 GIF。

## 安装

1. 装 [Tampermonkey](https://www.tampermonkey.net/)（Violentmonkey 也行）
2. **[点此安装脚本](https://raw.githubusercontent.com/Lianzy-Baimiao/jandan-gif-restore/main/jandan-gif-restore.user.js)**，确认安装后刷新煎蛋页面

脚本自带 `@updateURL`，之后由 Tampermonkey 自动检查更新。

## 功能

- **自动还原**：`/large/NAME.mp4` → `/large/NAME.gif`，取到就把 `<video>` 换成 `<img>`，
  顺手隐藏站点自己的静态缩略图，不会和 GIF 重复显示
- **懒加载兼容**：站点用 vue-lazyload，没进视口的图地址挂在 `data-src` 上，脚本一并读取；
  翻页时 Vue 复用 `<video>`，旧 GIF 会被清掉
- **镜像回源**：站点设置里的「通道2（国内优化）」会把图源指到 dfyun 镜像，
  那边发 mp4 没问题，但取几 MB 的原始 GIF 容易直接断连，
  所以拿 GIF 时先换回源站，失败再退回镜像，最后退回原来的 video
- **手动模式**：原始 GIF 普遍 5-8MB，一页二十来张就是上百 MB。
  嫌费流量的话在 Tampermonkey 菜单里切「点击后加载 GIF」，
  图上会出现一个小 `GIF` 按钮，点了才拉原图
- **不跳版**：替换前先占住原来的宽度

## 用法

装完就生效，没有设置界面。Tampermonkey 的脚本菜单里有一项开关：

- 当前是自动模式 → 显示「切换为：点击后加载 GIF」
- 当前是手动模式 → 显示「切换为：自动加载 GIF」

点一下写进 `localStorage` 并刷新页面。想直接改默认值的话，把脚本里 `LS_KEY` 那行的默认
`'1'` 改成 `'0'` 即可。

## 常见问题

**有些图没被还原**　说明那张本来就不是 GIF 转的 mp4（站点也有真视频），或者地址推导不出来。
想看具体情况，控制台执行 `localStorage.setItem('jd-gif-restore:debug','1')` 再刷新，
每轮扫描会打印找到多少 `video`、其中多少推导不出 GIF 地址。

**图片加载很慢 / 流量吃不消**　切到手动模式，见上面「用法」。

**换成 GIF 后一片空白**　源站和镜像都取不到的话脚本会自动退回 video。
如果停在空白，多半是网络层被掐了，关掉站点设置里的「通道2」再试。

**只在煎蛋生效吗**　是，`@match` 限定 `jandan.net`，且 `@noframes`。

## 许可

[MIT](LICENSE)
