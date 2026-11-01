/**
 * dsh-doubao — 给大肥鱼接上眼睛、画笔和（后续）喉咙的本地 DSH 插件。
 *
 * 工具：
 * - doubao_status：检查 Key 与模型开通情况
 * - doubao_see：看图（本地文件 / URL / dataURL）
 * - doubao_draw：Seedream 出图，存到工作区
 * - doubao_video：Seedance 文生/图生视频，异步轮询后存 mp4
 *
 * 零第三方依赖，只读 ~/.dsh/doubao.json 里的 Key。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ArkClient,
  downloadImage,
  downloadTo,
  expandHome,
  loadKey,
  pickImage,
  toImageUrl,
  writeImage,
} from './lib/ark.js'
import { DEFAULT_MODELS, FALLBACK_MODELS } from './lib/models.js'

export const name = 'doubao'
export const inject = ['tools']

function readConfig(config) {
  const outputDir =
    typeof config?.outputDir === 'string' && config.outputDir.trim()
      ? expandHome(config.outputDir.trim())
      : path.join(os.homedir(), 'DeepSeekHarness', 'BigFish', 'doubao-output')
  return {
    keyFile: config?.keyFile || '~/.dsh/doubao.json',
    baseUrl: config?.baseUrl,
    models: {
      vision: config?.visionModel || DEFAULT_MODELS.vision,
      image: config?.imageModel || DEFAULT_MODELS.image,
      video: config?.videoModel || DEFAULT_MODELS.video,
    },
    outputDir,
    watermark: config?.watermark === true,
    videoTimeoutMs: Number.isFinite(config?.videoTimeoutMs) ? config.videoTimeoutMs : 300_000,
    timeoutMs: Number.isFinite(config?.timeoutMs) ? config.timeoutMs : 120_000,
  }
}

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  }
}

function client(config) {
  const key = loadKey(config.keyFile)
  return new ArkClient({
    apiKey: key.apiKey,
    baseUrl: config.baseUrl || key.baseUrl,
    timeoutMs: config.timeoutMs,
  })
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function fail(error) {
  return `豆包调用失败：${error?.message ?? error}`
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [rawConfig]
 */
