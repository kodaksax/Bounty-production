/**
 * Tests for StepPhotos' upload accumulation
 * (app/screens/CreateBounty/quick/StepPhotos.tsx).
 *
 * useAttachmentUpload fires onUploaded once per file, synchronously, from the
 * callback it captured when the picker was opened — so there is no re-render
 * between the calls of a multi-photo selection. Building each new list from
 * the `draft.attachments` prop therefore appended every photo to the same
 * pre-upload snapshot and only the last one survived, which is how a poster
 * could add four photos to a live bounty and end up with one.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import type { Attachment } from '../../lib/types';

// Captures the options StepPhotos passes so a test can drive onUploaded
// exactly the way the real hook does.
let capturedOptions: any = null;

jest.mock('../../hooks/use-attachment-upload', () => ({
  useAttachmentUpload: (options: any) => {
    capturedOptions = options;
    return {
      isUploading: false,
      isPicking: false,
      progress: 0,
      pickAttachment: jest.fn(),
      error: null,
      clearError: jest.fn(),
    };
  },
}));

import { StepPhotos } from '../../app/screens/CreateBounty/quick/StepPhotos';

const makeAttachment = (id: string): Attachment =>
  ({
    id,
    name: `${id}.jpg`,
    uri: `file:///${id}.jpg`,
    remoteUri: `https://cdn.example/${id}.jpg`,
    status: 'uploaded',
    progress: 1,
  }) as Attachment;

const makeDraft = (overrides: Partial<any> = {}) =>
  ({
    title: 'Move a couch',
    description: '',
    amount: 0,
    isForHonor: false,
    workType: 'in_person',
    location: '',
    attachments: [],
    ...overrides,
  }) as any;

beforeEach(() => {
  capturedOptions = null;
});

describe('StepPhotos multi-photo selection', () => {
  it('keeps every photo when uploads report back in one tick', () => {
    const onUpdate = jest.fn();
    render(
      <StepPhotos
        draft={makeDraft()}
        onUpdate={onUpdate}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={2}
        totalSteps={2}
      />
    );

    // Three files from a single gallery selection, no render in between.
    capturedOptions.onUploaded(makeAttachment('a1'));
    capturedOptions.onUploaded(makeAttachment('a2'));
    capturedOptions.onUploaded(makeAttachment('a3'));

    const lastPatch = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastPatch.attachments.map((a: Attachment) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('appends onto photos the bounty already has', () => {
    const onUpdate = jest.fn();
    render(
      <StepPhotos
        draft={makeDraft({ attachments: [makeAttachment('existing')] })}
        onUpdate={onUpdate}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={2}
        totalSteps={2}
      />
    );

    capturedOptions.onUploaded(makeAttachment('a1'));
    capturedOptions.onUploaded(makeAttachment('a2'));

    const lastPatch = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastPatch.attachments.map((a: Attachment) => a.id)).toEqual(['existing', 'a1', 'a2']);
  });

  it('re-syncs with the draft after a removal so the next upload appends to the trimmed list', () => {
    const onUpdate = jest.fn();
    const { rerender } = render(
      <StepPhotos
        draft={makeDraft({ attachments: [makeAttachment('a1'), makeAttachment('a2')] })}
        onUpdate={onUpdate}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={2}
        totalSteps={2}
      />
    );

    fireEvent.press(screen.getByLabelText('Remove a2.jpg'));
    expect(onUpdate).toHaveBeenLastCalledWith({ attachments: [expect.objectContaining({ id: 'a1' })] });

    // The parent applies the removal and re-renders...
    rerender(
      <StepPhotos
        draft={makeDraft({ attachments: [makeAttachment('a1')] })}
        onUpdate={onUpdate}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={2}
        totalSteps={2}
      />
    );

    capturedOptions.onUploaded(makeAttachment('a3'));

    const lastPatch = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
    expect(lastPatch.attachments.map((a: Attachment) => a.id)).toEqual(['a1', 'a3']);
  });

  it('marks the CTA busy while the parent is persisting the step', () => {
    const { rerender } = render(
      <StepPhotos
        draft={makeDraft()}
        onUpdate={jest.fn()}
        onNext={jest.fn()}
        onBack={jest.fn()}
        step={2}
        totalSteps={2}
      />
    );
    expect(screen.getByLabelText('Skip for now').props.accessibilityState).toMatchObject({
      disabled: false,
      busy: false,
    });

    rerender(
      <StepPhotos
        draft={makeDraft()}
        onUpdate={jest.fn()}
        onNext={jest.fn()}
        onBack={jest.fn()}
        isSaving
        step={2}
        totalSteps={2}
      />
    );
    expect(screen.getByLabelText('Skip for now').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });
});
