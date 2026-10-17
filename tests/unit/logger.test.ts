import { describe, expect, it } from 'vitest'
import { redactValue } from '../../src/main/infra/logger.ts'

/**
 * v2 redacted by regex, which also hid statusCode — the one field worth
 * logging. These tests pin the exact-key behaviour (docs/spec.md §8.7).
 */
describe('log redaction', () => {
  it('redacts credential-bearing keys', () => {
    const redacted = redactValue({
      access_token: 'ya29.tokenvalue',
      refresh_token: '1//refreshvalue',
      id_token: 'eyJ.idvalue',
      code: 'authcodevalue',
      code_verifier: 'verifiervalue',
      client_secret: 'clientsecretvalue',
      authorization: 'Bearer ya29.tokenvalue',
    })

    // Key names survive; only the values are replaced.
    const serialised = JSON.stringify(redacted)
    for (const secret of [
      'ya29.tokenvalue',
      '1//refreshvalue',
      'eyJ.idvalue',
      'authcodevalue',
      'verifiervalue',
      'clientsecretvalue',
    ]) {
      expect(serialised).not.toContain(secret)
    }
    expect(redacted).toHaveProperty('access_token', '[redacted]')
  })

  it('keeps statusCode, which a regex on /code/i would have hidden', () => {
    const redacted = redactValue({ statusCode: 429, errorCode: 'ETIMEDOUT' })

    expect(redacted).toEqual({ statusCode: 429, errorCode: 'ETIMEDOUT' })
  })

  it('redacts nested credentials and request headers', () => {
    const redacted = redactValue({
      response: { status: 401, headers: { authorization: 'Bearer ya29.secret' } },
      credentials: { refresh_token: '1//secret' },
    })

    expect(JSON.stringify(redacted)).not.toContain('ya29.secret')
    expect(JSON.stringify(redacted)).not.toContain('1//secret')
    expect(JSON.stringify(redacted)).toContain('401')
  })

  it('matches keys case-insensitively', () => {
    const redacted = redactValue({ Authorization: 'Bearer secret', ACCESS_TOKEN: 'secret' })

    expect(JSON.stringify(redacted)).not.toContain('secret')
  })

  it('walks arrays and flattens errors to their class name', () => {
    const redacted = redactValue([{ access_token: 'secret' }, new Error('boom')])

    expect(JSON.stringify(redacted)).not.toContain('secret')
    // The message of a foreign error is attacker-influenced free text.
    expect(JSON.stringify(redacted)).not.toContain('boom')
    expect(JSON.stringify(redacted)).toContain('Error')
  })

  it('truncates deeply nested structures instead of recursing forever', () => {
    const deep = { a: { b: { c: { d: { e: 'too deep' } } } } }

    expect(JSON.stringify(redactValue(deep))).not.toContain('too deep')
  })

  it('passes scalars through untouched', () => {
    expect(redactValue('hello')).toBe('hello')
    expect(redactValue(42)).toBe(42)
    expect(redactValue(null)).toBeNull()
  })
})
