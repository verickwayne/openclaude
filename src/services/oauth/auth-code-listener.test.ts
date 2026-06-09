import net from 'node:net'

import { afterEach, expect, test } from 'bun:test'

import { AuthCodeListener } from './auth-code-listener.js'

const listeners: AuthCodeListener[] = []

afterEach(() => {
  while (listeners.length > 0) {
    listeners.pop()?.close()
  }
})

test('cancelPendingAuthorization rejects a pending OAuth wait', async () => {
  const listener = new AuthCodeListener('/callback')
  listeners.push(listener)

  const pendingAuthorization = listener.waitForAuthorization(
    'state-test',
    async () => {},
  )

  listener.cancelPendingAuthorization(
    new Error('Codex OAuth flow was cancelled.'),
  )

  await expect(pendingAuthorization).rejects.toThrow(
    'Codex OAuth flow was cancelled.',
  )
})

test('close() destroys lingering keep-alive sockets so the server handle frees', async () => {
  const listener = new AuthCodeListener('/callback')
  const port = await listener.start(0, '127.0.0.1')

  // Open a keep-alive connection like a browser holds after the redirect.
  const socket = net.connect(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('error', reject)
  })
  socket.write(
    'GET /callback HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n',
  )

  // The client socket should be force-closed by listener.close(). Without
  // destroying tracked sockets, this keep-alive connection would stay open
  // (the leak that hangs the process and the terminal).
  const clientClosed = new Promise<void>((resolve, reject) => {
    socket.once('close', () => resolve())
    setTimeout(
      () => reject(new Error('client socket stayed open — handle leaked')),
      2000,
    )
  })

  listener.close()
  await clientClosed

  // Port should be immediately reusable once the handle is released.
  const rebinder = new AuthCodeListener('/callback')
  const rebindPort = await rebinder.start(port, '127.0.0.1')
  expect(rebindPort).toBe(port)
  rebinder.close()
})
