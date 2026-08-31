import { isMessageRequestIdentityConflict } from './postgres-error';

describe('isMessageRequestIdentityConflict', () => {
  it('matches only the PostgreSQL request identity constraint', () => {
    expect(isMessageRequestIdentityConflict({ code: '23505', constraint: 'uq_messages_request_identity' })).toBe(true);
    expect(isMessageRequestIdentityConflict({ code: '23505', constraint: 'another_unique' })).toBe(false);
    expect(isMessageRequestIdentityConflict({ code: 11000 })).toBe(false);
  });
});
