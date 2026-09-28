// sw.js — B19.10: shows the push Lens sends when an agent's request or payment waits for approval,
// and opens the Agent Bank when it is tapped. The payload is decrypted by the browser (RFC 8291).
self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = {}
  }
  const who = d.agent_name || 'An agent'
  const amount = d.amount_lxc ? `${d.amount_lxc} LXC` : 'a payment'
  event.waitUntil(
    self.registration.showNotification(`${who} asks you to approve ${amount}`, {
      body: d.reason || 'Open the Agent Bank to approve or deny it.',
      tag: d.approval_id || 'agent-approval',
      data: { url: '/agents#approvals' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/agents'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(url)
          return w.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
