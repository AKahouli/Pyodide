import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { useClassifierStore } from '../store';

export function ClassifierButton() {
  const navigate = useNavigate();
  const selectWorkspace = useClassifierStore((s) => s.selectWorkspace);

  const handleClick = () => {
    selectWorkspace(null);
    navigate('/classifier');
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip='Classifier' onClick={handleClick}>
        <FolderKanban />
        <span className='flex items-center gap-1.5'>
          Classifier
          <Badge
            variant='outline'
            className='px-1 py-0 text-[9px] font-semibold leading-tight border-primary/40 text-primary/70'
          >
            NEW
          </Badge>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
