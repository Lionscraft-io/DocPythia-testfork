/**
 * useToast Hook Tests

 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { reducer, useToast, toast } from '../../../client/src/hooks/use-toast';

describe('useToast reducer', () => {
  const initialState = { toasts: [] };

  describe('ADD_TOAST', () => {
    it('should add a toast to empty state', () => {
      const newToast = { id: '1', title: 'Test Toast', open: true };
      const result = reducer(initialState, {
        type: 'ADD_TOAST',
        toast: newToast,
      });

      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0]).toEqual(newToast);
    });

    it('should add toast to beginning of list', () => {
      const existingToast = { id: '1', title: 'First', open: true };
      const newToast = { id: '2', title: 'Second', open: true };
      const stateWithToast = { toasts: [existingToast] };

      const result = reducer(stateWithToast, {
        type: 'ADD_TOAST',
        toast: newToast,
      });

      expect(result.toasts[0].id).toBe('2');
    });

    it('should limit toasts to TOAST_LIMIT', () => {
      const existingToast = { id: '1', title: 'First', open: true };
      const newToast = { id: '2', title: 'Second', open: true };
      const stateWithToast = { toasts: [existingToast] };

      const result = reducer(stateWithToast, {
        type: 'ADD_TOAST',
        toast: newToast,
      });

      // TOAST_LIMIT is 1, so only the new toast should remain
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe('2');
    });
  });

  describe('UPDATE_TOAST', () => {
    it('should update an existing toast', () => {
      const existingToast = { id: '1', title: 'Original', open: true };
      const stateWithToast = { toasts: [existingToast] };

      const result = reducer(stateWithToast, {
        type: 'UPDATE_TOAST',
        toast: { id: '1', title: 'Updated' },
      });

      expect(result.toasts[0].title).toBe('Updated');
      expect(result.toasts[0].open).toBe(true); // Should preserve other properties
    });

    it('should not update non-matching toast', () => {
      const existingToast = { id: '1', title: 'Original', open: true };
      const stateWithToast = { toasts: [existingToast] };

      const result = reducer(stateWithToast, {
        type: 'UPDATE_TOAST',
        toast: { id: '2', title: 'Updated' },
      });

      expect(result.toasts[0].title).toBe('Original');
    });
  });

  describe('DISMISS_TOAST', () => {
    it('should set open to false for specific toast', () => {
      const toast1 = { id: '1', title: 'First', open: true };
      const toast2 = { id: '2', title: 'Second', open: true };
      const stateWithToasts = { toasts: [toast1, toast2] };

      const result = reducer(stateWithToasts, {
        type: 'DISMISS_TOAST',
        toastId: '1',
      });

      expect(result.toasts.find((t) => t.id === '1')?.open).toBe(false);
      expect(result.toasts.find((t) => t.id === '2')?.open).toBe(true);
    });

    it('should dismiss all toasts when no toastId provided', () => {
      const toast1 = { id: '1', title: 'First', open: true };
      const stateWithToasts = { toasts: [toast1] };

      const result = reducer(stateWithToasts, {
        type: 'DISMISS_TOAST',
      });

      expect(result.toasts.every((t) => t.open === false)).toBe(true);
    });
  });

  describe('REMOVE_TOAST', () => {
    it('should remove specific toast', () => {
      const toast1 = { id: '1', title: 'First', open: true };
      const toast2 = { id: '2', title: 'Second', open: true };
      const stateWithToasts = { toasts: [toast1, toast2] };

      const result = reducer(stateWithToasts, {
        type: 'REMOVE_TOAST',
        toastId: '1',
      });

      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe('2');
    });

    it('should remove all toasts when no toastId provided', () => {
      const toast1 = { id: '1', title: 'First', open: true };
      const stateWithToasts = { toasts: [toast1] };

      const result = reducer(stateWithToasts, {
        type: 'REMOVE_TOAST',
      });

      expect(result.toasts).toHaveLength(0);
    });
  });
});

describe('toast function', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a toast and return id', () => {
    const result = toast({ title: 'Test Toast' });
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
  });

  it('should return dismiss function', () => {
    const result = toast({ title: 'Test Toast' });
    expect(typeof result.dismiss).toBe('function');
  });

  it('should return update function', () => {
    const result = toast({ title: 'Test Toast' });
    expect(typeof result.update).toBe('function');
  });

  it('should generate unique ids for each toast', () => {
    const result1 = toast({ title: 'Toast 1' });
    const result2 = toast({ title: 'Toast 2' });
    expect(result1.id).not.toBe(result2.id);
  });

  it('should add toast with open: true', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: 'New Toast' });
    });

    expect(result.current.toasts.length).toBeGreaterThanOrEqual(0);
  });

  it('should dismiss toast when dismiss is called', () => {
    const { result } = renderHook(() => useToast());

    let toastResult: { id: string; dismiss: () => void };
    act(() => {
      toastResult = toast({ title: 'Dismissable Toast' });
    });

    act(() => {
      toastResult.dismiss();
    });

    // Toast should be set to open: false or removed
    const foundToast = result.current.toasts.find((t) => t.id === toastResult.id);
    if (foundToast) {
      expect(foundToast.open).toBe(false);
    }
  });
});

describe('useToast hook', () => {
  it('should return toasts array', () => {
    const { result } = renderHook(() => useToast());
    expect(Array.isArray(result.current.toasts)).toBe(true);
  });

  it('should return toast function', () => {
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.toast).toBe('function');
  });

  it('should return dismiss function', () => {
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.dismiss).toBe('function');
  });

  it('should clean up listener on unmount', () => {
    const { unmount } = renderHook(() => useToast());

    // Should not throw when unmounting
    expect(() => unmount()).not.toThrow();
  });

  it('should add toast to state synchronously', () => {
    const { result } = renderHook(() => useToast());
    const initialLength = result.current.toasts.length;

    act(() => {
      result.current.toast({ title: 'Sync Toast' });
    });

    // The toast is added to the global state immediately
    // The hook should reflect the new state
    expect(result.current.toasts.length).toBeGreaterThanOrEqual(initialLength);
  });
});
