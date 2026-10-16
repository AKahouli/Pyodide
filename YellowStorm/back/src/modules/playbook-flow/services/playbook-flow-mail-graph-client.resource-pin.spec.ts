import { pinInboxMessageResource } from './playbook-flow-mail-graph-client.service';

describe('pinInboxMessageResource', () => {
  it('pins realistic Graph notification resources to the reconstructed inbox path', () => {
    expect(pinInboxMessageResource("/Users/ownerGraphId/mailFolders('AQMkADAwATM0MDAAMS0yMDctLWExLTMtMDEDAAA=')/messages/AAMkAGZl"))
      .toBe("me/mailFolders('AQMkADAwATM0MDAAMS0yMDctLWExLTMtMDEDAAA=')/messages/AAMkAGZl");
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages/AAA"))
      .toBe("me/mailFolders('inbox')/messages/AAA");
    // Graph key syntax (EWS ids may contain `/` and `+`) is preserved verbatim.
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages('AAA')"))
      .toBe("me/mailFolders('inbox')/messages('AAA')");
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages('AAAA+/B=')"))
      .toBe("me/mailFolders('inbox')/messages('AAAA+/B=')");
    expect(pinInboxMessageResource("/me/mailFolders('inbox')/messages/AAA"))
      .toBe("me/mailFolders('inbox')/messages/AAA");
  });

  it('falls back to the subscribed inbox only when the notification carries no resource', () => {
    expect(pinInboxMessageResource(undefined, 'AAA')).toBe("me/mailFolders('inbox')/messages/AAA");
    expect(pinInboxMessageResource('', 'AAA')).toBe("me/mailFolders('inbox')/messages/AAA");
    expect(pinInboxMessageResource(null, { id: 'AAA' })).toBeNull();
    expect(pinInboxMessageResource(undefined)).toBeNull();
  });

  it('refuses a present-but-unrecognized resource instead of falling back', () => {
    expect(pinInboxMessageResource('me/messages/AAA', 'AAA')).toBeNull();
    expect(pinInboxMessageResource('me/calendars/A', 'AAA')).toBeNull();
    expect(pinInboxMessageResource('me/mailFolders/inbox', 'AAA')).toBeNull();
  });

  it('rejects well-known cross-folder names other than the subscribed inbox', () => {
    expect(pinInboxMessageResource("me/mailFolders('sentitems')/messages/AAA")).toBeNull();
    expect(pinInboxMessageResource("/Users/x/mailFolders('drafts')/messages/AAA")).toBeNull();
    expect(pinInboxMessageResource("/Users/x/mailFolders('DELETEDITEMS')/messages/AAA")).toBeNull();
  });

  it('rejects traversal, query strings and delimiter injection', () => {
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages/../../users/victim/messages/X")).toBeNull();
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages/AAA?$select=body")).toBeNull();
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages/AAA#fragment")).toBeNull();
    expect(pinInboxMessageResource("me/mailFolders('in''box')/messages/AAA")).toBeNull();
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages/AA'A'BB")).toBeNull();
    expect(pinInboxMessageResource("me/mailFolders('%69nbox')/messages/AAA")).toBeNull();
    expect(pinInboxMessageResource("me/mailFolders('inbox')/messages('AA%2FAA')")).toBeNull();
  });
});
