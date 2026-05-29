# NodeGet Liquid Glass Theme

一个基于 NodeGet 官方主题二次开发的服务器状态展示页。

## 项目信息

- NodeGet 官网：<https://nodeget.com/>
- 主题仓库：<https://github.com/telly3e/NodeGet-LiquidStatusShow.git>
- 主题发布页：<https://nodeget-liquidstatusshow.pages.dev/>
- 部分视觉素材参考：<https://codepen.io/LeonLinBuild/pen/emdgRJj>
- 部分详情页延迟监测设计参考：<https://github.com/LangYa466/NodeGet-Nezha-dash-theme>

欢迎开发者基于此版本进行定制，也欢迎 PR 到本项目。

## 开发

```bash
npm i
npm run dev
```

本地开发默认读取 `.env.local` 中的 `NODEGET_CONFIG`。  
修改 `.env.local` 后需要重启一次 `npm run dev` 才会生效。

## 一键部署

一键部署需要主控版本在 `0.2.6` 以上，请先到[控制面板](https://dash.nodeget.com/#/dashboard/node-manage?tab=servers)查看主控版本。

<a href="https://dash.nodeget.com/#/dashboard/theme-management?add=https://nodeget-liquidstatusshow.pages.dev/">
  <img src="https://dash.nodeget.com/deploy-button.png" alt="deploy button" width="230px" />
</a>

## 静态文件部署

本项目构建完成后是纯静态站点，可以部署到 nginx、Cloudflare Pages、Vercel 等任意静态文件服务。

下载最新版构建产物：

<https://nodeget-liquidstatusshow.pages.dev/NodeGet-StatusShow.zip>

下载后修改 `config.json`，再上传到静态文件服务即可。

## Cloudflare Pages / Vercel 部署

推荐使用 `NODEGET_CONFIG` 环境变量注入配置。它必须是**完整 JSON**，不要额外再包一层单引号。

示例：

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
    "latency_aggregate_route": "",
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
| `latency_aggregate_route` | 空 | 可选的 NodeGet js worker 聚合路由；留空时前端直接查询原始 `task_query` |
| `show_value_stats_card` | `true` | 是否显示卡片页左侧“价值统计”卡片 |
| `show_online_total_card` | `true` | 是否显示卡片页左侧“在线 / 总节点”卡片 |
| `show_expiring_7_days_card` | `true` | 是否显示卡片页左侧“7 天内到期”卡片 |
| `show_expiring_soon_card` | `true` | 是否显示卡片页左侧“临近到期”卡片 |

## NodeGet js worker：延迟聚合

本主题支持通过 NodeGet 主控上的 **js worker** 对 `ping` / `tcp_ping` 历史做分钟聚合，再由前端读取聚合结果。  
这样可以明显降低主控在详情页延迟曲线和首页卡片延迟预览上的压力。

仓库中只保留 **js worker 脚本本体**，不再额外维护扩展打包目录。  
当前使用的脚本文件是：

- `nodeget-js-workers/latency-aggregator-worker.js`

### 推荐接入方式

1. 在 NodeGet 主控后台手动创建一个 js worker。
2. 将 `nodeget-js-workers/latency-aggregator-worker.js` 的内容完整复制进去。
3. 为这个 worker 绑定公开路由，例如：
   - `/worker-route/statusshow-latency/`
4. 在主题配置中加入：

```json
{
  "user_preferences": {
    "latency_aggregate_route": "/worker-route/statusshow-latency/"
  }
}
```

当前前端会对这个路由发起 **POST** 请求，并同时把参数放在 query string 和 JSON body 中，兼容不同 NodeGet 版本的 Worker 路由行为。

### 为什么推荐 js worker

- 首次访问时会按时间段分片拉取原始延迟数据，再写入 KV 缓存
- 后续访问默认只做增量刷新，不会每次都整窗重扫
- 首页卡片会优先走更轻量的 preview 聚合结果
- 前端直接读取分钟聚合结果，加载更快，也更不容易把主控打满
- Worker 会自动清理长期过期的 KV key，缓存不会一直无上限堆着

### Worker 环境变量

推荐配置：

```text
RPC_BASE_URL=https://nodeget.example.com
TOKEN=YOUR_WORKER_TOKEN
KV_NAMESPACE=latency_aggregate_cache
BUCKET_MS=60000
RETENTION_MS=86400000
CACHE_TTL_MS=55000
SEGMENT_MS=3600000
INCREMENTAL_OVERLAP_MS=120000
CLEANUP_GRACE_MS=86400000
CLEANUP_INTERVAL_MS=600000
RAW_QUERY_LIMIT=10000
PREFETCH_UUIDS=
PREFETCH_TYPES=tcp_ping,ping
```

这些变量的含义：

- `RPC_BASE_URL`：NodeGet 后端地址，通常对应你主题配置里的 `backend_url` 所在域名，使用 `https://...`
- `TOKEN`：专门给 Worker 使用的服务端 token
- `KV_NAMESPACE`：聚合缓存所在的 KV 命名空间
- `BUCKET_MS`：聚合粒度，默认 1 分钟
- `RETENTION_MS`：聚合结果保留时长，默认 24 小时
- `CACHE_TTL_MS`：缓存多久算过期；过期后前端请求会触发一次增量刷新
- `SEGMENT_MS`：首次全量回填时的分段拉取窗口，默认 1 小时一段
- `INCREMENTAL_OVERLAP_MS`：增量更新时向前回退的重叠时间，避免分钟边界漏点
- `CLEANUP_GRACE_MS`：过期 KV key 的额外保留时间
- `CLEANUP_INTERVAL_MS`：KV key 过期清扫的最小检查间隔
- `RAW_QUERY_LIMIT`：单次原始任务查询上限
- `PREFETCH_UUIDS`：可选；为空时只按需聚合，填 `*` 或逗号分隔 UUID 时可配合 cron 预热
- `PREFETCH_TYPES`：预热时需要处理的任务类型

### Worker 需要的权限

最少需要：

- `Task.Read("tcp_ping")`
- `Task.Read("ping")`
- `Kv.Read(...)`
- `Kv.Write(...)`

如果你使用 `PREFETCH_UUIDS=*`，还需要额外给出列出全部 agent UUID 的权限。

### Worker 当前行为

- 首次没有缓存时：按 `SEGMENT_MS` 分段全量回填
- 缓存存在且未过期时：直接返回 KV
- 缓存过期时：只增量补最近一段，不会每次整窗重扫
- 首页卡片请求会优先读取 preview 结果，减轻首屏请求压力
- Worker 会维护一份 KV key 索引，并自动清理长期过期的缓存 key

### 前端如何接入

只要主题配置里设置了：

```json
{
  "user_preferences": {
    "latency_aggregate_route": "/worker-route/statusshow-latency/"
  }
}
```

前端就会优先请求这个聚合路由；如果没有配置，或者 Worker 请求失败，则会回退到原始 `task_query` 查询逻辑。

### 手动测试

如果你的 Worker 路由是：

```text
https://nodeget.example.com/worker-route/statusshow-latency/
```

可以用浏览器控制台测试：

```js
fetch("https://nodeget.example.com/worker-route/statusshow-latency/?uuid=YOUR_UUID&type=tcp_ping", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    uuid: "YOUR_UUID",
    type: "tcp_ping"
  })
}).then(r => r.json()).then(console.log)
```

如果返回带 `rows` 的 JSON，就说明前端也能直接接入。

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
SITE_LATENCY_AGGREGATE_ROUTE=/worker-route/statusshow-latency/
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
