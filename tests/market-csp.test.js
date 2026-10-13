import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('page policy permits only the two quote services in addition to the app origin', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];
  assert.ok(policy, 'the page must retain its content security policy');
  assert.match(policy, /(?:^|;)\s*connect-src 'self' https:\/\/stock\.indianapi\.in https:\/\/r\.jina\.ai(?:\s*;|$)/);
  assert.doesNotMatch(policy, /connect-src[^;]*\*/);
});
