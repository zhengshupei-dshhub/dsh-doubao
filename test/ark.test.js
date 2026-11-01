import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ArkClient,
  downloadTo,
  explainError,
  loadKey,
  pickImage,
  sniffImageExt,
  toImageUrl,
  writeImage,
} from '../lib/ark.js'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-doubao-'))
}

test('loadKey 读取 apiKey 与 baseUrl', () => {
  const dir = tempDir()
  const file = path.join(dir, 'doubao.json')
  fs.writeFileSync(file, JSON.stringify({ apiKey: 'ark-test', baseUrl: 'https://example.test/api' }))
  const key = loadKey(file)
  assert.equal(key.apiKey, 'ark-test')
  assert.equal(key.baseUrl, 'https://example.test/api')
})

test('loadKey 缺字段时报错', () => {
  const dir = tempDir()
  const file = path.join(dir, 'doubao.json')
  fs.writeFileSync(file, JSON.stringify({ nope: true }))
  assert.throws(() => loadKey(file), /apiKey/)
})

test('toImageUrl 支持本地文件、URL、dataURL', () => {
  const dir = tempDir()
  const png = path.join(dir, 'a.png')
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.match(toImageUrl(png), /^data:image\/png;base64,/)
  assert.equal(toImageUrl('https://x/y.png'), 'https://x/y.png')
  assert.equal(toImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.throws(() => toImageUrl(path.join(dir, 'missing.png')), /ENOENT|不是文件/)
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x')
  assert.throws(() => toImageUrl(path.join(dir, 'a.txt')), /不支持的图片格式/)
})

test('explainError 把 ModelNotOpen 翻成开通建议', () => {
  const text = explainError(404, { error: { code: 'ModelNotOpen', message: 'not activated' } })
  assert.match(text, /开通/)
  const auth = explainError(401, { error: { code: 'AuthenticationError' } })
  assert.match(auth, /Key 无效/)
})

test('ArkClient 发请求带上鉴权头与模型', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ choices: [{ message: { content: '看到了' } }] }), { status: 200 })
  }
  const ark = new ArkClient({ apiKey: 'ark-test', baseUrl: 'https://example.test/api', fetchImpl })
  const payload = await ark.chat({ model: 'vision-x', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(payload.choices[0].message.content, '看到了')
  assert.equal(calls[0].url, 'https://example.test/api/chat/completions')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ark-test')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'vision-x')
})

test('非 2xx 抛带建议的错误', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { code: 'ModelNotOpen', message: 'not activated' } }), { status: 404 })
  const ark = new ArkClient({ apiKey: 'k', fetchImpl })
  await assert.rejects(() => ark.listModels(), /开通/)
})

test('pickImage 兼容 url 与 b64_json', () => {
  assert.deepEqual(pickImage({ data: [{ url: 'https://img' }] }), { url: 'https://img' })
  assert.deepEqual(pickImage({ data: [{ b64_json: 'AAAA' }] }), { base64: 'AAAA' })
  assert.throws(() => pickImage({ data: [] }), /没有返回图片/)
})

test('downloadTo 落盘', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'x.png')
  const fetchImpl = async () => new Response(Buffer.from([1, 2, 3]), { status: 200 })
  await downloadTo('https://img/x.png', file, { fetchImpl })
  assert.deepEqual([...fs.readFileSync(file)], [1, 2, 3])
})


test('按文件头识别真实图片格式并纠正扩展名', () => {
  assert.equal(sniffImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), '.png')
  assert.equal(sniffImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), '.jpg')

  const dir = tempDir()
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
  const written = writeImage(png, path.join(dir, 'x.png'))
  assert.equal(path.extname(written), '.png')

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const corrected = writeImage(jpeg, path.join(dir, 'y.png'))
  assert.equal(path.extname(corrected), '.jpg', '扩展名按真实格式纠正')
  assert.ok(fs.existsSync(corrected))
})


test('未知格式不静默改扩展名', () => {
  const dir = tempDir()
  const file = writeImage(Buffer.from([1, 2, 3, 4]), path.join(dir, 'raw.png'))
  assert.equal(path.basename(file), 'raw.png')
  assert.deepEqual([...fs.readFileSync(file)], [1, 2, 3, 4])
})
