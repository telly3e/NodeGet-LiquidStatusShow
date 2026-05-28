# NodeGet Liquid Glass Theme

一个基于 NodeGet 官方主题二次开发的服务器状态展示页。

## 项目信息

- NodeGet 官网：<https://nodeget.com/>
- 主题仓库：<https://github.com/telly3e/NodeGet-LiquidStatusShow.git>
- 主题发布页：<https://nodeget-liquidstatusshow.pages.dev/>
- 部分视觉素材参考：<https://codepen.io/LeonLinBuild/pen/emdgRJj>

欢迎开发者基于此版本进行定制，也欢迎 PR 到本项目。

## 开发

```bash
npm i
npm run dev
```

## 一键部署

一键部署需要主控版本在 `0.2.6` 以上，请先到[控制面板](https://dash.nodeget.com/#/dashboard/node-manage?tab=servers)查看主控版本。

<a href="https://dash.nodeget.com/#/dashboard/theme-management?add=https://nodeget-liquidstatusshow.pages.dev/">
  <img src="https://dash.nodeget.com/deploy-button.png" alt="deploy button" width="230px" />
</a>

## 基于静态文件部署

本项目构建完成后是纯静态站点，可以部署到 nginx、Cloudflare Pages、Vercel 等任意静态文件服务。

下载最新版构建产物：

<https://nodeget-liquidstatusshow.pages.dev/NodeGet-StatusShow.zip>

下载后修改 `config.json`，再上传到静态文件服务即可。

## 基于 Cloudflare Pages 编译部署

Fork 本仓库后，可以在 Cloudflare Pages / Vercel 直接部署并绑定域名。

推荐使用 `NODEGET_CONFIG` 环境变量注入配置，它必须是有效的 JSON 字符串：

```json
{
  "user_preferences": {
    "site_name": "NodeGet Status",
    "site_title": "",
    "site_logo": "",
    "footer": "Powered by NodeGet",
    "dashboard_url": "https://dash.nodeget.com/",
    "default_color_mode": "auto",
    "card_latency_monitor_name": "",
    "show_value_stats_card": true,
    "show_online_total_card": true,
    "show_expiring_7_days_card": true,
    "show_expiring_soon_card": true
  },
  "site_tokens": [
    {
      "name": "master server node 1",
      "backend_url": "wss://your-backend.example.com",
      "token": "YOUR_TOKEN_HERE"
    }
  ]
}
```

环境变量是在 **build 时** 注入的，修改后必须重新部署一次才会生效。

## 主题配置项

这些配置来自 `nodeget-theme.json` 的 `user_preferences_form.items`：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `site_name` | `NodeGet Status` | 顶栏显示的站点名称 |
| `site_title` | 空 | 浏览器标签页标题；留空使用默认 `NodeGet - StatusShow` |
| `site_logo` | 空 | 站点 Logo URL；留空使用内置 `logo.png` |
| `footer` | `Powered by NodeGet` | 页脚文字 |
| `dashboard_url` | `https://dash.nodeget.com/` | 节点管理面板地址；留空隐藏设置按钮 |
| `default_color_mode` | `auto` | 默认颜色模式，可选 `auto` / `light` / `dark` |
| `card_latency_monitor_name` | 空 | 首页卡片延迟预览使用的监测点名称；留空不显示卡片延迟预览 |
| `show_value_stats_card` | `true` | 是否显示卡片页左侧“价值统计”卡片 |
| `show_online_total_card` | `true` | 是否显示卡片页左侧“在线 / 总节点”卡片 |
| `show_expiring_7_days_card` | `true` | 是否显示卡片页左侧“7 天内到期”卡片 |
| `show_expiring_soon_card` | `true` | 是否显示卡片页左侧“临近到期”卡片 |

## 旧版环境变量

仍然兼容旧版分散环境变量，但更推荐使用 `NODEGET_CONFIG`。

```env
SITE_NAME=狼牙的探针
SITE_TITLE=NodeGet - StatusShow
SITE_LOGO=https://example.com/logo.png
SITE_FOOTER=Powered by NodeGet
SITE_DASHBOARD_URL=https://dash.nodeget.com/
SITE_DEFAULT_COLOR_MODE=auto
SITE_CARD_LATENCY_MONITOR_NAME=monitor-name
SITE_SHOW_VALUE_STATS_CARD=true
SITE_SHOW_ONLINE_TOTAL_CARD=true
SITE_SHOW_EXPIRING_7_DAYS_CARD=true
SITE_SHOW_EXPIRING_SOON_CARD=true
SITE_1=name="master-1",backend_url="wss://m1.example.com",token="abc123"
SITE_2=name="master-2",backend_url="wss://m2.example.com",token="xyz789"
```

`SITE_n` 是主控配置，值使用 `key="value"` 的逗号分隔格式，支持 `name` / `backend_url` / `token` 三个字段。值里需要写引号或反斜杠时，用 `\"` 和 `\\` 转义。

`SITE_n` 从 `SITE_1` 开始连续读取，中间断了就停止；添加新主控时继续使用 `SITE_3`、`SITE_4` 即可。

如果没有设置任何 `SITE_n`，构建脚本不会生成新的主控配置，会继续使用仓库里的默认 `config.json`。本地 `npm run dev` 由 Vite 直接启动，也不会触发构建期环境变量注入。
