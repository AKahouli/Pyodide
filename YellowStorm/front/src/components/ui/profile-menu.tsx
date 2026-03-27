import { useNavigate } from 'react-router-dom';
import { LogOut, Settings, Zap } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from './button';
import { Avatar, AvatarFallback } from './avatar';
import { useAuth } from '@/modules/auth';
import { useSettingsModal } from '@/modules/profile';
import { useModuleTranslation } from '@/modules/localization';

export function ProfileMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { openSettings } = useSettingsModal();
  const { t } = useModuleTranslation('common');

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Get initials from user profile or email
  const getInitials = () => {
    if (user?.profile?.firstName && user?.profile?.lastName) {
      return `${user.profile.firstName[0]}${user.profile.lastName[0]}`.toUpperCase();
    }
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  // Get display name
  const getDisplayName = () => {
    if (user?.profile?.firstName && user?.profile?.lastName) {
      return `${user.profile.firstName} ${user.profile.lastName}`;
    }
    return user?.email?.split('@')[0] || 'User';
  };

  return (
    <nav className='flex items-center space-x-2'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='relative h-8 w-8 rounded-full'>
            <Avatar className='h-8 w-8'>
              <AvatarFallback>{getInitials()}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56' align='end' sideOffset={8}>
          <DropdownMenuLabel className='font-normal'>
            <div className='flex flex-col space-y-1'>
              <p className='text-sm font-medium leading-none'>{getDisplayName()}</p>
              <p className='text-xs leading-none text-muted-foreground'>{user?.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openSettings('profile')} className='cursor-pointer'>
            <Settings className='h-4 w-4' />
            {t('profileMenu.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/upgrade')} className='cursor-pointer'>
            <Zap className='h-4 w-4' />
            {t('profileMenu.upgrade')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout} className='cursor-pointer'>
            <LogOut className='h-4 w-4' />
            {t('profileMenu.logout')}
         </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
