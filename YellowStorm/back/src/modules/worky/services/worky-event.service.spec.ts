import { Subject } from 'rxjs';
import { WorkyEventService } from './worky-event.service';

describe('WorkyEventService stream sharing', () => {
  it('broadcasts to every stream subscriber and disconnects revoked users', () => {
    const service = new WorkyEventService({ get: jest.fn() } as never);
    const ownerDisconnect = new Subject<void>();
    const collaboratorDisconnect = new Subject<void>();
    const ownerEvents: MessageEvent[] = [];
    const collaboratorEvents: MessageEvent[] = [];

    service.registerConnection('owner', 'stream-1', 'owner-conn', ownerDisconnect)?.subscribe((event) => ownerEvents.push(event));
    service.registerConnection('collaborator', 'stream-1', 'collab-conn', collaboratorDisconnect)?.subscribe((event) => collaboratorEvents.push(event));

    service.emit('owner', 'stream-1', {
      type: 'stream.updated',
      emittedAt: Date.now(),
      payload: { title: 'Shared' },
    });

    expect(ownerEvents).toHaveLength(1);
    expect(collaboratorEvents).toHaveLength(1);

    service.disconnectUserFromStream('collaborator', 'stream-1');
    service.emit('owner', 'stream-1', {
      type: 'stream.updated',
      emittedAt: Date.now(),
      payload: { title: 'Owner only now' },
    });

    expect(ownerEvents).toHaveLength(2);
    expect(collaboratorEvents).toHaveLength(1);
    service.onModuleDestroy();
  });
});
