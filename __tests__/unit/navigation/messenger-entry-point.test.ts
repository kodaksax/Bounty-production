import fs from 'node:fs'
import path from 'node:path'

// The Inbox header no longer links to the all-conversations messenger list
// (removed along with the balance and archive buttons). The messenger screen
// itself still has to work standalone — individual chats open from
// notifications, postings and profiles.
describe('My Bounties messenger entry point', () => {
  it('is not linked from the Inbox, and the messenger still works standalone', () => {
    const inboxSource = fs.readFileSync(
      path.join(process.cwd(), 'app/tabs/inbox-screen.tsx'),
      'utf8',
    )
    const messengerSource = fs.readFileSync(
      path.join(process.cwd(), 'app/tabs/messenger-screen.tsx'),
      'utf8',
    )

    expect(inboxSource).not.toContain('ROUTES.TABS.MESSENGER')
    expect(inboxSource).not.toContain("router.push('/tabs/messenger' as never)")
    expect(messengerSource).toContain('const isStandalone = !onNavigate')
    expect(messengerSource).toContain('onPress={() => router.back()}')
  })
})
