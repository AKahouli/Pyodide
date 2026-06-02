import { useSelectedConnectorRepo, useSetSelectedConnectorRepo } from '@/modules/conversation/store';
import { X, Cable } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SelectedConnectorRepo() {
  const selectedRepo = useSelectedConnectorRepo();
  const setSelectedRepo = useSetSelectedConnectorRepo();

  if (!selectedRepo) {
    return null;
  }

  const handleClear = () => {
    setSelectedRepo(null);
  };

  return (
    <div className='w-full max-w-3xl px-4 mt-2 flex items-center justify-end gap-2'>
      <div className='flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm'>
        <Cable className='h-4 w-4 text-muted-foreground' />
        <span className='text-muted-foreground'>{selectedRepo.connectorName}:</span>
        <span className='font-medium'>{selectedRepo.repoName}</span>
        <Button
          variant='ghost'
          size='sm'
          className='h-auto p-0.5 ml-1 hover:bg-transparent'
          onClick={handleClear}
        >
          <X className='h-3.5 w-3.5 text-muted-foreground hover:text-foreground' />
        </Button>
      </div>
    </div>
  );
}
