# dsh-money-meter

一个 DeepSeek Harness 插件：在输入框下方的统计行上显示**本次会话花了多少钱**和**账户还剩多少钱**。

```
  [¥ 消耗 ¥0.0568 · 剩余 ¥85.04]        [2 轮 40 步 · 242 tok/s] [4.1M tok · 缓存命中 97%]
```

点击药丸会**向上**弹出明细卡片——与内置「会话统计」药丸完全一致的交互方式——所以无论是挂载还是展开，输入框都不会移动。

## 显示内容

| 行 | 含义 |
| --- | --- |
| 本次会话消耗 | 当前会话在插件挂载期间累计的花费 |
| 今日消耗 | 本地零点起的累计花费 |
| 运行以来 | 插件挂载起的累计花费 |
| 输入 / 输出 / 缓存读 tokens | 本次会话的 token 构成 |
| 账户余额 | `GET /user/balance` 的 `total_balance`，账户报 CNY 时即人民币 |
| 余额更新 | 最近一次成功读取余额的时刻 |
| 按模型明细 | 花费最高的五条 `provider/model` 路由 |

余额 ≤ ¥10 时数字转为警示色。

## 安装

```bash
dsh plugin --profile web add <路径或 git 地址>
```

然后重启 DSH。`dsh plugin` 会在 profile 目录里转发给 pnpm，并在成功后同步 `dsh.profile.bundles`；`cordis.patch.yml` 里的 bundle patch 用单独一行 `money-meter` 同时挂载 Host 与浏览器两半。

本地目录安装：

```bash
dsh plugin --profile web add <插件包所在目录>
```

## 实现

```
Host  index.js
  ├─ llm/stream 瀑布 ──▶ lib/usage.js   （一个 usage chunk → 会话/当日/累计/按模型 四个视图）
  ├─ lib/balance.js  ──▶ ctx.credentials + ctx.subprocess（curl -K -）
  └─ lib/rpc.js      ──▶ POST /dsh-money-meter  {snapshot, refresh}
                                    ▲
Client  client.js                   │ connection.rpc.call(...)
  └─ conversation.composer.dock ────┘
```

三个值得说明的点：

- **余额不能在浏览器里查。** 该接口需要 bearer token，本部署的 `ctx.web.fetch` 只接受 URL，而且页面发起的请求会撞 CORS。所以由 Host 从 `ctx.credentials` 取密钥，再通过 curl 请求，并且密钥走 **stdin**（`curl -K -`）而不是 argv——argv 对本机所有进程可见。
- **药丸寄居在统计行里，不新增一行。** 它的根节点是一个零高度的 flex item，药丸本身按统计行自己的盒模型绝对定位到该行最左；统计行再用 `[data-composer-stats]:has(+ .dsh-mm)` 让位，让位宽度取自实测药丸宽度写进的 `--dsh-mm-reserve`——所以让位量跟着真实数字宽度走，而不是写死一个估计值。
- **面板是浮层，不是布局子节点。** 它绝对定位在药丸上方，视觉全部复刻内置弹层（`--dsw-specific-menu`、`--dsw-elevation-prominent`、12px 圆角、16px 内边距、`dt`/`dd` 网格）。

## 价目表

单位为人民币 / **百万** tokens：

| 模型 | 输入 | 输出 | 缓存读 |
| --- | --- | --- | --- |
| `deepseek-v4-flash`、`deepseek-flash`、`deepseek-v4-flash-vision-exp` | 1.5 | 4.5 | 0.05 |
| `deepseek-v4-pro`、`deepseek-pro` | 4.5 | 13.5 | 0.15 |
| 其他模型 | 1.5 | 4.5 | 0.05 |

推理（reasoning）tokens **不额外计费**：服务商已把它们并入 `outputTokens`，`tests/pricing.test.js` 用测试锁住了这一点。

可通过组合行覆盖：

```yaml
- id: money-meter
  name: 'dsh-money-meter'
  config:
    prices:
      some-model: { input: 2, output: 8, cacheRead: 0.5 }
    credentialName: MY_API_KEY
    baseUrl: https://api.deepseek.com
```

## 验证

```bash
npm run verify     # 静态检查 + 回归测试
```

`scripts/check.mjs` 会逐个 import 所有模块，并用桩 `react` 真正 factory 执行一遍浏览器 bundle——所以「在页面里会挂掉的 bundle」在这里就会先失败。`tests/pricing.test.js` 重放另一个独立用量插件写下的六条历史账本记录，断言价目表能把每一条复现到 1e-4 以内的相对误差。

## 已知限制

- **会话花费的作用域是插件生命周期。** DSH 没有账户级消费接口，所以「本次会话 / 今日 / 运行以来」都从 Host 插件挂载时从零开始，DSH 重启后清零。
- 统计的是**经过 agent loop 的调用**。压缩（compaction）与会话标题生成同样会产生 usage，也计入其中。
- `剩余` 读取接口返回的币种，优先 CNY。

## 许可证

MIT
