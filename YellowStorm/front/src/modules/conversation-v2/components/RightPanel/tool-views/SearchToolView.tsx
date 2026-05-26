import { ExternalLinkIcon, SearchIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ToolContent } from '../../../types';
import { useConversationV2Translation } from '../../../translation';

type Search = Extract<ToolContent, { kind: 'search' }>;

export function SearchToolView({ content }: { content: Search }) {
  const { t } = useConversationV2Translation();

  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <header className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>
        <SearchIcon className='size-4 shrink-0' />
        <span className='truncate'>{content.query}</span>
      </header>
      <div className='min-h-0 flex-1 overflow-auto'>
        {content.results.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>{t('tools.search.noResults')}</p>
        ) : (
          <ul className='space-y-2'>
            {content.results.map((r, i) => (
              <li key={`${i}-${r.url}`}>
                <Card className='gap-1 p-3'>
                  <CardHeader className='flex flex-row items-start justify-between gap-2 p-0'>
                    <CardTitle className='text-sm font-medium leading-tight'>
                      <a
                        href={r.url}
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex items-center gap-1 hover:underline'
                      >
                        {r.title}
                        <ExternalLinkIcon className='size-3 shrink-0 text-muted-foreground' />
                      </a>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <div className='truncate text-xs text-muted-foreground'>{r.url}</div>
                    <p className='mt-1 line-clamp-3 text-xs text-foreground'>{r.snippet}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