export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig)
  const registrations = []

  registrations.push(
    ctx.tools.register({
      name: 'doubao_status',
      description:
        'Check whether the Doubao (Volcengine Ark) key works and which configured models are visible on the account. Use it before first use, or when a Doubao call reports ModelNotOpen/InvalidEndpointOrModel.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: textOutput(),
      async execute() {
        let ark
        try {
          ark = client(config)
        } catch (error) {
          return fail(error)
        }
        try {
          const payload = await ark.listModels()
          const models = payload?.data ?? []
          const lines = [`方舟连接正常，账号可见 ${models.length} 个模型：`]
          for (const [kind, id] of Object.entries(config.models)) {
            const hit = models.find((m) => m.id === id)
            if (!hit) lines.push(`- ${kind}: ${id} → 不在可见列表里（可能未开通或 ID 不对）`)
            else lines.push(`- ${kind}: ${id} → 可见（status: ${hit.status ?? 'available/未标注'}）`)
          }
          lines.push('提示：可见 ≠ 已开通；若调用报 ModelNotOpen，需要去方舟控制台「开通管理」激活，或改用 endpoint ID（ep-…）。')
          return lines.join('\n')
        } catch (error) {
          return fail(error)
        }
      },
    }),
  )

  registrations.push(
    ctx.tools.register({
      name: 'doubao_see',
      description:
        'Look at an image with Doubao vision: pass a local file path, an http(s) URL, or a data URL, plus an optional question. Returns the model\'s description/answer. Use it for screenshots, photos, diagrams, or UI mockups the user mentions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['image'],
        properties: {
          image: { type: 'string', description: 'Local path (/abs or ~), http(s) URL, or data:image/... URL.' },
          question: { type: 'string', description: 'What to ask about the image (defaults to a detailed description).' },
          model: { type: 'string', description: 'Override the vision model ID (or ep-… endpoint).' },
        },
      },
      output: textOutput(),
      async execute(args, exec) {
        let ark
        try {
          ark = client(config)
        } catch (error) {
          return fail(error)
        }
        try {
          const url = toImageUrl(args.image)
          const question = String(args.question ?? '').trim() || '请详细描述这张图片：主体、场景、文字、值得注意的细节。'
          const payload = await ark.chat({
            model: args.model || config.models.vision,
            maxTokens: 1500,
            signal: exec?.signal,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question },
                  { type: 'image_url', image_url: { url } },
                ],
              },
            ],
          })
          const text = payload?.choices?.[0]?.message?.content
          if (!text) return '上游没有返回文字内容。'
          return typeof text === 'string' ? text : JSON.stringify(text)
        } catch (error) {
          return fail(error)
        }
      },
    }),
  )

  registrations.push(
    ctx.tools.register({
      name: 'doubao_draw',
      description:
        'Draw an image with Seedream from a text prompt. Saves the image into the workspace output directory and returns its absolute path; show it in the reply with markdown (![alt](path)) when useful.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', description: 'What to draw. Be concrete about subject, style, composition, lighting.' },
          size: { type: 'string', description: 'WxH, e.g. 1024x1024 (default), 1536x1024, 1024x1536.' },
          model: { type: 'string', description: 'Override the image model ID (or ep-… endpoint).' },
          image: { type: 'string', description: 'Optional reference image (local path, URL, or data URL) for image-to-image / style reference.' },
          filename: { type: 'string', description: 'Optional base filename without extension.' },
        },
      },
      output: textOutput(),
      async execute(args, exec) {
        let ark
        try {
          ark = client(config)
        } catch (error) {
          return fail(error)
        }
        try {
          const payload = await ark.generateImage({
            model: args.model || config.models.image,
            prompt: String(args.prompt ?? ''),
            size: args.size || '1024x1024',
            watermark: config.watermark,
            image: args.image ? toImageUrl(args.image) : undefined,
            signal: exec?.signal,
          })
          const picked = pickImage(payload)
          fs.mkdirSync(config.outputDir, { recursive: true })
          const base = (args.filename || `draw-${stamp()}`).replace(/[^a-zA-Z0-9._-]/g, '-')
          const target = path.join(config.outputDir, base)
          const file = picked.url
            ? await downloadImage(picked.url, target)
            : writeImage(Buffer.from(picked.base64, 'base64'), target)
          return `画好了：${file}\n在回复里用 ![${base}](${file}) 展示。`
        } catch (error) {
          return fail(error)
        }
      },
    }),
  )

  registrations.push(
    ctx.tools.register({
      name: 'doubao_video',
      description:
        'Generate a short video with Seedance from a text prompt (and optionally a reference image). Creates an async task, polls until it finishes, saves the mp4 into the workspace output directory, and returns its path.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', description: 'What happens in the video: subject, motion, camera, style.' },
          image: { type: 'string', description: 'Optional first-frame image: local path, URL, or data URL.' },
          duration: { type: 'integer', minimum: 2, maximum: 12, description: 'Seconds (model default when omitted).' },
          model: { type: 'string', description: 'Override the video model ID (or ep-… endpoint).' },
        },
      },
      output: textOutput(),
      async execute(args, exec) {
        if (!args.prompt && !args.image) return 'prompt 和 image 至少给一个。'
        let ark
        try {
          ark = client(config)
        } catch (error) {
          return fail(error)
        }
        try {
          const content = []
          if (args.prompt) content.push({ type: 'text', text: String(args.prompt) })
          if (args.image) content.push({ type: 'image_url', image_url: { url: toImageUrl(args.image) } })
          const created = await ark.createVideoTask({
            model: args.model || config.models.video,
            content,
            duration: args.duration,
            signal: exec?.signal,
          })
          const taskId = created?.id || created?.task_id
          if (!taskId) return `任务创建了但没拿到 id：${JSON.stringify(created).slice(0, 300)}`

          const deadline = Date.now() + config.videoTimeoutMs
          let last
          while (Date.now() < deadline) {
            if (exec?.signal?.aborted) return '已取消。'
            await new Promise((resolve) => setTimeout(resolve, 5000))
            last = await ark.getVideoTask(taskId, { signal: exec?.signal })
            const status = last?.status
            if (status === 'failed') return `视频生成失败：${JSON.stringify(last).slice(0, 400)}`
            const url = last?.content?.video_url
            if (status === 'succeeded' && url) {
              fs.mkdirSync(config.outputDir, { recursive: true })
              const file = path.join(config.outputDir, `video-${stamp()}.mp4`)
              await downloadTo(url, file)
              return `视频好了：${file}`
            }
          }
          return `等了 ${Math.round(config.videoTimeoutMs / 1000)} 秒还没完成，任务 id：${taskId}（可稍后用 doubao_video 轮询或去控制台看）。`
        } catch (error) {
          return fail(error)
        }
      },
    }),
  )

  ctx.effect(() => () => {
    for (const dispose of registrations.splice(0)) dispose()
  })

  ctx.logger?.info?.(`dsh-doubao ready（models: ${config.models.vision} / ${config.models.image} / ${config.models.video}）`)
}

export { DEFAULT_MODELS, FALLBACK_MODELS }
