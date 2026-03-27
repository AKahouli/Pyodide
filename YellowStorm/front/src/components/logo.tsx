import { appConfig } from '@/config/app';

export function Logo() {
  return <span className='italic'>{appConfig.name}</span>;
}
