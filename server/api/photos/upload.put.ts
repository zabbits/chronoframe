import { useStorageProvider } from '~~/server/utils/useStorageProvider'
import { logger } from '~~/server/utils/logger'

// Map of file extensions to MIME types for files that browsers don't recognize
const EXTENSION_MIME_MAP: Record<string, string> = {
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
}

/**
 * Infer MIME type from file extension if the browser-provided type is generic.
 * This is necessary because Chrome and other non-Safari browsers don't recognize
 * HEIC/HEIF files and send them as 'application/octet-stream'.
 */
function inferMimeType(key: string, browserMimeType: string): string {
  // If browser provides a specific type, trust it
  if (browserMimeType && browserMimeType !== 'application/octet-stream') {
    return browserMimeType
  }

  // Try to infer from file extension
  const ext = key.toLowerCase().match(/\.[^.]+$/)?.[0]
  if (ext && EXTENSION_MIME_MAP[ext]) {
    return EXTENSION_MIME_MAP[ext]
  }

  return browserMimeType
}

export default eventHandler(async (event) => {
  const key = getQuery(event).key as string | undefined
  const browserContentType = getHeader(event, 'content-type') || 'application/octet-stream'

  await requireUserSession(event)

  const { storageProvider } = useStorageProvider(event)
  const t = await useTranslation(event)

  if (!key) {
    throw createError({
      statusCode: 400,
      statusMessage: t('upload.error.required.title'),
      data: {
        title: t('upload.error.required.title'),
        message: t('upload.error.required.message', { field: 'key' }),
      },
    })
  }

  // Infer MIME type from extension if browser sends generic type
  const contentType = inferMimeType(key, browserContentType)

  // MIME 类型白名单验证（可通过环境变量配置）
  const config = useRuntimeConfig(event)
  const whitelistEnabled = config.upload.mime.whitelistEnabled

  if (whitelistEnabled) {
    const whitelistStr = config.upload.mime.whitelist
    const allowedTypes = whitelistStr
      ? whitelistStr.split(',').map((type: string) => type.trim()).filter(Boolean)
      : []

    if (allowedTypes.length > 0 && !allowedTypes.includes(contentType)) {
      logger.chrono.warn(`MIME type rejected: ${contentType} (browser: ${browserContentType}) for key: ${key}`)
      throw createError({
        statusCode: 415,
        statusMessage: t('upload.error.invalidType.title'),
        data: {
          title: t('upload.error.invalidType.title'),
          message: t('upload.error.invalidType.message', { type: contentType }),
          suggestion: t('upload.error.invalidType.suggestion', { allowed: allowedTypes.join(', ') }),
        },
      })
    }
  }

  // 使用流式处理而不是一次性读取整个文件到内存
  const raw = await readRawBody(event, false)
  if (!raw || !(raw instanceof Buffer)) {
    throw createError({
      statusCode: 400,
      statusMessage: t('upload.error.uploadFailed.title'),
      data: {
        title: t('upload.error.uploadFailed.title'),
        message: t('upload.error.uploadFailed.message'),
      },
    })
  }

  // 简单大小限制（例如 128MB）
  const maxBytes = 128 * 1024 * 1024
  if (raw.byteLength > maxBytes) {
    const sizeInMB = (raw.byteLength / 1024 / 1024).toFixed(2)
    throw createError({
      statusCode: 413,
      statusMessage: t('upload.error.tooLarge.title'),
      data: {
        title: t('upload.error.tooLarge.title'),
        message: t('upload.error.tooLarge.message', { size: sizeInMB }),
        suggestion: t('upload.error.tooLarge.suggestion', { maxSize: 128 }),
      },
    })
  }

  try {
    const finalKey = key.replace(/^\/+/, '')
    await storageProvider.create(finalKey, raw, contentType)
  } catch (error) {
    logger.chrono.error(`Storage provider create error for key: ${key}`, error)
    throw createError({
      statusCode: 500,
      statusMessage: t('upload.error.uploadFailed.title'),
      data: {
        title: t('upload.error.uploadFailed.title'),
        message: t('upload.error.uploadFailed.message'),
      },
    })
  }

  return { ok: true, key }
})
