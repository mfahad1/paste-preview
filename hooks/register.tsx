import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Shot } from '../types'

// "[Image #N]" -> the picture pasted under that label. Change the tag when Shot changes.
const shots = atom({ plugin: 'paste-preview', key: 'shots' } as const, {}, {
  shape: 'shots-2',
})

const MAX_COLUMNS = 60
const MAX_ROWS = 22
// Largest a thumbnail is drawn in the chat, in cells.
const THUMB_COLUMNS = 36
const THUMB_ROWS = 10
// A terminal cell is about twice as tall as it is wide.
const CELL_RATIO = 2.1
const LABEL = /\[Image #\d+\]/g

type Io = {
  process: { hookEnv: () => Promise<Record<string, string>> }
  fs: { write: (path: string, text: string) => Promise<void> }
}

async function debug($: Io, name: string, value: unknown) {
  const env = await $.process.hookEnv()
  await $.fs.write(`${env.CLAUDE_PLUGIN_DATA}/debug-${name}.json`, JSON.stringify(value, null, 2))
}

// Base64 of each PNG, read once per load. A bytes source must stay under 2 MiB.
const bytesCache = new Map<string, string | null>()
const MAX_BYTES = 2 * 1024 * 1024

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const images = (e.attachments ?? []).filter(a => a.type === 'image' && a.id)
    if (images.length === 0) {
      return next(e)
    }

    // Bytes are only readable while this submission is in flight.
    const payloads: string[] = []
    for (const image of images) {
      let base64 = ''
      let offset: number | undefined
      do {
        const part = await $.prompt.media({ id: image.id!, offset })
        if (part.base64 === undefined) {
          base64 = ''
          break
        }
        base64 += part.base64
        offset = part.next
      } while (offset !== undefined)
      payloads.push(base64)
    }

    const labels = e.text.match(LABEL) ?? []

    void (async () => {
      const env = await $.process.hookEnv()
      const dir = `${env.CLAUDE_PLUGIN_DATA}/images`
      const stamp = await $.clock.now()
      const saved: Record<string, Shot> = {}

      for (const [i, base64] of payloads.entries()) {
        if (base64 === '') continue
        const base = `${dir}/${stamp}-${i}`
        try {
          await $.fs.write(`${base}.b64`, base64)
          await $.process.run(['/usr/bin/base64', '-D', '-i', `${base}.b64`, '-o', `${base}.bin`])
          // sips -Z also enlarges, so only pass it when the picture is bigger.
          const original = await $.process.run(['/usr/bin/sips', '-g', 'pixelWidth', '-g', 'pixelHeight', `${base}.bin`])
          const longest = Math.max(
            ...[...original.stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map(m => Number(m[1])),
          )
          const shrink = longest > 1200 ? ['-Z', '1200'] : []
          const png = await $.process.run([
            '/usr/bin/sips', '-s', 'format', 'png', ...shrink, `${base}.bin`, '--out', `${base}.png`,
          ])
          await $.process.run(['/bin/rm', '-f', `${base}.b64`, `${base}.bin`])
          if (png.exitCode !== 0) continue

          const size = await $.process.run(['/usr/bin/sips', '-g', 'pixelWidth', '-g', 'pixelHeight', `${base}.png`])
          const width = Number(/pixelWidth: (\d+)/.exec(size.stdout)?.[1] ?? 0)
          const height = Number(/pixelHeight: (\d+)/.exec(size.stdout)?.[1] ?? 0)
          if (!width || !height) continue

          let columns = Math.min(MAX_COLUMNS, Math.ceil(width / 10))
          let rows = Math.max(1, Math.round((columns * height) / width / CELL_RATIO))
          if (rows > MAX_ROWS) {
            rows = MAX_ROWS
            columns = Math.max(1, Math.round((rows * CELL_RATIO * width) / height))
          }

          const label = labels[i] ?? `[Image #${i + 1}]`
          saved[label] = { file: `${base}.png`, label, columns, rows }
        } catch (error) {
          void debug($, 'error', String(error))
        }
      }

      if (Object.keys(saved).length > 0) {
        await update($, shots, all => ({ ...all, ...saved }))
        $.ui.invalidate('ui.render')
      }
    })()

    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const found = e.props.text.match(LABEL) ?? []
    if (found.length === 0) {
      return next(e)
    }

    const all = await read($, shots)
    const list = found.map(label => all[label]).filter((s): s is Shot => Boolean(s))

    if (e.surface !== 'terminal' || list.length === 0) {
      return next(e)
    }

    const { Box, Text, Image } = $.ui.resolve(e)
    const row = await next(e)

    const pictures: { shot: Shot; png: string | null }[] = []
    for (const shot of list) {
      if (!bytesCache.has(shot.file)) {
        try {
          const { size } = await $.fs.stat(shot.file)
          const { base64 } = size <= MAX_BYTES ? await $.fs.read(shot.file, { as: 'bytes' }) : { base64: '' }
          bytesCache.set(shot.file, base64 || null)
        } catch {
          bytesCache.set(shot.file, null)
        }
      }
      pictures.push({ shot, png: bytesCache.get(shot.file) ?? null })
    }

    const isFullscreen = e.viewport?.isFullscreen
    // Room for one card: thumbnails, so several sit side by side.
    const room = Math.max(10, (e.viewport?.columns ?? 100) - 6)
    const fit = (shot: Shot) => {
      const scale = Math.min(1, THUMB_COLUMNS / shot.columns, THUMB_ROWS / shot.rows, (room - 2) / shot.columns)
      return {
        columns: Math.max(1, Math.round(shot.columns * scale)),
        rows: Math.max(1, Math.round(shot.rows * scale)),
      }
    }

    return (
      <Box flexDirection="column">
        {row}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginLeft={2}>
          {pictures.map(({ shot, png }) => {
            const size = fit(shot)
            return isFullscreen === false ? (
              <Text dimColor>{shot.label} preview needs fullscreen: start with CLAUDE_CODE_NO_FLICKER=1</Text>
            ) : (
              <Box flexDirection="column" borderStyle="round" borderDimColor flexShrink={0}>
                <Image
                  source={png ? { png } : { file: shot.file, format: 'png' }}
                  columns={size.columns}
                  rows={size.rows}
                  alt={`${shot.label} (this terminal cannot draw images)`}
                />
                <Text dimColor>{shot.label}</Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
