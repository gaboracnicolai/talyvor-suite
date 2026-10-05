// sw.js — B19.10: shows the push Lens sends when an agent's request or payment waits for approval,
// and opens Agent Wallets when it is tapped. The payload is decrypted by the browser (RFC 8291).
//
// B28.38: the push carries Approve and Deny. Either one decides the approval from here, with the
// session cookie, exactly as the Approvals screen does — the app does not open. Once a workspace has a
// passkey, Lens takes a decision only signed with one, which a notification cannot ask for; then, and on
// any other refusal, the app opens on Approvals so the person finishes it there.

const APPROVALS_URL = '/approvals'

/** Shows the notification for one push from Lens: {approval_id, agent_name, amount_lxc, reason}. */
function showApproval(d) {
  const who = d.agent_name || 'An agent'
  const amount = d.amount_lxc ? `${d.amount_lxc} LXC` : 'a payment'
  const id = d.approval_id || ''
  return self.registration.showNotification(`${who} asks you to approve ${amount}`, {
    body: d.reason || 'Open Agent Wallets to approve or deny it.',
    tag: id || 'agent-approval',
    data: { url: APPROVALS_URL, approval_id: id, who, amount },
    // Only a push naming its approval can be decided from the notification.
    actions: id
      ? [
          { action: 'approve', title: 'Approve' },
          { action: 'deny', title: 'Deny' },
        ]
      : [],
  })
}

self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = {}
  }
  event.waitUntil(showApproval(d))
})

/** Opens the app at `url`, in a window already open if there is one. */
function openApp(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ('focus' in w) {
        w.navigate(url)
        return w.focus()
      }
    }
    return self.clients.openWindow(url)
  })
}

/**
 * Approve or Deny on the notification: sends the decision to the same route the Approvals screen uses,
 * then replaces the notification with what happened. A decision Lens refuses opens the app instead.
 */
async function decideFromNotification(notification, action) {
  const data = notification.data || {}
  const url = data.url || APPROVALS_URL
  let res
  try {
    res = await fetch(`/api/agents/approvals/${encodeURIComponent(data.approval_id)}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    })
  } catch {
    res = undefined
  }
  if (!res || !res.ok) return openApp(url)
  const approved = action === 'approve'
  return self.registration.showNotification(`${approved ? 'Approved' : 'Denied'}: ${data.who}, ${data.amount}`, {
    body: approved ? 'Its next identical request goes through, once.' : 'Its request will be refused.',
    tag: data.approval_id,
    data: { url },
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  if ((event.action === 'approve' || event.action === 'deny') && data.approval_id) {
    event.waitUntil(decideFromNotification(event.notification, event.action))
    return
  }
  event.waitUntil(openApp(data.url || APPROVALS_URL))
})
