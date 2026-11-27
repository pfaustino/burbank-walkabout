import { describe, expect, it } from 'vitest'
import { replyMode, replyModel } from '../server/dialog.ts'

describe('reply provider', () => {
  it('stays on the local script without a key', () => {
    expect(replyMode({ DIALOG: 'live' })).toBe('local')
    expect(replyModel({ DIALOG: 'live' })).toBe('')
  })

  it('uses nvidia when that key is set, even if OpenRouter is also set', () => {
    const env = { DIALOG: 'live', NVIDIA_API_KEY: 'nvapi-test', NVIDIA_MODEL: 'meta/llama-3.1-8b-instruct', OPENROUTER_API_KEY: 'or-test' }
    expect(replyMode(env)).toBe('nvidia')
    expect(replyModel(env)).toBe('meta/llama-3.1-8b-instruct')
  })

  it('uses openrouter when that is the only key', () => {
    const env = { OPENROUTER_API_KEY: 'or-test', OPENROUTER_MODEL: 'a/model' }
    expect(replyMode(env)).toBe('openrouter')
    expect(replyModel(env)).toBe('a/model')
  })

  it('stays local when DIALOG is local, even with a nvidia key', () => {
    expect(replyMode({ DIALOG: 'local', NVIDIA_API_KEY: 'nvapi-test' })).toBe('local')
  })

  it('ignores a blank key', () => {
    expect(replyMode({ NVIDIA_API_KEY: '   ', OPENROUTER_API_KEY: 'or-test' })).toBe('openrouter')
  })
})
