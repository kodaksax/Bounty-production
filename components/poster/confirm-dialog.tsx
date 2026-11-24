/**
 * The designed confirmation dialogs (J.4 take a job down, S.3 withdraw an
 * offer): a title, what changes, the money truth, and two buttons.
 *
 * `ask` opens it; render `dialog` once in the screen (inside the open sheet
 * when there is one, so iOS never presents two sibling modals). Confirming
 * closes the dialog first and runs the action once, however often it's tapped.
 */
import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import type { StageMoney } from '../../lib/utils/stage-copy-types';
import { MoneyLine } from './four-questions';
import { PosterDialog } from './overlays';
import { PosterButton } from './poster-button';

export interface ConfirmSpec {
  title: string;
  body: string;
  money?: StageMoney | null;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}

export function useConfirmDialog() {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const [visible, setVisible] = useState(false);
  const openRef = useRef(false);

  const ask = useCallback((next: ConfirmSpec) => {
    openRef.current = true;
    setSpec(next);
    setVisible(true);
  }, []);
  const close = useCallback(() => {
    openRef.current = false;
    setVisible(false);
  }, []);
  const confirm = () => {
    if (!openRef.current || !spec) return;
    close();
    spec.onConfirm();
  };

  const dialog = spec ? (
    <PosterDialog visible={visible} title={spec.title} body={spec.body} onClose={close} testID="confirm-dialog">
      {spec.money ? <MoneyLine kind={spec.money.kind} text={spec.money.text} testID="confirm-dialog-money" /> : null}
      <PosterButton kind="danger" label={spec.confirmLabel} onPress={confirm} testID="confirm-dialog-yes" />
      <PosterButton kind="neutral" label={spec.cancelLabel} onPress={close} testID="confirm-dialog-no" />
    </PosterDialog>
  ) : null;

  return { ask, dialog };
}

/** S.3, the same wherever an offer can be withdrawn. */
export function withdrawOfferCopy(posterFirst: string | null): Omit<ConfirmSpec, 'onConfirm'> {
  return {
    title: 'Withdraw your offer?',
    body: `${posterFirst ?? 'The poster'} won't see your offer any more. You can offer again while the job is open.`,
    money: { kind: 'none', text: 'Nothing was held, so nothing changes in your wallet.' },
    confirmLabel: 'Yes, withdraw',
    cancelLabel: 'Keep my offer',
  };
}
