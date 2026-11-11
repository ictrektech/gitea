import {describe, expect, test} from 'vitest';
import {parseGarmURL} from './vos-garm.ts';

describe('remote GARM address', () => {
  test('accepts a GARM UI or VOS route on another device', () => {
    for (const url of ['https://garm.example.com/ui/', 'https://vos.example.com:1180/#/app/app-drawer/com.ictrek.garm/runners']) {
      expect(parseGarmURL(url)?.href).toBe(url);
    }
  });

  test('rejects relative links, embedded credentials, and non-HTTP schemes', () => {
    for (const url of ['/ui/', 'https://name:password@garm.example.com/', 'javascript:alert(1)', '']) {
      expect(parseGarmURL(url)).toBeNull();
    }
  });
});
