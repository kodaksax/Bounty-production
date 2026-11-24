/**
 * The hunter's job workspace layout (Focus-first "both sides" handoff):
 * the shared workspace header, the four questions, the stage's own blocks,
 * Other options, and one next step pinned under the thumb — the same pieces
 * the poster workspace uses, with the hunter's copy from
 * lib/utils/hunter-stage-copy.ts.
 *
 * Presentational: each hunter route (hub, work, payout) keeps its own data
 * loading, guards and handlers, and passes its screen-specific extras
 * (the quick message box, the receipt, the rating card) as props/children.
 */
import * as React from 'react';
import { firstName, formatJobDay, getBountyCategoryIcon, getBountyCoverUri } from '../../lib/my-jobs/format';
import type { IconName } from '../../lib/my-jobs/types';
import { hunterHeaderMeta, type HunterActionKey, type HunterStageView } from '../../lib/utils/hunter-stage-copy';
import { formatClock } from '../../lib/utils/poster-stage-copy';
import {
  FourQuestions,
  HelpSheet,
  NoteBox,
  OtherOptions,
  ReceiptRows,
  StageFooter,
  StageToast,
  WorkspaceHeader,
  WorkspaceLayout,
  type HelpOption,
  type OtherOption,
} from '../poster';

export interface HunterStageViewProps {
  view: HunterStageView;
  bounty: {
    title: string;
    category?: string | null;
    attachments_json?: string | null;
    amount?: number | null;
    is_for_honor?: boolean | null;
    description?: string | null;
  };
  posterName: string | null;
  /** Side labels only for accounts that work both sides. */
  worksBothSides: boolean;
  onBack: () => void;
  onAction: (key: HunterActionKey) => void;
  busyKey?: HunterActionKey | null;
  toast?: string | null;
  onToastHide?: () => void;
  /** H.3: the pitch the hunter sent. */
  yourNote?: string | null;
  /** H.7: the poster's latest message. */
  lastMessage?: { text: string; at: string } | null;
  /** H.10. */
  receipt?: { label: string; value: string; strong?: boolean }[] | null;
  /** H.10: RateCounterpartyCard. */
  rating?: React.ReactNode;
  /** Screen-specific options added after the stage's own. */
  moreExtra?: OtherOption[];
  /** Screen-specific content after the stage blocks. */
  children?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  help: {
    visible: boolean;
    open: () => void;
    close: () => void;
    subtitle: string | null;
    options: HelpOption[];
    onTalkToPerson: () => void;
  };
}

export function HunterStageScreen(props: HunterStageViewProps) {
  const { view, bounty, posterName } = props;
  // Start of a sentence vs inside one; only the fallback changes case.
  const Poster = firstName(posterName) ?? 'The poster';
  const poster = firstName(posterName) ?? 'the poster';
  const more: OtherOption[] = [
    ...view.more.map((a) => ({
      key: a.key,
      label: a.label,
      icon: (a.icon ?? 'more-horiz') as IconName,
      danger: a.kind === 'danger',
      busy: props.busyKey === a.key,
      onPress: () => props.onAction(a.key),
    })),
    ...(props.moreExtra ?? []),
  ];

  return (
    <WorkspaceLayout
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      testID="hunter-workspace"
      footer={
        <StageFooter
          primary={view.primary}
          secondary={view.secondary}
          onAction={props.onAction}
          busyKey={props.busyKey ?? null}
        />
      }
    >
      <WorkspaceHeader
        onBack={props.onBack}
        onHelp={props.help.open}
        icon={getBountyCategoryIcon(bounty.category ?? undefined) as IconName}
        coverUri={getBountyCoverUri(bounty.attachments_json ?? undefined)}
        title={bounty.title}
        meta={hunterHeaderMeta(bounty.amount, bounty.is_for_honor, posterName)}
        side={props.worksBothSides ? view.side : null}
        step={view.step}
        stage={view.stage}
      />
      {props.toast ? <StageToast text={props.toast} onHide={props.onToastHide} /> : null}

      <FourQuestions now={view.now} means={view.means} money={view.money} after={view.after} />

      {view.show.deadline ? <NoteBox tone="i" icon="schedule" text={view.show.deadline} testID="review-deadline" /> : null}

      {view.show.changeRequested ? (
        <NoteBox tone="w" icon="edit-note" title={`${Poster} asked for a change`} text={`“${view.show.changeRequested}”`} testID="change-requested" />
      ) : null}

      {view.show.yourNote && props.yourNote ? (
        <NoteBox tone="n" icon="format-quote" title="Your note" text={`“${props.yourNote}”`} testID="your-note" />
      ) : null}

      {view.show.askedFor && bounty.description ? (
        <NoteBox tone="bg" icon="description" title={`What ${poster} asked for`} text={bounty.description} testID="asked-for" />
      ) : null}

      {view.show.lastMessage && props.lastMessage ? (
        <NoteBox
          tone="n"
          icon="format-quote"
          title={`${Poster}'s last message · ${[formatJobDay(props.lastMessage.at), formatClock(props.lastMessage.at)].filter(Boolean).join(' ')}`}
          text={`“${props.lastMessage.text}”`}
          testID="last-poster-message"
        />
      ) : null}

      {view.show.receipt && props.receipt ? <ReceiptRows rows={props.receipt} testID="hunter-receipt" /> : null}
      {props.rating}

      {props.children}

      {more.length > 0 ? <OtherOptions items={more} initiallyOpen={view.moreOpen} testID="hunter-more" /> : null}

      <HelpSheet
        visible={props.help.visible}
        onClose={props.help.close}
        subtitle={props.help.subtitle}
        options={props.help.options}
        onTalkToPerson={props.help.onTalkToPerson}
      />
    </WorkspaceLayout>
  );
}
