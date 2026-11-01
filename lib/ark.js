/**
 * 火山方舟（Ark）HTTP 客户端：视觉理解 / Seedream 出图 / Seedance 视频。
 *
 * 只依赖 Node 内置能力：fetch、fs、path。Key 从本地 600 权限的 JSON 读取，
 * 不进日志、不进提示词。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/** 读取 ~/.dsh/doubao.json（或自定义路径），兼容 apiKey / ARK_API_KEY。 */
export function loadKey(file) {
  const target = expandHome(file || '~/.dsh/doubao.json')
  const raw = fs.readFileSync(target, 'utf8')
  const parsed = JSON.parse(raw)
  const apiKey = parsed.apiKey || parsed.ARK_API_KEY || parsed.key
  if (!apiKey || typeof apiKey !== 'string') throw new Error(`没在 ${target} 里找到 apiKey`)
  return { apiKey, baseUrl: parsed.baseUrl || DEFAULT_BASE_URL, file: target }
}

export function expandHome(target) {
  if (!target) return target
  if (target === '~') return os.homedir()
  if (target.startsWith('~/')) return path.join(os.homedir(), target.slice(2))
  return target
}

/** 把本地图片/URL/dataURL 统一成视觉接口能吃的 URL。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export function toImageUrl(input) {
  const value = String(input ?? '').trim()
  if (!value) throw new Error('image 不能为空')
  if (/^https?:\/\//i.test(value)) return value
  if (/^data:image\//i.test(value)) return value
  const file = expandHome(value)
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error(`${file} 不是文件`)
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限：${file}`)
  const ext = path.extname(file).toLowerCase()
  const mime = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  }[ext]
  if (!mime) throw new Error(`不支持的图片格式 ${ext}`)
  const data = fs.readFileSync(file).toString('base64')
  return `data:${mime};base64,${data}`
}

/** 把上游错误翻成能直接给用户看的动作建议。 */
export function explainError(status, payload) {
  const error = payload?.error ?? {}
  const code = error.code || ''
  const message = error.message || JSON.stringify(payload).slice(0, 300)
  if (status === 401) {
    return `Key 无效或格式不对（${code || 401}）：检查 ~/.dsh/doubao.json 里的 apiKey。`
  }
  if (code === 'ModelNotOpen') {
    return `账号还没开通模型：${message}\n去火山方舟控制台「开通管理」激活该模型，或创建一个推理接入点（ep-…）并把模型 ID 换成它。`
  }
  if (code === 'InvalidEndpointOrModel.NotFound') {
    return `模型 ID 不存在或不可用：${message}\n用 doubao_status 看可用模型，或改用控制台里的 endpoint ID（ep-…）。`
  }
  if (code === 'AuthenticationError') {
    return `鉴权失败：${message}`
  }
  return `调用失败（HTTP ${status}${code ? ` / ${code}` : ''}）：${message}`
}

export class ArkClient {
  /**
   * @param {{apiKey: string, baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} options
   */
  constructor(options) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  async request(pathname, { method = 'POST', body, signal, timeoutMs } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs ?? this.timeoutMs)
    const onAbort = () => controller.abort(signal?.reason)
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      let payload
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        payload = { raw: text.slice(0, 500) }
      }
      if (!response.ok) {
        const error = new Error(explainError(response.status, payload))
        error.status = response.status
        error.code = payload?.error?.code
        throw error
      }
      return payload
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
  }

  listModels() {
    return this.request('/models', { method: 'GET' })
  }

  chat({ model, messages, maxTokens = 1024, signal }) {
    return this.request('/chat/completions', {
      body: {
        model,
        messages,
        max_tokens: maxTokens,
      },
      signal,
    })
  }

  generateImage({ model, prompt, size = '1024x1024', watermark = false, image, signal }) {
    return this.request('/images/generations', {
      body: {
        model,
        prompt,
        size,
        response_format: 'url',
        watermark,
        ...(image ? { image } : {}),
      },
      signal,
    })
  }

  createVideoTask({ model, content, duration, signal }) {
    return this.request('/contents/generations/tasks', {
      body: {
        model,
        content,
        ...(duration ? { duration } : {}),
      },
      signal,
      timeoutMs: 60_000,
    })
  }

  getVideoTask(id, { signal } = {}) {
    return this.request(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'GET', signal })
  }
}

/** 按文件头判断真实图片格式，返回扩展名（.png/.jpg/.webp/.gif）。 */
export function sniffImageExt(buffer) {
  // 未知格式返回 undefined：调用方不应把字节静默写成错误扩展名。
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return '.webp'
  if (buffer.length >= 6 && buffer.subarray(0, 3).toString() === 'GIF') return '.gif'
  return undefined
}

/** 下载图片并按真实格式落盘；返回最终绝对路径（扩展名可能被纠正）。 */
export async function downloadImage(url, basePath, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  return writeImage(buffer, basePath)
}

/** 把图片字节按真实格式写盘；basePath 可以带或不带扩展名。 */
const KNOWN_IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i

export function writeImage(buffer, basePath) {
  const withoutExt = KNOWN_IMAGE_EXT.test(basePath) ? basePath.replace(KNOWN_IMAGE_EXT, '') : basePath
  const ext = sniffImageExt(buffer)
  const file = ext ? `${withoutExt}${ext}` : basePath
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buffer)
  return file
}

/** 下载 URL 到本地文件，返回绝对路径。 */
export async function downloadTo(url, file, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buffer)
  return file
}

/** 从 images/generations 的响应里取出图片（url 或 b64_json）。 */
export function pickImage(payload) {
  const item = payload?.data?.[0]
  if (!item) throw new Error('上游没有返回图片数据')
  if (item.url) return { url: item.url }
  if (item.b64_json) return { base64: item.b64_json }
  if (item.image_url) return { url: item.image_url }
  throw new Error('上游返回里没有 url/b64_json')
}
