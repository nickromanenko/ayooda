import { describe, expect, test } from 'bun:test'
import { isBlockedAddress } from './ssrf'

describe('isBlockedAddress', () => {
  test('blocks loopback, private, link-local, CGNAT, multicast', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1']) {
      expect(isBlockedAddress(ip)).toBe(true)
    }
  })
  test('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '1.1.1.1']) {
      expect(isBlockedAddress(ip)).toBe(false)
    }
  })
  test('handles IPv6 loopback, ULA, link-local, and mapped IPv4', () => {
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('fd00::1')).toBe(true)
    expect(isBlockedAddress('fe80::1')).toBe(true)
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
  })
  test('fails closed on garbage', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('999.1.1.1')).toBe(true)
  })
})
