/**
 * 默认模型 ID。方舟的模型 ID 会随版本变化，配置里可以覆盖。
 * 这些是 2026-10 账面上存在、但需要在控制台开通的型号。
 */
export const DEFAULT_MODELS = {
  /** 视觉理解（看图、读截图、OCR 辅助）。 */
  vision: 'doubao-seed-2-1-pro-260915',
  /** 图像生成（Seedream）。 */
  image: 'doubao-seedream-4-0-20260415',
  /** 视频生成（Seedance）。 */
  video: 'doubao-seedance-2-5-260628',
}

export const FALLBACK_MODELS = {
  vision: ['doubao-seed-2-1-turbo-260628', 'doubao-seed-2-0-lite-260428', 'doubao-seed-1-6-vision-250815'],
  image: ['doubao-seedream-5-0-flash-260915', 'doubao-seedream-4-0-20260415'],
  video: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-mini-260615'],
}
