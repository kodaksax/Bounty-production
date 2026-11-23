/**
 * The hunter's "What's going on?" sheet (X.3) for one job: only the options
 * for this stage, each sent to the place that already handles it — the job
 * thread, the hunter's cancellation request, the dispute screen with the
 * reason preselected, or the support form via the screen's contact_support
 * handler.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { useState } from 'react';
import type { HelpOption } from '../poster';
import type { IconName } from '../../lib/my-jobs/types';
import { getHelpOptions, helpSubtitle } from '../../lib/utils/help-options';

export function useHunterHelp(args: {
  bountyId: string | null;
  posterName: string | null;
  working: boolean;
  workSubmitted: boolean;
  disputeOpen: boolean;
  heldAmount: string | null;
  openThread: () => void;
  requestCancellation: () => void;
  contactSupport: () => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const { bountyId, openThread, requestCancellation, contactSupport } = args;

  const options: HelpOption[] = React.useMemo(
    () =>
      getHelpOptions({
        side: 'doing',
        otherName: args.posterName,
        working: args.working,
        workSubmitted: args.workSubmitted,
        disputeOpen: args.disputeOpen,
      }).map((o) => ({
        key: o.key,
        icon: o.icon as IconName,
        text: o.text,
        tone: o.tone,
        onPress: () => {
          setVisible(false);
          if (!bountyId) return;
          switch (o.target) {
            case 'thread':
              openThread();
              return;
            case 'cancel_request':
              requestCancellation();
              return;
            case 'dispute':
              router.push({
                pathname: '/bounty/[id]/dispute',
                params: { id: bountyId, from: 'in-progress', ...(o.reason ? { reason: o.reason } : {}) },
              } as never);
              return;
            default:
              contactSupport();
          }
        },
      })),
    [args.posterName, args.working, args.workSubmitted, args.disputeOpen, bountyId, openThread, requestCancellation, contactSupport, router]
  );

  return {
    visible,
    open: () => setVisible(true),
    close: () => setVisible(false),
    subtitle: helpSubtitle({ side: 'doing', otherName: args.posterName, working: args.working, heldAmount: args.heldAmount }),
    options,
    onTalkToPerson: () => {
      setVisible(false);
      contactSupport();
    },
  };
}
