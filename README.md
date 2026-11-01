# dsh-doubao

给 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai) 接上豆包（火山方舟）的**眼睛和画笔**：看图、Seedream 出图、Seedance 视频。零第三方依赖，Key 只存本地。

## 安装（从 GitHub）

本插件是 DSH 的 **bundle 形态**插件（`package.json` 里 `dsh.bundle.patch` 指向 `cordis.patch.yml`），从 GitHub 直接安装：

```bash
# 方式一：DSH 插件命令（推荐）
dsh plugin --profile desktop add git+https://github.com/zhengshupei-dshhub/dsh-doubao.git

# 方式二：写进 profile 的 package.json 后装依赖
#   "dsh-doubao": "git+https://github.com/zhengshupei-dshhub/dsh-doubao.git"
pnpm install
```

装好后把 `dsh-doubao` 加进 profile 的 `dsh.profile.bundles`（若用 `dsh plugin add` 会自动加），重启 DSH 即可。

> 国内网络拉 GitHub 需要代理；`pnpm`/`git` 走 `HTTPS_PROXY`，例如 `export HTTPS_PROXY=http://127.0.0.1:7897`。

## 工具

| 工具 | 作用 |
|---|---|
| `doubao_status` | 检查 Key 是否有效、配置的模型是否在账号可见列表里 |
| `doubao_see` | 看图：本地路径 / http(s) URL / dataURL + 可选问题，返回视觉模型的描述或回答 |
| `doubao_draw` | Seedream 文生图，存到输出目录，返回绝对路径 |
| `doubao_video` | Seedance 文生/图生视频（异步任务轮询），存 mp4，返回路径 |

## Key 与开通

1. Key 存 `~/.dsh/doubao.json`（权限 600）：
   ```json
   { "apiKey": "ark-...", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3" }
   ```
2. 方舟账号需要**开通对应模型**（控制台 → 开通管理），否则调用会返回 `ModelNotOpen`；也可以创建推理接入点，把配置里的模型 ID 换成 `ep-...`。
3. 先用 `doubao_status` 看一眼：可见 ≠ 已开通，真正调用才暴露。

## 配置

bundle 自带一行 `insert`，默认值都在 `cordis.patch.yml` 注释里：

```yaml
- insert:
    - id: doubao
      name: dsh-doubao
      config:
        watermark: false
        # keyFile: ~/.dsh/doubao.json
        # visionModel: doubao-seed-2-1-pro-260915
        # imageModel: doubao-seedream-4-0-20260415
        # videoModel: doubao-seedance-2-5-260628
        # outputDir: ~/DeepSeekHarness/BigFish/doubao-output
```

## 开发

```bash
node --test test/ark.test.js
```

改完代码后 HMR 不一定重新 import（DSH 对 link/git 安装的插件不会重载模块），以工具列表/日志里的版本为准，必要时重启 DSH。

## 更新

```bash
git clone https://github.com/zhengshupei-dshhub/dsh-doubao.git
# 改代码 → 跑测试 → 提 PR 或直接 push 到 main
# 使用端重新拉取：
cd ~/.dsh/profiles/desktop && pnpm update dsh-doubao
# 或者重装：dsh plugin --profile desktop remove dsh-doubao
#        dsh plugin --profile desktop add git+https://github.com/zhengshupei-dshhub/dsh-doubao.git
```

## License

MIT
