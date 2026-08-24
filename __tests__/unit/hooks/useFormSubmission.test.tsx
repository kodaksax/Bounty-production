/**
 * Regression coverage for the submission guard behind the reported beta bug
 * "sign-in becomes unusable after an incorrect password".
 *
 * The old implementation stamped `lastSubmitTimeRef` at the START of a
 * submission and returned silently when the next call arrived inside
 * `debounceMs`. Any submission that failed FAST locally (form validation, the
 * CAPTCHA pre-check, the lockout pre-check) therefore ate the user's very next
 * tap without changing loading state, error state, or anything else on screen
 * — a literally dead button.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFormSubmission } from '../../../hooks/useFormSubmission';

describe('useFormSubmission', () => {
  it('runs a second submission immediately after a fast local failure', async () => {
    const onSubmit = jest
      .fn<Promise<void>, []>()
      // Fails synchronously, exactly like the CAPTCHA / lockout / validation
      // pre-checks in the sign-in form.
      .mockRejectedValueOnce(new Error('Please fix the form errors'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useFormSubmission(onSubmit));

    await act(async () => {
      await result.current.submit();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe('Please fix the form errors');
    expect(result.current.isSubmitting).toBe(false);

    // The retry tap happens milliseconds later — it must actually execute.
    await act(async () => {
      await result.current.submit();
    });

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('recovers after a rejected submission and allows repeated retries', async () => {
    const onSubmit = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('Invalid email or password.'))
      .mockRejectedValueOnce(new Error('Invalid email or password.'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useFormSubmission(onSubmit));

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await result.current.submit();
      });
      // Loading must always resolve, on every path.
      expect(result.current.isSubmitting).toBe(false);
    }

    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
  });

  it('blocks a concurrent submission while one is still in flight', async () => {
    let release: (() => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );

    const { result } = renderHook(() => useFormSubmission(onSubmit));

    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.submit();
    });

    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    // Second tap while the request is in flight — must not fire a second request.
    await act(async () => {
      await result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await first;
    });

    expect(result.current.isSubmitting).toBe(false);

    // Once complete, submitting again works.
    await act(async () => {
      release = undefined;
      const second = result.current.submit();
      release?.();
      await second;
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight guard even when onSubmit throws synchronously', async () => {
    const onSubmit = jest.fn(() => {
      throw new Error('boom');
    }) as unknown as () => Promise<void>;

    const { result } = renderHook(() => useFormSubmission(onSubmit));

    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.isSubmitting).toBe(false);

    await act(async () => {
      await result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('honours an explicit debounce measured from completion, not from start', async () => {
    const onSubmit = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFormSubmission(onSubmit, { debounceMs: 1000 }));

    await act(async () => {
      await result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Immediately after completion — inside the explicit cooldown.
    await act(async () => {
      await result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('reset() clears the cooldown so the next submission is not swallowed', async () => {
    // `reset` means "this form is submittable again". Leaving the
    // last-completed stamp behind would let the cooldown eat the very next
    // submission — silently, with no state change — which is exactly the dead
    // button this hook was fixed to stop producing.
    const onSubmit = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFormSubmission(onSubmit, { debounceMs: 5000 }));

    await act(async () => {
      await result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Still inside the cooldown — blocked, as designed.
    await act(async () => {
      await result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reset();
    });

    // After an explicit reset the cooldown must no longer apply.
    await act(async () => {
      await result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('reset() re-enables submission', async () => {
    const onSubmit = jest.fn<Promise<void>, []>().mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useFormSubmission(onSubmit));

    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).toBeTruthy();

    act(() => {
      result.current.reset();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });
});
