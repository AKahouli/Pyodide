"""Hard shared provider-call slots; uncertain dispatched calls are never stolen."""
import asyncio
from dataclasses import dataclass
from contextvars import ContextVar
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine


@dataclass(frozen=True)
class ModelPermit:
    slot: int
    owner: str
    fence: int


class ModelCapacity:
    def __init__(self, engine):
        self.engine = engine

    async def acquire(self, timeout=30):
        async with asyncio.timeout(timeout):
            while True:
                async with self.engine.begin() as connection:
                    count = (await connection.execute(text('SELECT count(*) FROM conversation.root_model_slots'))).scalar_one()
                    if count != 30:
                        raise RuntimeError('Qualified model capacity requires exactly 30 durable slots')
                    slot = (await connection.execute(text("SELECT id FROM conversation.root_model_slots WHERE status='free' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1"))).scalar_one_or_none()
                    if slot is not None:
                        owner = str(uuid4())
                        fence = (await connection.execute(text("UPDATE conversation.root_model_slots SET owner=CAST(:owner AS uuid),fence=fence+1,status='reserved',updated_at=clock_timestamp() WHERE id=:id RETURNING fence"),
                            {'owner': owner, 'id': slot})).scalar_one()
                        return ModelPermit(slot, owner, fence)
                await asyncio.sleep(0.05)

    async def transition(self, permit, status):
        if status not in ('running', 'free', 'outcome_unknown'):
            raise ValueError('Invalid model permit transition')
        async with self.engine.begin() as connection:
            row = await connection.execute(text('''UPDATE conversation.root_model_slots
                SET status=CAST(:status AS varchar),owner=CASE WHEN CAST(:status AS varchar)='free' THEN NULL ELSE owner END,updated_at=clock_timestamp()
                WHERE id=:id AND owner=CAST(:owner AS uuid) AND fence=:fence AND status IN ('reserved','running')
                RETURNING id'''), {'id': permit.slot, 'owner': permit.owner, 'fence': permit.fence, 'status': status})
            if row.scalar_one_or_none() is None:
                raise PermissionError('Model permit ownership changed')


_default = None
_streams = ContextVar('owned_provider_streams', default=None)


def capacity_pool():
    global _default
    if _default is None:
        from src.config.settings import get_settings
        raw = get_settings().ROOT_WORK_DATABASE_URL
        if not raw:
            raise RuntimeError('Qualified model capacity requires the shared control database')
        url = make_url(raw)
        if url.get_backend_name() != 'postgresql':
            raise RuntimeError('Qualified model capacity requires PostgreSQL')
        _default = ModelCapacity(create_async_engine(url.set(drivername='postgresql+asyncpg'), pool_size=5, max_overflow=5))
    return _default


async def _finish(pool, permit, status):
    await asyncio.shield(pool.transition(permit, status))


class CapacityClient:
    def __init__(self, client, pool=None):
        self.client, self.pool = client, pool

    def __getattr__(self, name):
        return getattr(self.client, name)

    def begin(self):
        streams = []
        return _streams.set(streams), streams, asyncio.current_task()

    async def end(self, scope):
        token, streams, task = scope
        try:
            for stream in streams:
                await stream.aclose()
        finally:
            # Async-generator finalizers can run in a different task/context.
            # Close the captured streams there without resetting its context.
            if asyncio.current_task() is task:
                _streams.reset(token)

    async def acompletion(self, **kwargs):
        pool = self.pool or capacity_pool()
        permit = await pool.acquire()
        dispatched = False
        try:
            await pool.transition(permit, 'running')
            dispatched = True
            # A timeout retry could overlap the original provider request.
            response = await self.client.acompletion(**{**kwargs, 'num_retries': 0})
        except BaseException as error:
            rejected = getattr(error, 'status_code', None) in (400, 401, 403, 404, 413, 422, 429)
            await _finish(pool, permit, 'free' if not dispatched or rejected else 'outcome_unknown')
            raise
        if kwargs.get('stream'):
            stream = CapacityStream(response, pool, permit)
            if _streams.get() is not None:
                _streams.get().append(stream)
            return stream
        await _finish(pool, permit, 'free')
        return response


class CapacityStream:
    def __init__(self, stream, pool, permit):
        self.stream, self.pool, self.permit = stream, pool, permit
        self.iterator = stream.__aiter__()
        self.finished = False

    def __getattr__(self, name):
        return getattr(self.stream, name)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return await self.iterator.__anext__()
        except StopAsyncIteration:
            if not self.finished:
                self.finished = True
                await _finish(self.pool, self.permit, 'free')
            raise
        except BaseException:
            if not self.finished:
                self.finished = True
                await _finish(self.pool, self.permit, 'outcome_unknown')
            raise

    async def aclose(self):
        try:
            close = getattr(self.stream, 'aclose', None) or getattr(self.stream, 'close', None)
            if close is not None:
                await close()
        finally:
            if not self.finished:
                self.finished = True
                await _finish(self.pool, self.permit, 'outcome_unknown')
