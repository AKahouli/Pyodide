import { StreamSidebar } from './StreamSidebar';

export function WorkyPage(): JSX.Element {
  return (
    <div className='flex h-full w-full'>
      <StreamSidebar />
      <section className='flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground'>
        <div className='max-w-md text-center'>
          <h2 className='text-base font-semibold text-foreground'>Worky</h2>
          <p className='mt-2 text-xs'>
            Select a stream from the sidebar, or click <strong>+ New Stream</strong> to
            create one. Part 1 supports stream CRUD only; the planning
            conversation and Kanban execution land in Parts 2 and 3.
          </p>
        </div>
      </section>
    </div>
  );
}
