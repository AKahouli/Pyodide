import { describe, expect, it } from 'vitest';
import {
  getUserAccountMenuActions,
  parseRegistrationReviewSearch,
  stripRegistrationReviewParams,
} from './user-registration-review';

describe('getUserAccountMenuActions', () => {
  it('shows approve and reject only for Super Admin on pending inactive users', () => {
    const pending = { status: 'inactive' as const, registrationApproval: 'pending' as const };

    expect(getUserAccountMenuActions(pending, true)).toEqual({
      showApprove: true,
      showReject: true,
      showActivate: false,
      showSuspend: false,
    });
    expect(getUserAccountMenuActions(pending, false)).toEqual({
      showApprove: false,
      showReject: false,
      showActivate: false,
      showSuspend: false,
    });
  });

  it('hides reject for already rejected inactive users', () => {
    expect(
      getUserAccountMenuActions({ status: 'inactive', registrationApproval: 'rejected' }, true),
    ).toEqual({
      showApprove: true,
      showReject: false,
      showActivate: false,
      showSuspend: false,
    });
  });

  it('keeps activate for suspended and suspend for active', () => {
    expect(getUserAccountMenuActions({ status: 'suspended' }, true)).toMatchObject({
      showActivate: true,
      showSuspend: false,
      showApprove: false,
    });
    expect(getUserAccountMenuActions({ status: 'active' }, false)).toMatchObject({
      showActivate: false,
      showSuspend: true,
    });
  });
});

describe('parseRegistrationReviewSearch', () => {
  it('reads inactive filter, review id, and decision', () => {
    const search = new URLSearchParams(
      'status=inactive&review=user-1&decision=reject',
    );

    expect(parseRegistrationReviewSearch(search)).toEqual({
      statusFilter: 'inactive',
      reviewUserId: 'user-1',
      decision: 'reject',
    });
  });

  it('ignores unknown status and decision values', () => {
    expect(parseRegistrationReviewSearch(new URLSearchParams('status=active&decision=maybe'))).toEqual({
      statusFilter: undefined,
      reviewUserId: undefined,
      decision: undefined,
    });
  });

  it('strips review params while keeping status', () => {
    const search = new URLSearchParams('status=inactive&review=user-1&decision=approve');
    const next = stripRegistrationReviewParams(search);

    expect(next.get('status')).toBe('inactive');
    expect(next.get('review')).toBeNull();
    expect(next.get('decision')).toBeNull();
  });
});
