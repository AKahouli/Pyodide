import { ValidationPipe } from '@nestjs/common';
import { RootBackgroundEventsDto } from './root-background.dto';

describe('native background event HTTP validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true,
    transformOptions: { enableImplicitConversion: true }, stopAtFirstError: true });
  const authority = { owner: 'owner', fence: 1, requestDigest: 'a'.repeat(64) };
  const transform = (body: unknown) => pipe.transform(body, { type: 'body', metatype: RootBackgroundEventsDto });

  it('preserves native lifecycle and component objects through production implicit conversion', async () => {
    const events = [
      { eventId: 'lifecycle-1', kind: 'lifecycle', trace: { execution_id: 'execution', pending_inputs: [] } },
      { eventId: 'component-1', kind: 'component', action: 'add', component: { id: 'activity', type: 'toolActivity', data: { status: 'running' } } },
    ];
    const result = await transform({ ...authority, events });
    expect(result.events).toEqual(events);
    expect(result.events.every((event: unknown) => !Array.isArray(event))).toBe(true);
  });

  it.each([null, 'event', 42, []])('rejects malformed event entries: %p', async (event) => {
    await expect(transform({ ...authority, events: [event] })).rejects.toMatchObject({ status: 400 });
  });

  it('retains authority and batch validation', async () => {
    await expect(transform({ ...authority, owner: '', events: [{}] })).rejects.toMatchObject({ status: 400 });
    await expect(transform({ ...authority, events: [] })).rejects.toMatchObject({ status: 400 });
    await expect(transform({ ...authority, events: Array.from({ length: 21 }, () => ({})) })).rejects.toMatchObject({ status: 400 });
  });
});
